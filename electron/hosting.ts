// Shared helpers for Git hosting providers (Azure DevOps, GitHub).
// Tokens only live in memory for the duration of one operation. They are never saved or logged.

export type NetworkFetch = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

export const tenantIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The provider CLI (az or gh) is not installed or not on PATH. */
export class CliMissing extends Error {}
/** The provider CLI has no usable sign-in for the requested account or tenant. */
export class SignInRequired extends Error {}

export const isMissingProgram = (error: unknown, stderr = "") =>
  (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT" ||
  /is not recognized as (?:the name|an internal)|command not found|No such file or directory/i.test(
    stderr,
  );

/** Reads display claims from a JWT access token. No signature check: display only, never used for authorization. */
export function tokenClaims(token: string): Record<string, unknown> {
  try {
    const payload = token.split(".")[1];
    if (!payload) return {};
    return JSON.parse(
      Buffer.from(
        payload.replace(/-/g, "+").replace(/_/g, "/"),
        "base64",
      ).toString("utf8"),
    ) as Record<string, unknown>;
  } catch {
    return {};
  }
}
export const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

/**
 * Git configuration passed through the environment (Git 2.31+), so the token
 * never appears in command-line arguments or the process list.
 * The credential helper is cleared so Git Credential Manager cannot silently
 * substitute a different cached account. SSH remotes are left unchanged.
 */
export function gitAuthEnv(
  remote: string,
  header: string,
): Record<string, string> {
  if (!/^https:\/\//i.test(remote)) return {};
  return {
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "credential.helper",
    GIT_CONFIG_VALUE_0: "",
    GIT_CONFIG_KEY_1: "http.extraHeader",
    GIT_CONFIG_VALUE_1: header,
  };
}
export const pushAuthFor = (remote: string) =>
  /^https:\/\//i.test(remote)
    ? ("cli-token" as const)
    : /^(?:ssh:\/\/|[^@/]+@)/.test(remote)
      ? ("ssh" as const)
      : ("none" as const);

export function networkError(service: string, error: unknown) {
  const cause =
    (error as { cause?: { code?: string }; code?: string })?.cause?.code ??
    (error as { code?: string })?.code ??
    (error instanceof Error
      ? error.message.match(/\b(ERR_[A-Z0-9_]+)\b/)?.[1]
      : undefined);
  return new Error(
    `${service} network request failed${cause && /^[A-Z0-9_]+$/.test(cause) ? ` (${cause})` : ""}. Check VPN, proxy and trusted certificates. This is not proof that login is missing; retry after connectivity is restored.`,
  );
}

export const providerForRemote = (remote: string) =>
  /dev\.azure\.com|visualstudio\.com/i.test(remote)
    ? ("azure" as const)
    : /github\.com/i.test(remote)
      ? ("github" as const)
      : ("other" as const);
