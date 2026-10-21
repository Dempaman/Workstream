import { execute } from "./process";
import type {
  Project,
  ProviderAccount,
  RepositoryAccess,
} from "../shared/types";
import {
  CliMissing,
  SignInRequired,
  gitAuthEnv,
  isMissingProgram,
  networkError,
  pushAuthFor,
  tenantIdPattern,
  text,
  tokenClaims,
  type NetworkFetch,
} from "./hosting";

/** Azure DevOps application ID used as the token resource. */
const devOpsResource = "499b84ac-1321-427f-aa17-267ca6975798";
/** "Git Repositories" security namespace and its permission bits. */
const gitNamespace = "2e9eb7ed-3c0a-47d4-87c1-0ffdd275fd87";
const bits = { contribute: 4, createBranch: 16, pullRequest: 16384 } as const;

export function azureRepository(remote: string) {
  const modern = remote.match(
    /dev\.azure\.com[/:]([^/]+)\/([^/]+)\/_git\/([^/?#]+)/,
  );
  const ssh = remote.match(
    /ssh\.dev\.azure\.com[:/]v3\/([^/]+)\/([^/]+)\/([^/?#]+)/,
  );
  const legacy = remote.match(
    /https:\/\/([^.]+)\.visualstudio\.com\/(?:DefaultCollection\/)?([^/]+)\/_git\/([^/?#]+)/,
  );
  const match = modern ?? ssh ?? legacy;
  if (!match)
    throw new Error(
      "This project's origin is not an Azure DevOps repository. Choose the matching provider for the project in Connections.",
    );
  return {
    organization: decodeURIComponent(match[1]),
    project: decodeURIComponent(match[2]),
    repository: decodeURIComponent(match[3]).replace(/\.git$/, ""),
  };
}

/**
 * Runs Azure CLI with fixed, validated arguments. On Windows az is a .cmd
 * launcher, so it is started through PowerShell. Only arguments matching a
 * strict character set are accepted, so no task or renderer text can reach
 * the script.
 */
export function runAz(
  args: string[],
  cwd: string,
  options: { interactive?: boolean; timeout?: number } = {},
) {
  if (process.platform !== "win32")
    return execute("az", args, cwd, {
      timeout: options.timeout,
      windowsHide: !options.interactive,
    });
  for (const argument of args)
    if (!/^[A-Za-z0-9._:/=@-]+$/.test(argument))
      throw new Error("Unexpected Azure CLI argument.");
  const script = `$ErrorActionPreference = 'Stop'; & az ${args.map((a) => `'${a}'`).join(" ")}; exit $LASTEXITCODE`;
  return execute(
    "powershell.exe",
    [
      "-NoProfile",
      ...(options.interactive ? [] : ["-NonInteractive"]),
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ],
    cwd,
    { timeout: options.timeout, windowsHide: !options.interactive },
  );
}

export interface AzureIdentity {
  token: string;
  account?: string;
  displayName?: string;
  tenantId?: string;
}
/** Gets an Azure DevOps token from Azure CLI, pinned to the organization's tenant when known. */
export async function azureToken(
  cwd: string,
  tenant?: string,
): Promise<AzureIdentity> {
  const args = [
    "account",
    "get-access-token",
    "--resource",
    devOpsResource,
    "--output",
    "json",
  ];
  if (tenant) {
    if (!tenantIdPattern.test(tenant)) throw new Error("Invalid tenant ID.");
    args.push("--tenant", tenant);
  }
  let result: Awaited<ReturnType<typeof execute>>;
  try {
    result = await runAz(args, cwd);
  } catch (error) {
    if (isMissingProgram(error))
      throw new CliMissing(
        "Azure CLI is not installed or not on PATH. Install Azure CLI, restart Workstream, then sign in.",
      );
    throw error;
  }
  if (result.code !== 0) {
    if (isMissingProgram(undefined, result.stderr))
      throw new CliMissing(
        "Azure CLI is not installed or not on PATH. Install Azure CLI, restart Workstream, then sign in.",
      );
    throw new SignInRequired(
      tenant
        ? "Azure CLI has no sign-in for this organization's tenant. Use Sign in to Azure and pick the account that has access to the organization."
        : "Azure CLI is not signed in. Use Sign in to Azure.",
    );
  }
  let parsed: { accessToken?: string; tenant?: string };
  try {
    parsed = JSON.parse(result.stdout) as typeof parsed;
  } catch {
    parsed = {};
  }
  if (!parsed.accessToken)
    throw new SignInRequired(
      "Azure CLI did not return a usable access token. Use Sign in to Azure.",
    );
  const claims = tokenClaims(parsed.accessToken);
  return {
    token: parsed.accessToken,
    account:
      text(claims.upn) ??
      text(claims.email) ??
      text(claims.preferred_username) ??
      text(claims.unique_name)?.replace(/^live\.com#/, ""),
    displayName: text(claims.name),
    tenantId: text(claims.tid) ?? text(parsed.tenant),
  };
}

/**
 * Azure DevOps reports the organization's Entra tenant on unauthenticated
 * requests. Knowing it up front lets sign-in target the right tenant before
 * the first 401. Best effort: undefined when unavailable.
 */
export async function discoverAzureTenant(
  organization: string,
  networkFetch: NetworkFetch,
) {
  try {
    const response = await networkFetch(
      `https://dev.azure.com/${encodeURIComponent(organization)}/_apis/connectionData`,
      {
        headers: { "X-TFS-FedAuthRedirect": "Suppress" },
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
      },
    );
    return tenantFromHeaders(response.headers);
  } catch {
    return undefined;
  }
}
function tenantFromHeaders(headers: Headers) {
  const tenant =
    headers.get("x-vss-resourcetenant") ??
    headers
      .get("www-authenticate")
      ?.match(
        /authorization_uri=https:\/\/(?:login\.microsoftonline\.com|login\.windows\.net)\/([0-9a-f-]{36})/i,
      )?.[1];
  return tenant && tenantIdPattern.test(tenant)
    ? tenant.toLowerCase()
    : undefined;
}

/** Hex-encodes each branch path segment as UTF-16LE, the format Azure DevOps uses in Git security tokens. */
export function encodeRefSegments(path: string) {
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => Buffer.from(segment, "utf16le").toString("hex"))
    .join("/");
}

export async function azureSession(
  project: Project,
  networkFetch: NetworkFetch,
) {
  const repo = azureRepository(project.remote);
  if (!project.azureTenantId) {
    const tenant = await discoverAzureTenant(repo.organization, networkFetch);
    if (tenant) project.azureTenantId = tenant;
  }
  const identity = await azureToken(project.path, project.azureTenantId);
  const who = identity.account ?? "the signed-in account";
  const orgBase = `https://dev.azure.com/${encodeURIComponent(repo.organization)}`;
  const repoBase = `${orgBase}/${encodeURIComponent(repo.project)}/_apis/git/repositories/${encodeURIComponent(repo.repository)}`;
  const call = async (url: string, method: string, body?: unknown) => {
    const response = await networkFetch(
      `${url}${url.includes("?") ? "&" : "?"}api-version=7.1`,
      {
        method,
        headers: {
          Authorization: `Bearer ${identity.token}`,
          "Content-Type": "application/json",
          "X-TFS-FedAuthRedirect": "Suppress",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30_000),
        redirect: "error",
      },
    ).catch((error: unknown) => {
      if (/redirect/i.test(String(error)))
        throw new SignInRequired(
          `Azure DevOps redirected this request to sign-in. ${who} cannot use ${repo.organization}. Use Sign in to Azure with an account that belongs to this organization. No files were pushed.`,
        );
      throw networkError("Azure DevOps", error);
    });
    // 203 is Azure DevOps' HTML sign-in page served as "success".
    if (!response.ok || response.status === 203) {
      const tenant = tenantFromHeaders(response.headers);
      if (tenant) project.azureTenantId = tenant;
      if (response.status === 401 || response.status === 203)
        throw new SignInRequired(
          `Azure DevOps rejected the login (401) for ${who}. Use Sign in to Azure and pick the work account that belongs to ${repo.organization}, then retry.`,
        );
      if (response.status === 403)
        throw new Error(
          `Azure DevOps denied repository access (403) for ${who}. Signing in again only helps if you switch to another account. Check that this account is a member of ${repo.organization}/${repo.project}, has the Basic access level (Stakeholder cannot use Repos), and is in a group with Contribute and Contribute to pull requests on ${repo.repository}.`,
        );
      throw new Error(
        `Azure DevOps returned ${response.status}. Check the repository URL and connectivity before retrying.`,
      );
    }
    return response.json() as Promise<unknown>;
  };
  return {
    repo,
    identity,
    gitEnv: gitAuthEnv(
      project.remote,
      `Authorization: Bearer ${identity.token}`,
    ),
    request: (path: string, method = "GET", body?: unknown) =>
      call(repoBase + path, method, body),
    orgRequest: (path: string, method = "GET", body?: unknown) =>
      call(orgBase + path, method, body),
  };
}
export type AzureSession = Awaited<ReturnType<typeof azureSession>>;

/** Read-only checks: repository read plus evaluated push, branch and PR permissions. No push or PR is created. */
export async function azurePermissions(
  project: Project,
  session: AzureSession,
): Promise<RepositoryAccess> {
  const info = (await session.request("")) as {
    id?: string;
    project?: { id?: string };
  };
  let push: boolean | null = null;
  let createBranch: boolean | null = null;
  let pullRequest: boolean | null = null;
  if (info?.id && info.project?.id) {
    const token = `repoV2/${info.project.id}/${info.id}`;
    const prefix = encodeRefSegments(project.branchPrefix);
    try {
      const result = (await session.orgRequest(
        "/_apis/security/permissionevaluationbatch",
        "POST",
        {
          alwaysAllowAdministrators: false,
          evaluations: [
            { securityNamespaceId: gitNamespace, token, permissions: bits.contribute },
            { securityNamespaceId: gitNamespace, token, permissions: bits.pullRequest },
            {
              securityNamespaceId: gitNamespace,
              token: prefix ? `${token}/refs/heads/${prefix}` : token,
              permissions: bits.createBranch,
            },
          ],
        },
      )) as { evaluations?: { value?: unknown }[] };
      const values = (result?.evaluations ?? []).map((e) =>
        typeof e.value === "boolean" ? e.value : null,
      );
      push = values[0] ?? null;
      pullRequest = values[1] ?? null;
      createBranch = values[2] ?? null;
    } catch {
      /* Permission evaluation unavailable: report unknown, not denied. */
    }
  }
  return accessResult(project, session.identity.account, {
    read: true,
    push,
    createBranch,
    pullRequest,
  });
}

export function accessResult(
  project: Project,
  account: string | undefined,
  values: Pick<RepositoryAccess, "read" | "push" | "createBranch" | "pullRequest">,
): RepositoryAccess {
  const denied = (
    [
      ["push (Contribute)", values.push],
      ["create branches", values.createBranch],
      ["create pull requests", values.pullRequest],
    ] as const
  )
    .filter(([, value]) => value === false)
    .map(([name]) => name);
  const unknown = [values.push, values.createBranch, values.pullRequest].some(
    (value) => value === null,
  );
  const who = account ?? "The signed-in account";
  return {
    provider: project.provider === "github" ? "github" : "azure",
    checkedAt: new Date().toISOString(),
    account,
    ...values,
    pushAuth: pushAuthFor(project.remote),
    ok: values.read === true && !denied.length,
    summary: denied.length
      ? `${who} can read the repository but cannot ${denied.join(", ")}. Ask a project administrator for these permissions, or sign in with another account.`
      : unknown
        ? `${who} can read the repository. Some permissions could not be evaluated; publication will report any remaining problem.`
        : `${who} can read, push, create branches and create pull requests.`,
  };
}

export async function azureAccount(
  cwd: string,
  tenant?: string,
): Promise<ProviderAccount> {
  const checkedAt = new Date().toISOString();
  try {
    const identity = await azureToken(cwd, tenant);
    return {
      provider: "azure",
      cliInstalled: true,
      signedIn: true,
      account: identity.account,
      displayName: identity.displayName,
      tenantId: identity.tenantId,
      checkedAt,
    };
  } catch (error) {
    return {
      provider: "azure",
      cliInstalled: !(error instanceof CliMissing),
      signedIn: false,
      checkedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Opens Microsoft's normal sign-in (account picker) for the tenant. Azure CLI stores the sign-in, not Workstream. */
export async function loginAzure(cwd: string, tenant?: string) {
  if (tenant && !tenantIdPattern.test(tenant))
    throw new Error("Invalid tenant ID.");
  const args = [
    "login",
    ...(tenant ? ["--tenant", tenant] : []),
    "--allow-no-subscriptions",
    "--output",
    "none",
  ];
  let result: Awaited<ReturnType<typeof execute>>;
  try {
    result = await runAz(args, cwd, {
      interactive: true,
      timeout: 10 * 60_000,
    });
  } catch (error) {
    if (isMissingProgram(error))
      throw new CliMissing("Azure CLI is not installed or not on PATH.");
    throw error;
  }
  if (result.code !== 0)
    throw new Error(
      isMissingProgram(undefined, result.stderr)
        ? "Azure CLI is not installed or not on PATH."
        : "Azure sign-in did not complete. Finish the browser sign-in and try again.",
    );
}
