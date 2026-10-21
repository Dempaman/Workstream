import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { readFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import type { AgentMcpServer, ClaudeAuth, Profile, Runtime, TokenUsage, UsageBucket, UsageWindow } from "../shared/types";
import { execute, executable } from "./process";
import type { NetworkFetch } from "./hosting";
import { claudeUserMcpServers } from "./agentmcp";
import { isReadOnlyTool } from "./connectors";

/** Stores the Anthropic API key outside state.json (Electron safeStorage in the app). */
export interface SecretStore {
  get(): string | undefined;
  set(value: string | undefined): void;
}
type Sdk = typeof import("@anthropic-ai/claude-agent-sdk");
type Query = ReturnType<Sdk["query"]>;
type Thread = {
  mcp: AgentMcpServer[];
  /** The connected repository, for Claude Code's per-project ("local") MCP servers. */
  projectPath?: string;
  cwd: string;
  instructions: string;
  write: boolean;
  query?: Query;
  abort?: AbortController;
};
type Approval = {
  threadId: string;
  resolve: (allow: boolean, session: boolean) => void;
};
const efforts = ["low", "medium", "high", "xhigh", "max"];

/** Finds a runnable Claude Code executable. npm installs on Windows give a .cmd launcher that cannot be spawned safely. */
export function resolveClaudeExecutable(path: string) {
  const notInstalled = () =>
    new Error(
      `Claude Code was not found${/[\\/]/.test(path) ? ` at ${path}` : " on PATH"}. Install it with Install Claude Code, restart Workstream, then click Connect Claude.`,
    );
  if (/[\\/]/.test(path)) {
    if (!existsSync(path)) throw notInstalled();
    if (!/\.cmd$/i.test(path)) return path;
  }
  const found = executable(path);
  if (!/[\\/]/.test(found)) {
    // Not on PATH (for example installed after Workstream started): try the installer's default location.
    const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
    const fallback = join(home, ".local", "bin", process.platform === "win32" ? "claude.exe" : "claude");
    if (home && existsSync(fallback)) return fallback;
    throw notInstalled();
  }
  if (!/\.cmd$/i.test(found)) return found;
  const root = join(dirname(found), "node_modules", "@anthropic-ai", "claude-code");
  for (const candidate of [join(root, "bin", "claude.exe"), join(root, "cli.js")])
    if (existsSync(candidate)) return candidate;
  throw new Error(
    "Claude Code was found as a .cmd launcher only. Install it with the native installer (claude.exe) or enter the full path to claude.exe.",
  );
}

/**
 * Claude agent runtime built on the Claude Agent SDK. It mirrors the events of
 * the Codex runtime so the workflow treats both the same way: "changed",
 * "activity", "heartbeat", "usage", "turn", "approval", "approvalResolved".
 * Authentication is an Anthropic API key only.
 */
export class Claude extends EventEmitter {
  private threads = new Map<string, Thread>();
  private approvals = new Map<string, Approval>();
  private executablePath?: string;
  runtime: Runtime = {
    connected: false,
    authenticated: false,
    accountLabel: "Not connected",
    models: [],
  };
  constructor(
    private secrets: SecretStore,
    private networkFetch: NetworkFetch = fetch,
    private loadSdk: () => Promise<Pick<Sdk, "query">> = () =>
      import("@anthropic-ai/claude-agent-sdk"),
  ) {
    super();
  }
  get hasKey() {
    return Boolean(this.secrets.get());
  }
  setKey(key: string | undefined) {
    this.secrets.set(key?.trim() || undefined);
    this.runtime = {
      ...this.runtime,
      connected: false,
      authenticated: false,
      accountLabel: key ? "Key saved, not checked" : "No API key",
      models: key ? this.runtime.models : [],
      error: undefined,
    };
    this.emit("changed");
  }
  private mode: ClaudeAuth = "claude-code";
  /** Runs the configured Claude Code executable with fixed arguments. */
  private cli(args: string[], options: Parameters<typeof execute>[3] = {}) {
    const path = this.executablePath!;
    const js = /\.js$/i.test(path);
    return execute(js ? "node" : path, js ? [path, ...args] : args, process.cwd(), {
      timeout: 30_000,
      ...options,
      env: { ...options.env, ANTHROPIC_API_KEY: "" },
    });
  }
  /**
   * Validates the CLI and the sign-in and loads the model list. No model call
   * is made. "claude-code" uses the login stored by your installed Claude Code
   * (your own subscription); "api-key" uses an Anthropic API key.
   */
  async connect(path: string, mode: ClaudeAuth = this.mode) {
    this.mode = mode;
    try {
      const key = this.secrets.get();
      if (mode === "api-key" && !key)
        throw new Error("Add an Anthropic API key, or switch to your Claude Code sign-in.");
      this.executablePath = resolveClaudeExecutable(path);
      const version = await this.cli(["--version"]).catch(() => ({ code: -1, stdout: "" }));
      if (version.code !== 0)
        throw new Error(
          "Claude Code is not installed or the path is wrong. Install Claude Code, then enter claude or the full path to claude.exe.",
        );
      const cliVersion = version.stdout.trim().split(/\s/)[0] ?? "";
      if (mode === "claude-code") {
        const status = await this.cli(["auth", "status", "--json"]).catch(() => ({ code: -1, stdout: "" }));
        let parsed: { loggedIn?: boolean; email?: string; subscriptionType?: string; authMethod?: string; apiProvider?: string } = {};
        try {
          parsed = JSON.parse(status.stdout);
        } catch {
          /* handled below */
        }
        if (!parsed.loggedIn)
          throw new Error("Claude Code is not signed in. Click Sign in with Claude.");
        this.runtime = {
          connected: true,
          authenticated: true,
          accountLabel: [
            parsed.email ?? "Claude Code sign-in",
            parsed.subscriptionType && `${parsed.subscriptionType} plan`,
            parsed.apiProvider && parsed.apiProvider !== "firstParty" && parsed.apiProvider,
            `Claude Code ${cliVersion}`,
          ]
            .filter(Boolean)
            .join(" · "),
          // Aliases follow Claude Code's current models for your plan.
          models: [
            { id: "opus", name: "Opus (latest)", description: "opus", isDefault: false, efforts, defaultEffort: "high" },
            { id: "sonnet", name: "Sonnet (latest)", description: "sonnet", isDefault: true, efforts, defaultEffort: "high" },
            { id: "haiku", name: "Haiku (latest)", description: "haiku", isDefault: false, efforts, defaultEffort: "medium" },
          ],
        };
        this.emit("changed");
        return;
      }
      const response = await this.networkFetch(
        "https://api.anthropic.com/v1/models?limit=100",
        {
          headers: { "x-api-key": key!, "anthropic-version": "2023-06-01" },
          signal: AbortSignal.timeout(20_000),
        },
      ).catch(() => {
        throw new Error(
          "Anthropic API could not be reached. Check VPN, proxy and trusted certificates.",
        );
      });
      if (response.status === 401 || response.status === 403)
        throw new Error(
          `Anthropic rejected the API key (${response.status}). Check the key and its workspace.`,
        );
      if (!response.ok)
        throw new Error(`Anthropic API returned ${response.status}.`);
      const body = (await response.json()) as {
        data?: { id: string; display_name?: string }[];
      };
      const models = (body.data ?? []).map((model, index) => ({
        id: model.id,
        name: model.display_name ?? model.id,
        description: model.id,
        isDefault: index === 0,
        efforts,
        defaultEffort: "high",
      }));
      this.runtime = {
        connected: true,
        authenticated: true,
        accountLabel: `API key ···${key!.slice(-4)} · Claude Code ${cliVersion}`.trim(),
        models,
      };
    } catch (error) {
      this.runtime = {
        connected: false,
        authenticated: false,
        accountLabel: "Not connected",
        models: this.runtime.models,
        error: error instanceof Error ? error.message : String(error),
      };
      this.emit("changed");
      throw error;
    }
    this.emit("changed");
  }
  private usageCheckedAt = 0;
  /**
   * Reads your Claude plan's usage windows (5-hour, weekly, per model) the
   * same way Claude Code's /usage does. Starts Claude Code without sending a
   * prompt, so no tokens are used. The SDK marks this call experimental, so
   * failures are shown as "usage unavailable" rather than as errors.
   */
  async refreshUsage(force = false) {
    if (!this.runtime.connected || !this.executablePath) return;
    if (this.mode !== "claude-code") {
      this.runtime = { ...this.runtime, limits: [], limitsError: undefined, limitsUpdatedAt: undefined };
      return;
    }
    if (!force && Date.now() - this.usageCheckedAt < 4 * 60_000) return;
    this.usageCheckedAt = Date.now();
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 45_000);
    try {
      const { query } = await this.loadSdk();
      // Never yields: Claude Code starts and answers control requests, but no prompt is sent.
      const idle = {
        [Symbol.asyncIterator]: () => ({
          next: () =>
            new Promise<IteratorResult<never>>((resolve) =>
              abort.signal.addEventListener("abort", () =>
                resolve({ done: true, value: undefined }),
              ),
            ),
        }),
      };
      const session = query({
        prompt: idle as never,
        options: {
          cwd: homedir(),
          settingSources: [],
          pathToClaudeCodeExecutable: this.executablePath,
          ...(/\.js$/i.test(this.executablePath) ? { executable: "node" as const } : {}),
          abortController: abort,
          env: { ...process.env, ANTHROPIC_API_KEY: "", CLAUDE_AGENT_SDK_CLIENT_APP: "workstream" },
        },
      }) as Query & {
        usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET?: (opts: { skipBehaviors: boolean }) => Promise<unknown>;
      };
      const read = session.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
      if (!read) throw new Error("This Claude Code version cannot report plan usage.");
      const usage = (await read.call(session, { skipBehaviors: true })) as {
        subscription_type?: string | null;
        rate_limits_available?: boolean;
        rate_limits?: Record<string, unknown> | null;
      };
      this.runtime = {
        ...this.runtime,
        limits: claudeLimits(usage),
        limitsUpdatedAt: new Date().toISOString(),
        limitsError: usage.rate_limits_available === false ? "Claude did not report plan limits for this sign-in." : undefined,
      };
    } catch (error) {
      this.runtime = {
        ...this.runtime,
        limitsError: `Claude usage unavailable${error instanceof Error && error.message ? `: ${error.message.slice(0, 160)}` : ""}.`,
      };
    } finally {
      clearTimeout(timer);
      abort.abort();
      this.emit("changed");
    }
  }
  private loginInput?: { write(text: string): void; end(): void };
  /**
   * Runs Claude Code's own sign-in for your subscription. Claude Code opens
   * the browser itself. If it cannot, the page shows a code that you paste
   * into Workstream, which passes it to Claude Code. Runs in the background.
   */
  login(path: string) {
    if (this.runtime.login) throw new Error("A Claude sign-in is already in progress.");
    this.executablePath = resolveClaudeExecutable(path);
    this.runtime = { ...this.runtime, error: undefined, login: { awaitingCode: false } };
    this.emit("changed");
    let output = "";
    const done = this.cli(["auth", "login", "--claudeai"], {
      timeout: 10 * 60_000,
      onStdin: (writer) => (this.loginInput = writer),
      onOutput: (text) => {
        output += text;
        const url = output.match(/https:\/\/[^\s"'<>]+/)?.[0];
        const login = this.runtime.login;
        if (!login) return;
        const next = {
          url: url && /^https:\/\/([a-z0-9-]+\.)*(claude\.ai|claude\.com|anthropic\.com)\//i.test(url) ? url : login.url,
          awaitingCode: login.awaitingCode || /paste code/i.test(output),
        };
        if (next.url !== login.url || next.awaitingCode !== login.awaitingCode) {
          this.runtime = { ...this.runtime, login: next };
          this.emit("changed");
        }
      },
    });
    void done
      .then(async (result) => {
        this.loginInput = undefined;
        this.runtime = { ...this.runtime, login: undefined };
        if (result.code !== 0) throw new Error("Claude sign-in did not complete. Try again.");
        await this.connect(path, "claude-code");
        void this.refreshUsage(true);
      })
      .catch((error: unknown) => {
        this.loginInput = undefined;
        this.runtime = {
          ...this.runtime,
          login: undefined,
          error: error instanceof Error ? error.message : String(error),
        };
        this.emit("changed");
      });
  }
  submitLoginCode(code: string) {
    if (!this.loginInput || !this.runtime.login)
      throw new Error("No Claude sign-in is waiting for a code.");
    this.loginInput.write(`${code}\n`);
  }
  cancelLogin() {
    this.loginInput?.end();
  }
  async startThread(
    cwd: string,
    profile: Profile,
    instructions: string,
    write: boolean,
    mcp: AgentMcpServer[] = [],
    projectPath?: string,
  ) {
    if (!this.runtime.authenticated)
      throw new Error("Connect Claude in Agents & models before running a Claude agent.");
    if (profile.model && !this.runtime.models.some((m) => m.id === profile.model))
      throw new Error("Choose an available Claude model in Agents & models.");
    const id = randomUUID();
    this.threads.set(id, { cwd, instructions, write, mcp, projectPath });
    return id;
  }
  async run(
    threadId: string,
    prompt: string,
    schema: unknown,
    profile: Profile,
    images: string[] = [],
  ) {
    const thread = this.threads.get(threadId);
    if (!thread) throw new Error("Claude session not found.");
    const key = this.secrets.get();
    if ((this.mode === "api-key" && !key) || !this.executablePath)
      throw new Error("Connect Claude in Agents & models first.");
    const { query } = await this.loadSdk();
    const content: unknown[] = [{ type: "text", text: prompt }];
    for (const path of images) {
      const ext = extname(path).toLowerCase();
      const media =
        ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: media,
          data: (await readFile(path)).toString("base64"),
        },
      });
    }
    async function* input() {
      yield {
        type: "user" as const,
        message: { role: "user" as const, content },
        parent_tool_use_id: null,
      };
    }
    thread.abort = new AbortController();
    const seen = new Map<string, TokenUsage>();
    let answeredBy: string | undefined;
    let reportedCostUsd: number | undefined;
    const report = () => {
      const total = [...seen.values()].reduce(
        (sum, u) => ({
          totalTokens: sum.totalTokens + u.totalTokens,
          inputTokens: sum.inputTokens + u.inputTokens,
          cachedInputTokens: sum.cachedInputTokens + u.cachedInputTokens,
          outputTokens: sum.outputTokens + u.outputTokens,
          reasoningOutputTokens: 0,
          cacheWriteTokens: (sum.cacheWriteTokens ?? 0) + (u.cacheWriteTokens ?? 0),
        }),
        { totalTokens: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, cacheWriteTokens: 0 },
      );
      this.emit("usage", threadId, {
        ...total,
        ...(answeredBy ? { model: answeredBy } : {}),
        ...(reportedCostUsd !== undefined ? { reportedCostUsd } : {}),
      });
    };
    const model =
      profile.model || this.runtime.models.find((m) => m.isDefault)?.id;
    // MCP servers you added to Claude Code yourself (for example Figma). Workstream
    // connectors keep their own names; read-only tools only (checked in canUseTool).
    const ownNames = new Set(thread.mcp.map((server) => server.name));
    const userServers = Object.fromEntries(
      Object.entries(await claudeUserMcpServers(undefined, thread.projectPath)).filter(([name]) => !ownNames.has(name)),
    );
    const userTool = (tool: string) => {
      const server = Object.keys(userServers).find((name) => tool.startsWith(`mcp__${name}__`));
      return server ? tool.slice(`mcp__${server}__`.length) : undefined;
    };
    const session = query({
      prompt: input() as never,
      options: {
        cwd: thread.cwd,
        model,
        effort: efforts.includes(profile.effort)
          ? (profile.effort as "high")
          : "high",
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: thread.instructions,
        },
        // Repository settings and CLAUDE.md apply; the user's personal permission rules do not.
        settingSources: ["project"],
        permissionMode: thread.write ? "acceptEdits" : "default",
        // Connector tools are already limited to read-only by Workstream's proxy.
        mcpServers: {
          ...userServers,
          ...Object.fromEntries(
            thread.mcp.map((server) => [
              server.name,
              { type: "http" as const, url: server.url, headers: server.headers },
            ]),
          ),
        },
        allowedTools: thread.mcp.map((server) => `mcp__${server.name}`),
        disallowedTools: thread.write
          ? []
          : ["Write", "Edit", "MultiEdit", "NotebookEdit"],
        outputFormat: { type: "json_schema", schema: forClaudeCode(schema) },
        pathToClaudeCodeExecutable: this.executablePath,
        ...(/\.js$/i.test(this.executablePath) ? { executable: "node" as const } : {}),
        abortController: thread.abort,
        env: {
          ...process.env,
          // Empty means Claude Code uses its own stored sign-in.
          ANTHROPIC_API_KEY: this.mode === "api-key" ? key : "",
          CLAUDE_AGENT_SDK_CLIENT_APP: "workstream",
        },
        canUseTool: (toolName, toolInput, options) => {
          const own = userTool(toolName);
          if (own !== undefined)
            // Your own Claude Code connectors: reading is fine, anything that writes is refused.
            return Promise.resolve(
              isReadOnlyTool({ name: own })
                ? { behavior: "allow" as const, updatedInput: toolInput }
                : {
                    behavior: "deny" as const,
                    message: `Workstream agents may only read through ${toolName.split("__")[1]}. "${own}" can change data, so it is not allowed.`,
                  },
            );
          return new Promise((resolve) => {
            const id = randomUUID();
            const done = (allow: boolean, sessionWide: boolean) => {
              this.approvals.delete(id);
              this.emit("approvalResolved", id);
              resolve(
                allow
                  ? {
                      behavior: "allow",
                      updatedInput: toolInput,
                      ...(sessionWide && options.suggestions
                        ? { updatedPermissions: options.suggestions }
                        : {}),
                    }
                  : { behavior: "deny", message: "The user declined this request in Workstream." },
              );
            };
            this.approvals.set(id, { threadId, resolve: done });
            options.signal.addEventListener("abort", () => done(false, false));
            this.emit("approval", {
              id,
              method: `claude/${toolName}`,
              params: {
                threadId,
                tool: toolName,
                input: toolInput,
                ...(options.blockedPath ? { blockedPath: options.blockedPath } : {}),
                availableDecisions: options.suggestions?.length
                  ? ["accept", "acceptForSession", "decline"]
                  : ["accept", "decline"],
              },
            });
          });
        },
      },
    });
    thread.query = session;
    this.emit("turn", threadId, threadId);
    try {
      for await (const message of session) {
        this.emit("heartbeat", threadId);
        if (message.type === "assistant") {
          const msg = message.message as {
            id?: string;
            model?: string;
            content?: { type: string; text?: string; name?: string; input?: Record<string, unknown> }[];
            usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
          };
          for (const block of msg.content ?? []) {
            if (block.type === "text" && block.text?.trim())
              this.emit("activity", threadId, block.text);
            if (block.type === "tool_use")
              this.emit(
                "activity",
                threadId,
                block.name === "Bash"
                  ? `Running: ${String(block.input?.command ?? "command").slice(0, 300)}`
                  : `Using ${block.name}${block.input?.file_path ? `: ${String(block.input.file_path)}` : ""}`,
              );
          }
          if (msg.usage && msg.id) {
            const cached = msg.usage.cache_read_input_tokens ?? 0;
            const input = (msg.usage.input_tokens ?? 0) + cached + (msg.usage.cache_creation_input_tokens ?? 0);
            const output = msg.usage.output_tokens ?? 0;
            if (msg.model) answeredBy = msg.model;
            seen.set(msg.id, {
              cacheWriteTokens: msg.usage.cache_creation_input_tokens ?? 0,
              totalTokens: input + output,
              inputTokens: input,
              cachedInputTokens: cached,
              outputTokens: output,
              reasoningOutputTokens: 0,
            });
            report();
          }
        }
        if (message.type === "system" && message.subtype === "init") {
          const servers = (message as { mcp_servers?: { name: string; status: string }[] }).mcp_servers ?? [];
          if (servers.length)
            this.emit(
              "activity",
              threadId,
              `MCP servers for this agent: ${servers.map((server) => `${server.name} (${server.status})`).join(", ")}`,
            );
        }
        if (message.type === "system" && message.subtype === "api_retry") {
          const retry = message as unknown as { attempt?: number; error_status?: number | null };
          if (retry.error_status === 401 || retry.error_status === 403) {
            thread.abort.abort();
            throw new Error(
              this.mode === "api-key"
                ? `Anthropic rejected the API key (${retry.error_status}). Update the key in Agents & models, then retry the stage.`
                : `Claude rejected the Claude Code sign-in (${retry.error_status}). Click Sign in with Claude in Agents & models, then retry the stage.`,
            );
          }
          this.emit(
            "activity",
            threadId,
            `Anthropic API unavailable${retry.error_status ? ` (${retry.error_status})` : ""}. Retrying, attempt ${retry.attempt ?? "?"}.`,
          );
        }
        if (message.type === "result") {
          // Claude's own figure at API prices (not what a Claude subscription charges).
          const cost = (message as { total_cost_usd?: unknown }).total_cost_usd;
          if (typeof cost === "number" && Number.isFinite(cost) && cost >= 0) {
            reportedCostUsd = cost;
            report();
          }
          if (message.subtype !== "success" || message.is_error) {
            const detail =
              message.subtype === "success"
                ? String((message as { result?: unknown }).result ?? "").slice(0, 400)
                : message.subtype;
            throw new Error(
              `Claude stopped before finishing${detail ? `: ${detail}` : ""}. Its work in the worktree is preserved; retry the stage.`,
            );
          }
          if (message.structured_output === undefined)
            throw new Error("Claude did not return the required structured result.");
          return JSON.stringify(message.structured_output);
        }
      }
      throw new Error("Claude ended the session without a result.");
    } finally {
      for (const approval of [...this.approvals.values()])
        if (approval.threadId === threadId) approval.resolve(false, false);
      thread.query = undefined;
      this.emit("resolved", threadId);
    }
  }
  owns(threadId: string) {
    return this.threads.has(threadId);
  }
  ownsApproval(id: string) {
    return this.approvals.has(id);
  }
  async interrupt(threadId: string) {
    const thread = this.threads.get(threadId);
    if (!thread?.query) return;
    await thread.query.interrupt().catch(() => thread.abort?.abort());
  }
  respond(id: string | number, accept: boolean, session = false) {
    this.approvals.get(String(id))?.resolve(accept, session);
  }
  close() {
    this.cancelLogin();
    for (const thread of this.threads.values()) thread.abort?.abort();
    for (const approval of [...this.approvals.values()]) approval.resolve(false, false);
    this.runtime = { ...this.runtime, connected: false };
    this.emit("changed");
  }
}

export const memorySecrets = (): SecretStore => {
  let value: string | undefined;
  return { get: () => value, set: (next) => (value = next) };
};

type ClaudeWindow = { utilization?: number | null; resets_at?: string | null } | null | undefined;
const claudeWindow = (value: ClaudeWindow, minutes: number): UsageWindow | null =>
  value && typeof value.utilization === "number"
    ? {
        usedPercent: value.utilization,
        windowDurationMins: minutes,
        resetsAt: value.resets_at ? Math.floor(Date.parse(value.resets_at) / 1000) : null,
      }
    : null;
/** Maps Claude Code's /usage data to the same buckets the Codex usage panel shows. */
export function claudeLimits(usage: {
  subscription_type?: string | null;
  rate_limits?: Record<string, unknown> | null;
}): UsageBucket[] {
  const limits = (usage.rate_limits ?? {}) as Record<string, ClaudeWindow> & {
    model_scoped?: { display_name: string; utilization: number | null; resets_at: string | null }[];
  };
  const plan = usage.subscription_type ? `Claude ${usage.subscription_type} plan` : "Claude plan";
  const buckets: UsageBucket[] = [];
  const main = { primary: claudeWindow(limits.five_hour, 300), secondary: claudeWindow(limits.seven_day, 10080) };
  if (main.primary || main.secondary) buckets.push({ id: "claude", name: plan, ...main });
  for (const [key, label] of [["seven_day_opus", "Opus"], ["seven_day_sonnet", "Sonnet"]] as const) {
    const window = claudeWindow(limits[key], 10080);
    if (window) buckets.push({ id: `claude-${key}`, name: `${label} (weekly)`, primary: window, secondary: null });
  }
  for (const model of limits.model_scoped ?? []) {
    const window = claudeWindow(model, 10080);
    if (window && !buckets.some((b) => b.name.startsWith(model.display_name)))
      buckets.push({ id: `claude-model-${model.display_name}`, name: `${model.display_name} (weekly)`, primary: window, secondary: null });
  }
  return buckets;
}

/**
 * Zod writes "$schema": draft 2020-12, which Claude Code's --json-schema
 * validator does not recognise (Codex accepts it). The keywords our schemas
 * use are the same in both drafts, so the declaration is simply removed.
 */
export function forClaudeCode(schema: unknown): Record<string, unknown> {
  const copy = JSON.parse(JSON.stringify(schema ?? {})) as Record<string, unknown>;
  const strip = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    delete (node as Record<string, unknown>).$schema;
    for (const value of Object.values(node)) strip(value);
  };
  strip(copy);
  return copy;
}
