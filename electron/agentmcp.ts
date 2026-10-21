import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentMcpEntry, AgentMcpReport, Engine } from "../shared/types";

/**
 * Reads which MCP servers Claude Code and Codex have in their own settings
 * (for example Figma, signed in with your account in those tools), using
 * their own CLIs. Nothing is changed and no tokens are read or shown.
 */
function run(exe: string, args: string[], cwd = homedir(), timeoutMs = 90_000) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(exe, args, {
      cwd,
      windowsHide: true,
      shell: false,
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout = (stdout + d.toString()).slice(-200_000)));
    child.stderr.on("data", (d: Buffer) => (stderr = (stderr + d.toString()).slice(-20_000)));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("The check timed out."));
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

/** Parses `claude mcp list`: "figma: https://mcp.figma.com/mcp (HTTP) - ✓ Connected". */
export function parseClaudeMcpList(output: string): AgentMcpEntry[] {
  const entries: AgentMcpEntry[] = [];
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    // Names can contain colons (plugin servers: "plugin:figma:figma: https://...").
    const match = line.match(/^(\S.*?):\s+(\S.*?)\s+-\s+(.+)$/);
    if (!match) continue;
    const [, name, target, status] = match;
    const url = target.match(/https?:\/\/\S+/)?.[0];
    const state: AgentMcpEntry["state"] = /needs auth|authenticat/i.test(status)
      ? "needs-auth"
      : /failed|error|×|✗/i.test(status)
        ? "failed"
        : /connected|✓|✔/i.test(status)
          ? "connected"
          : "unknown";
    const plugin = name.startsWith("plugin:");
    entries.push({
      name: name.trim(),
      url,
      state,
      detail: plugin
        ? "From a Claude Code plugin. Workstream's Claude agents cannot use plugin servers; add the server with claude mcp add --scope user to share it."
        : status.replace(/^[^\p{L}]+/u, "").slice(0, 200),
    });
  }
  return entries;
}

/** Parses `codex mcp list --json`. auth_status: o_auth / bearer_token / not_logged_in / unsupported. */
export function parseCodexMcpList(output: string): AgentMcpEntry[] {
  const start = output.indexOf("[");
  if (start < 0) return [];
  const list = JSON.parse(output.slice(start)) as {
    name?: string;
    enabled?: boolean;
    transport?: { url?: string; command?: string };
    auth_status?: string;
  }[];
  return list
    .filter((server) => typeof server.name === "string")
    .map((server) => {
      const auth = String(server.auth_status ?? "").toLowerCase().replace(/[^a-z]/g, "");
      const state: AgentMcpEntry["state"] =
        server.enabled === false
          ? "disabled"
          : auth === "oauth" || auth === "bearertoken"
            ? "signed-in"
            : auth === "notloggedin"
              ? "needs-auth"
              : auth === "unsupported"
                ? "configured"
                : "unknown";
      return {
        name: server.name!,
        url: server.transport?.url,
        state,
        detail:
          state === "signed-in"
            ? auth === "oauth" ? "Signed in (OAuth)" : "Token configured"
            : state === "needs-auth"
              ? "Not signed in. Run: codex mcp login " + server.name
              : state === "disabled"
                ? "Disabled in Codex"
                : state === "configured"
                  ? "No sign-in needed"
                  : "Sign-in status unknown",
      };
    });
}

/**
 * Parses Codex app-server's mcpServerStatus/list and app/list: what Codex agents
 * actually get, including servers from Codex plugins and connected apps, which
 * `codex mcp list` (config.toml only) does not show.
 */
export function parseCodexRuntime(status: unknown, apps?: unknown): AgentMcpEntry[] {
  type Server = {
    name?: string;
    pluginId?: string | null;
    httpOrigin?: string | null;
    tools?: Record<string, unknown> | unknown[] | null;
    toolsError?: string | null;
    authStatus?: string | null;
  };
  const list = ((status as { data?: Server[] })?.data ?? []).filter((s) => typeof s.name === "string");
  const entries: AgentMcpEntry[] = list.map((server) => {
    const names = Array.isArray(server.tools)
      ? (server.tools as { name?: string }[]).map((tool) => tool?.name ?? "").filter(Boolean)
      : Object.keys(server.tools ?? {});
    const tools = Array.isArray(server.tools) ? server.tools.length : names.length;
    const auth = String(server.authStatus ?? "").toLowerCase().replace(/[^a-z]/g, "");
    const state: AgentMcpEntry["state"] =
      auth === "notloggedin"
        ? "needs-auth"
        : tools > 0
          ? "connected"
          : server.toolsError
            ? "failed"
            : auth === "oauth" || auth === "bearertoken"
              ? "signed-in"
              : "unknown";
    return {
      name: server.pluginId ? `${server.name} (plugin ${server.pluginId})` : server.name!,
      url: server.httpOrigin ?? undefined,
      state,
      detail:
        state === "connected"
          ? `${tools} tool${tools === 1 ? "" : "s"} available${names.length ? `: ${names.slice(0, 6).join(", ")}${names.length > 6 ? "…" : ""}` : ""}`
          : state === "needs-auth"
            ? `Not signed in. Sign in to ${server.name} in Codex.`
            : state === "failed"
              ? String(server.toolsError).slice(0, 200)
              : undefined,
    };
  });
  // Apps you connected in Codex (ChatGPT apps such as Figma) reach agents through
  // the codex_apps server. Only connected ones are listed (the catalogue is long).
  type App = { id?: string; name?: string; isAccessible?: boolean; isEnabled?: boolean };
  const seen = new Set<string>();
  for (const app of ((apps as { data?: App[] })?.data ?? [])) {
    const name = app.name ?? app.id;
    if (!name || app.isAccessible !== true) continue;
    seen.add(name.toLowerCase());
    entries.push({
      name: `${name} (app)`,
      state: app.isEnabled === false ? "disabled" : "connected",
      detail: app.isEnabled === false ? "Connected but turned off in Codex" : "Connected app, used through codex_apps",
    });
  }
  // Also read the app tools codex_apps offers right now, grouped by connector.
  const counts = new Map<string, number>();
  for (const server of list) {
    const tools = Array.isArray(server.tools) ? server.tools : Object.values(server.tools ?? {});
    for (const tool of tools as { _meta?: Record<string, unknown>; meta?: Record<string, unknown> }[]) {
      const meta = tool?._meta ?? tool?.meta;
      const connector = meta?.connector_name ?? meta?.connectorName;
      if (typeof connector === "string" && connector) counts.set(connector, (counts.get(connector) ?? 0) + 1);
    }
  }
  for (const [name, count] of counts) {
    if (seen.has(name.toLowerCase())) continue;
    entries.push({ name: `${name} (app)`, state: "connected", detail: `${count} tool${count === 1 ? "" : "s"} through codex_apps` });
  }
  return entries;
}

export async function checkAgentMcp(engine: Engine, exe: string, cwd?: string): Promise<AgentMcpReport> {
  const checkedAt = new Date().toISOString();
  try {
    if (engine === "claude") {
      const result = await run(exe, ["mcp", "list"], cwd);
      if (result.code !== 0 && !result.stdout.trim())
        throw new Error(result.stderr.trim().slice(0, 300) || "claude mcp list failed");
      return { engine, checkedAt, servers: parseClaudeMcpList(result.stdout) };
    }
    const result = await run(exe, ["mcp", "list", "--json"], cwd);
    if (result.code !== 0) throw new Error(result.stderr.trim().slice(0, 300) || "codex mcp list failed");
    return { engine, checkedAt, servers: parseCodexMcpList(result.stdout) };
  } catch (error) {
    return {
      engine,
      checkedAt,
      servers: [],
      error: error instanceof Error ? error.message.slice(0, 300) : String(error),
    };
  }
}

/**
 * Remote MCP servers you added to Claude Code for your user ("claude mcp add
 * --scope user"), read from ~/.claude.json. Workstream's Claude agents run with
 * project settings only, so these are passed to them explicitly. Only http/sse
 * servers are taken; nothing local is started on your behalf.
 */
export async function claudeUserMcpServers(home = homedir(), projectPath?: string) {
  type Entry = { type?: string; url?: string; headers?: Record<string, string> };
  try {
    const config = JSON.parse(await readFile(join(home, ".claude.json"), "utf8")) as {
      mcpServers?: Record<string, Entry>;
      projects?: Record<string, { mcpServers?: Record<string, Entry> }>;
    };
    // User scope, plus "local" scope (claude mcp add's default) for this repository.
    const norm = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    const local = projectPath
      ? Object.entries(config.projects ?? {}).find(([path]) => norm(path) === norm(projectPath))?.[1]?.mcpServers
      : undefined;
    const servers: Record<string, { type: "http" | "sse"; url: string; headers?: Record<string, string> }> = {};
    for (const [name, server] of Object.entries({ ...(config.mcpServers ?? {}), ...(local ?? {}) })) {
      if ((server.type === "http" || server.type === "sse") && typeof server.url === "string" && /^[A-Za-z0-9_-]+$/.test(name))
        servers[name] = { type: server.type, url: server.url, ...(server.headers ? { headers: server.headers } : {}) };
    }
    return servers;
  } catch {
    return {};
  }
}
