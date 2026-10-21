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
  type NetworkFetch,
} from "./hosting";
import { accessResult } from "./azure";

export const githubDeviceUrl = "https://github.com/login/device";

export function githubRepository(remote: string) {
  const match = remote.match(
    /github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i,
  );
  if (!match)
    throw new Error(
      "This project's origin is not a github.com repository. Choose the matching provider for the project in Connections.",
    );
  return { owner: match[1], repository: match[2] };
}

/** Reads the GitHub CLI's token for github.com. Kept in memory only. */
export async function githubToken(cwd: string) {
  let result: Awaited<ReturnType<typeof execute>>;
  try {
    result = await execute(
      "gh",
      ["auth", "token", "--hostname", "github.com"],
      cwd,
      { timeout: 30_000 },
    );
  } catch (error) {
    if (isMissingProgram(error))
      throw new CliMissing(
        "GitHub CLI (gh) is not installed or not on PATH. Install it from https://cli.github.com, restart Workstream, then sign in.",
      );
    throw error;
  }
  const token = result.stdout.trim();
  if (result.code !== 0 || !token)
    throw new SignInRequired(
      "GitHub CLI is not signed in. Use Sign in to GitHub.",
    );
  return token;
}

export async function githubSession(
  project: Pick<Project, "path" | "remote">,
  networkFetch: NetworkFetch,
  repository = true,
) {
  const repo = repository ? githubRepository(project.remote) : undefined;
  const token = await githubToken(project.path);
  const user: { login?: string; name?: string } = {};
  const api = async (path: string, method = "GET", body?: unknown) => {
    const response = await networkFetch(`https://api.github.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Workstream",
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    }).catch((error: unknown) => {
      throw networkError("GitHub", error);
    });
    if (!response.ok) {
      if (response.status === 401)
        throw new SignInRequired(
          "GitHub rejected the GitHub CLI login (401). Use Sign in to GitHub again.",
        );
      if (response.status === 403 || response.status === 404)
        throw new Error(
          `GitHub denied access (${response.status}) for ${user.login ?? "the signed-in account"}. GitHub reports private repositories you cannot see as 404. Check the account, organization SSO authorization, and repository permissions.`,
        );
      if (response.status === 422) {
        const detail = (await response.json().catch(() => ({}))) as {
          message?: string;
        };
        throw new Error(
          `GitHub refused the request (422)${detail.message ? `: ${detail.message.slice(0, 300)}` : ""}.`,
        );
      }
      throw new Error(
        `GitHub returned ${response.status}. Check the repository URL and connectivity before retrying.`,
      );
    }
    return response.json() as Promise<unknown>;
  };
  Object.assign(user, (await api("/user")) as typeof user);
  const base = repo
    ? `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repository)}`
    : "";
  return {
    repo,
    base,
    account: user.login,
    displayName: user.name ?? undefined,
    api,
    gitEnv: gitAuthEnv(
      project.remote,
      `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
    ),
  };
}
export type GitHubSession = Awaited<ReturnType<typeof githubSession>>;

export async function githubPermissions(
  project: Project,
  session: GitHubSession,
): Promise<RepositoryAccess> {
  const info = (await session.api(session.base)) as {
    permissions?: { pull?: boolean; push?: boolean };
  };
  const push =
    typeof info?.permissions?.push === "boolean" ? info.permissions.push : null;
  return accessResult(project, session.account, {
    read: info?.permissions?.pull ?? true,
    push,
    // Branch creation and same-repository PRs need write access on GitHub.
    createBranch: push,
    pullRequest: push,
  });
}

export async function githubAccount(
  cwd: string,
  networkFetch: NetworkFetch,
): Promise<ProviderAccount> {
  const checkedAt = new Date().toISOString();
  try {
    const session = await githubSession(
      { path: cwd, remote: "" },
      networkFetch,
      false,
    );
    return {
      provider: "github",
      cliInstalled: true,
      signedIn: true,
      account: session.account,
      displayName: session.displayName,
      checkedAt,
    };
  } catch (error) {
    return {
      provider: "github",
      cliInstalled: !(error instanceof CliMissing),
      signedIn: false,
      checkedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Runs GitHub CLI's browser (device code) sign-in. The one-time code is passed
 * to the UI; the user enters it on github.com. gh stores the credential.
 */
export async function loginGitHub(cwd: string, onCode: (code: string) => void) {
  let reported = false;
  let result: Awaited<ReturnType<typeof execute>>;
  try {
    result = await execute(
      "gh",
      [
        "auth",
        "login",
        "--hostname",
        "github.com",
        "--web",
        "--git-protocol",
        "https",
      ],
      cwd,
      {
        timeout: 10 * 60_000,
        onOutput: (output) => {
          const code = output.match(/\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/);
          if (code && !reported) {
            reported = true;
            onCode(code[1]);
          }
        },
      },
    );
  } catch (error) {
    if (isMissingProgram(error))
      throw new CliMissing(
        "GitHub CLI (gh) is not installed or not on PATH. Install it from https://cli.github.com.",
      );
    throw error;
  }
  if (result.code !== 0)
    throw new Error(
      "GitHub sign-in did not complete. Enter the code on github.com and try again.",
    );
}
