import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { AgentMcpServer, Model, Profile, Runtime, TokenUsage, UsageBucket } from "../shared/types";
import { nanoAiuToUsd } from "../shared/pricing";

type Sdk = typeof import("@github/copilot-sdk");
type Client = InstanceType<Sdk["CopilotClient"]>;
type Session = Awaited<ReturnType<Client["createSession"]>>;
type Thread = {
  cwd: string;
  instructions: string;
  write: boolean;
  mcp: AgentMcpServer[];
  session?: Session;
};
type Approval = { threadId: string; resolve: (allow: boolean, session: boolean) => void };
type Decision =
  | { kind: "approve-once" }
  | { kind: "approve-for-session" }
  | { kind: "reject"; feedback?: string };

/**
 * GitHub Copilot through the official Copilot SDK. Workstream ships the
 * Copilot runtime (resources/copilot-runtime) so nothing extra is installed.
 * Sign-in is your GitHub account: the runtime uses a Copilot login it already
 * has, or the GitHub CLI (gh) sign-in. Emits the same events as Codex and
 * Claude: "changed", "activity", "heartbeat", "usage", "turn", "approval",
 * "approvalResolved", "resolved".
 */
export class Copilot extends EventEmitter {
  private client?: Client;
  private threads = new Map<string, Thread>();
  private approvals = new Map<string, Approval>();
  private usageCheckedAt = 0;
  runtime: Runtime = {
    connected: false,
    authenticated: false,
    accountLabel: "Not connected",
    models: [],
  };
  constructor(
    private bundledRuntime: () => string | undefined = defaultBundledRuntime,
    private loadSdk: () => Promise<Sdk> = () => import("@github/copilot-sdk"),
  ) {
    super();
  }

  /** Starts the Copilot runtime, checks the GitHub sign-in and loads the models your plan allows. No model call is made. */
  async connect(path?: string) {
    try {
      if (!this.client) {
        const { CopilotClient, RuntimeConnection } = await this.loadSdk();
        const exe = path?.trim() || this.bundledRuntime();
        this.client = new CopilotClient({
          ...(exe ? { connection: RuntimeConnection.forStdio({ path: exe }) } : {}),
          useLoggedInUser: true,
          logLevel: "error",
        });
        await this.client.start();
      }
      const auth = await this.client.getAuthStatus();
      if (!auth.isAuthenticated) {
        this.runtime = {
          ...this.runtime,
          connected: true,
          authenticated: false,
          accountLabel: "Not signed in",
          models: [],
          error:
            "Copilot is not signed in. Sign in to GitHub (Git providers, or Sign in with GitHub here), then click Refresh connection. Your GitHub account needs a Copilot plan.",
        };
        this.emit("changed");
        return;
      }
      const models = await this.client.listModels();
      this.runtime = {
        ...this.runtime,
        connected: true,
        authenticated: true,
        accountLabel: auth.login ?? "Signed in",
        models: copilotModels(models),
        error: undefined,
      };
      void this.refreshUsage(true);
    } catch (error) {
      await this.client?.forceStop().catch(() => {});
      this.client = undefined;
      this.runtime = {
        ...this.runtime,
        connected: false,
        authenticated: false,
        accountLabel: "Not connected",
        models: [],
        error: `GitHub Copilot could not start: ${error instanceof Error ? error.message.slice(0, 300) : String(error)}`,
      };
    }
    this.emit("changed");
  }

  /** Premium request allowance for this month, shown in Usage remaining. */
  async refreshUsage(force = false) {
    if (!this.client || !this.runtime.authenticated) return;
    if (!force && Date.now() - this.usageCheckedAt < 4 * 60_000) return;
    this.usageCheckedAt = Date.now();
    try {
      const quota = await this.client.rpc.account.getQuota({});
      this.runtime = {
        ...this.runtime,
        limits: copilotLimits(quota.quotaSnapshots),
        limitsUpdatedAt: new Date().toISOString(),
        limitsError: undefined,
      };
    } catch (error) {
      this.runtime = {
        ...this.runtime,
        limitsError: `Copilot usage is not available: ${error instanceof Error ? error.message.slice(0, 200) : String(error)}`,
      };
    }
    this.emit("changed");
  }

  async startThread(
    cwd: string,
    profile: Profile,
    instructions: string,
    write: boolean,
    mcp: AgentMcpServer[] = [],
  ) {
    if (!this.runtime.authenticated)
      throw new Error("Connect GitHub Copilot in Agents & models before running a Copilot agent.");
    if (profile.model && !this.runtime.models.some((m) => m.id === profile.model))
      throw new Error("Choose an available Copilot model in Agents & models.");
    const id = randomUUID();
    this.threads.set(id, { cwd, instructions, write, mcp });
    return id;
  }

  async run(threadId: string, prompt: string, schema: unknown, profile: Profile, images: string[] = []) {
    const thread = this.threads.get(threadId);
    if (!thread || !this.client) throw new Error("Copilot session not found. Reconnect Copilot and retry the stage.");
    const model = this.runtime.models.find((m) => m.id === profile.model) ?? this.runtime.models.find((m) => m.isDefault);
    const own = new Set(thread.mcp.map((server) => server.name));
    const session = await this.client.createSession({
      ...(model ? { model: model.id } : {}),
      ...(model?.efforts.includes(profile.effort) ? { reasoningEffort: profile.effort as "high" } : {}),
      workingDirectory: thread.cwd,
      systemMessage: { mode: "append", content: thread.instructions },
      enableSessionStore: false,
      // Workstream's connector proxy only offers read-only tools.
      mcpServers: Object.fromEntries(
        thread.mcp.map((server) => [
          server.name,
          { type: "http" as const, url: server.url, headers: server.headers, tools: ["*"] },
        ]),
      ),
      onPermissionRequest: (request) => this.decide(threadId, thread, own, request as unknown as Record<string, unknown>),
    });
    thread.session = session;
    this.emit("turn", threadId, threadId);
    const totals: TokenUsage = { totalTokens: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 };
    let nanoAiu = 0;
    const off = session.on((event) => {
      this.emit("heartbeat", threadId);
      const data = (event as { data?: Record<string, unknown> }).data ?? {};
      if (event.type === "assistant.message" && typeof data.content === "string" && data.content.trim())
        this.emit("activity", threadId, data.content.slice(0, 3000));
      if (event.type === "tool.execution_start") {
        const name = String(data.mcpToolName ?? data.toolName ?? "tool");
        const args = (data.arguments ?? {}) as Record<string, unknown>;
        const detail = args.command ?? args.path ?? args.file_path ?? "";
        this.emit("activity", threadId, `Using ${data.mcpServerName ? `${String(data.mcpServerName)}: ` : ""}${name}${detail ? `: ${String(detail).slice(0, 300)}` : ""}`);
      }
      if (event.type === "assistant.usage") {
        const input = Number(data.inputTokens ?? 0);
        const cached = Number(data.cacheReadTokens ?? 0);
        const output = Number(data.outputTokens ?? 0);
        const writes = Number(data.cacheWriteTokens ?? 0);
        totals.inputTokens += input + cached + writes;
        totals.cachedInputTokens += cached;
        totals.cacheWriteTokens = (totals.cacheWriteTokens ?? 0) + writes;
        if (typeof data.model === "string" && data.model) totals.model = data.model;
        // What Copilot charged in AI credits (nano-AIU), when the runtime reports it.
        const nano = Number((data.copilotUsage as { totalNanoAiu?: unknown } | undefined)?.totalNanoAiu);
        if (Number.isFinite(nano) && nano >= 0) {
          nanoAiu += nano;
          totals.reportedCostUsd = nanoAiuToUsd(nanoAiu);
        }
        totals.outputTokens += output;
        totals.totalTokens = totals.inputTokens + totals.outputTokens;
        this.emit("usage", threadId, { ...totals });
      }
    });
    try {
      const attachments = images.map((path) => ({ type: "file" as const, path }));
      const message = await session.sendAndWait(
        { prompt, ...(attachments.length ? { attachments } : {}), responseSchema: schema as Record<string, unknown> },
        24 * 60 * 60_000,
      );
      const content = (message as { data?: { content?: unknown } } | undefined)?.data?.content;
      if (typeof content !== "string" || !content.trim())
        throw new Error("Copilot ended the session without a result.");
      return extractJson(content);
    } finally {
      off();
      for (const approval of [...this.approvals.values()])
        if (approval.threadId === threadId) approval.resolve(false, false);
      thread.session = undefined;
      await session.disconnect().catch(() => {});
      this.emit("resolved", threadId);
      void this.refreshUsage(true);
    }
  }

  /**
   * Workstream's rules for Copilot's permission requests: reads are fine,
   * file writes only for the developer inside its worktree, your own Copilot
   * MCP servers only through read-only tools, and anything else (shell
   * commands, web fetches) goes to you as an approval.
   */
  private decide(threadId: string, thread: Thread, own: Set<string>, request: Record<string, unknown>): Decision | Promise<Decision> {
    const kind = String(request.kind ?? "");
    if (kind === "read") return { kind: "approve-once" };
    if (kind === "write") {
      if (!thread.write) return { kind: "reject", feedback: "This stage is read-only. Do not edit files." };
      const file = String(request.fileName ?? "");
      if (file && inside(thread.cwd, file)) return { kind: "approve-once" };
    }
    if (kind === "mcp") {
      const server = String(request.serverName ?? "");
      if (own.has(server)) return { kind: "approve-once" };
      return request.readOnly === true
        ? { kind: "approve-once" }
        : { kind: "reject", feedback: `Workstream agents may only read through ${server}; "${String(request.toolName ?? "this tool")}" can change data.` };
    }
    if (kind === "memory")
      return { kind: "reject", feedback: "Workstream keeps project memory itself. Do not store memories." };
    const id = randomUUID();
    const canSession = request.canOfferSessionApproval === true;
    return new Promise<Decision>((done) => {
      this.approvals.set(id, {
        threadId,
        resolve: (allow, session) => {
          this.approvals.delete(id);
          this.emit("approvalResolved", id);
          done(allow ? { kind: session && canSession ? "approve-for-session" : "approve-once" } : { kind: "reject", feedback: "The user declined this request in Workstream." });
        },
      });
      this.emit("approval", {
        id,
        method: `copilot/${kind || "request"}`,
        params: {
          threadId,
          tool: kind === "shell" ? "Command" : kind === "write" ? "File change" : kind === "url" ? "Web request" : kind,
          command: String(request.fullCommandText ?? request.url ?? request.fileName ?? request.toolName ?? ""),
          input: { description: String(request.intention ?? "") },
          availableDecisions: canSession ? ["accept", "acceptForSession", "decline"] : ["accept", "decline"],
        },
      });
    });
  }

  owns(threadId: string) {
    return this.threads.has(threadId);
  }
  async interrupt(threadId: string) {
    await this.threads.get(threadId)?.session?.abort().catch(() => {});
  }
  respond(id: string | number, accept: boolean, session = false) {
    this.approvals.get(String(id))?.resolve(accept, session);
  }
  close() {
    for (const approval of [...this.approvals.values()]) approval.resolve(false, false);
    void this.client?.stop().catch(() => {});
    this.client = undefined;
    this.runtime = { ...this.runtime, connected: false };
    this.emit("changed");
  }
}

/** The runtime shipped with Workstream (electron-builder extraResources). */
function defaultBundledRuntime() {
  const base = (process as { resourcesPath?: string }).resourcesPath;
  if (!base) return undefined;
  const platform = `${process.platform}-${process.arch}`;
  const exe = join(base, "copilot-runtime", "prebuilds", platform, process.platform === "win32" ? "copilot-runtime.exe" : "copilot-runtime");
  return existsSync(exe) ? exe : undefined;
}

function inside(root: string, file: string) {
  const rel = relative(resolve(root), resolve(root, file));
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/** Copilot's model list in Workstream's shape. "auto" lets Copilot choose. */
export function copilotModels(
  models: {
    id: string;
    name: string;
    policy?: { state?: string };
    billing?: { multiplier?: number };
    supportedReasoningEfforts?: string[];
    defaultReasoningEffort?: string;
  }[],
): Model[] {
  const usable = models.filter((m) => m.policy?.state !== "disabled");
  const preferred = usable.find((m) => m.id === "auto") ?? usable[0];
  return usable.map((m) => ({
    id: m.id,
    name: m.name,
    description: typeof m.billing?.multiplier === "number" ? `${m.billing.multiplier}x premium requests` : "",
    isDefault: m === preferred,
    efforts: m.supportedReasoningEfforts ?? [],
    defaultEffort: m.defaultReasoningEffort ?? m.supportedReasoningEfforts?.[0] ?? "",
  }));
}

/** Copilot quota snapshots (premium requests, chat, ...) as Usage remaining buckets. */
export function copilotLimits(
  snapshots: Record<string, { isUnlimitedEntitlement?: boolean; remainingPercentage?: number; resetDate?: string } | undefined>,
): UsageBucket[] {
  const label: Record<string, string> = {
    premium_interactions: "Copilot premium requests",
    chat: "Copilot chat",
    completions: "Copilot completions",
  };
  return Object.entries(snapshots)
    .filter(([, s]) => s && !s.isUnlimitedEntitlement && typeof s.remainingPercentage === "number")
    .map(([key, s]) => ({
      id: `copilot-${key}`,
      name: label[key] ?? `Copilot ${key.replace(/_/g, " ")}`,
      primary: {
        usedPercent: Math.max(0, Math.min(100, 100 - (s!.remainingPercentage as number))),
        windowDurationMins: null,
        resetsAt: s!.resetDate ? Math.floor(Date.parse(s!.resetDate) / 1000) || null : null,
      },
      secondary: null,
    }));
}

/** The final message should be pure JSON; tolerate a fenced block around it. */
export function extractJson(content: string) {
  const text = content.trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : text;
}
