import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";
import { z } from "zod";
import type { AgentMcpServer, Profile, Runtime } from "../shared/types";
import { executable } from "./process";
import { missingHelpers, resolveCodexPath } from "./codexpath";
import { parseLimits, tokenUsageSchema } from "./telemetry";

const envelope = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  result: z.unknown().optional(),
  error: z.object({ message: z.string() }).passthrough().optional(),
});
type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
type Turn = {
  resolve: (text: string) => void;
  reject: (error: Error) => void;
  text: string;
  turnId?: string;
};
export class Codex extends EventEmitter {
  private process?: ChildProcessWithoutNullStreams;
  private pending = new Map<number, Pending>();
  private turns = new Map<string, Turn>();
  /** Model each thread runs on, for cost estimates. */
  private threadModels = new Map<string, string>();
  private sequence = 0;
  private refreshing?: Promise<void>;
  runtime: Runtime = {
    connected: false,
    authenticated: false,
    accountLabel: "Not connected",
    models: [],
  };

  /** The codex.exe actually running (after following a Codex app update). */
  private runningPath?: string;
  async connect(path: string) {
    // The Codex app updated and removed the helpers next to the running copy:
    // restart from the current install instead of failing every command.
    if (this.process && this.runningPath && missingHelpers(this.runningPath).length) this.close();
    if (this.process) {
      await this.refresh();
      return;
    }
    const resolved = resolveCodexPath(path);
    this.runningPath = resolved.path;
    this.runtime.note = resolved.switched
      ? `Your Codex path points to an older Codex app folder. Using the current one: ${resolved.path}`
      : undefined;
    const missing = missingHelpers(resolved.path);
    if (missing.length)
      this.runtime.note = `Codex agents cannot run commands: ${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} missing next to ${resolved.path}. Open the Codex app once so it finishes updating, or point the Codex path to a complete install.`;
    const child = spawn(
      executable(resolved.path),
      ["app-server", "--listen", "stdio://"],
      { windowsHide: true, shell: false, stdio: "pipe" },
    );
    this.process = child;
    child.stderr.on("data", () => {
      /* Runtime diagnostics can contain paths and credentials; never persist raw stderr. */
    });
    child.on("error", (error) => {
      if (this.process === child) this.disconnect(error);
    });
    child.on("exit", () => {
      if (this.process === child)
        this.disconnect(new Error("Codex exited. Reconnect to continue."));
    });
    createInterface({ input: child.stdout }).on("line", (line) => {
      try {
        this.receive(envelope.parse(JSON.parse(line)));
      } catch {
        /* Ignore non-protocol diagnostics. */
      }
    });
    try {
      await this.request("initialize", {
        clientInfo: {
          name: "workstream",
          title: "Workstream",
          version: "0.2.3",
        },
      });
      this.send({ method: "initialized", params: {} });
      this.runtime.connected = true;
      await this.refresh();
    } catch (error) {
      this.close();
      throw error;
    }
  }
  refresh(): Promise<void> {
    if (!this.refreshing)
      this.refreshing = this.readAccount().finally(() => {
        this.refreshing = undefined;
      });
    return this.refreshing;
  }
  private async readAccount() {
    const account = (await this.request("account/read", {
      refreshToken: false,
    })) as {
      account: { type: string; email?: string; planType?: string } | null;
      requiresOpenaiAuth: boolean;
    };
    const response = (await this.request("model/list", {})) as {
      data: {
        model: string;
        displayName: string;
        description: string;
        isDefault: boolean;
        hidden: boolean;
        defaultReasoningEffort: string;
        supportedReasoningEfforts: { reasoningEffort: string }[];
      }[];
    };
    const accountLabel =
      account.account?.email ?? account.account?.type ?? "Sign in required";
    this.runtime = {
      ...(this.runtime.accountLabel === accountLabel ? this.runtime : {}),
      connected: true,
      authenticated: Boolean(account.account) || !account.requiresOpenaiAuth,
      accountLabel,
      error: undefined,
      models: response.data
        .filter((model) => !model.hidden)
        .map((model) => ({
          id: model.model,
          name: model.displayName,
          description: model.description,
          isDefault: model.isDefault,
          defaultEffort: model.defaultReasoningEffort,
          efforts: model.supportedReasoningEfforts.map(
            (e) => e.reasoningEffort,
          ),
        })),
    };
    this.emit("changed");
    await this.refreshUsage();
  }
  async refreshUsage() {
    try {
      this.runtime.limits = parseLimits(
        await this.request("account/rateLimits/read"),
      );
      this.runtime.limitsUpdatedAt = new Date().toISOString();
      this.runtime.limitsError = undefined;
    } catch {
      this.runtime.limitsError =
        "Usage limits are unavailable for this connection.";
    }
    this.emit("changed");
  }
  private send(message: unknown) {
    if (!this.process?.stdin.writable)
      throw new Error("Connect Codex in Settings first.");
    this.process.stdin.write(JSON.stringify(message) + "\n");
  }
  /** MCP servers and apps as this Codex runtime sees them (what agents get). */
  async mcpStatus() {
    const [status, apps] = await Promise.all([
      this.request("mcpServerStatus/list", {}),
      // forceRefetch: otherwise the list can be empty until Codex has loaded apps once.
      this.request("app/list", { forceRefetch: true })
        .catch(() => this.request("app/list", {}))
        .catch(() => undefined),
    ]);
    return { status, apps };
  }
  request(method: string, params: unknown = {}): Promise<unknown> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex ${method} timed out.`));
      }, 60_000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  private receive(message: z.infer<typeof envelope>) {
    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(Number(message.id));
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(Number(message.id));
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      }
      return;
    }
    const params = message.params ?? {};
    if (message.method === "account/rateLimits/updated") {
      try {
        this.runtime.limits = parseLimits(params);
        this.runtime.limitsUpdatedAt = new Date().toISOString();
        this.runtime.limitsError = undefined;
        this.emit("changed");
      } catch {
        /* Keep the last known snapshot when the runtime sends an unknown shape. */
      }
    }
    if (message.id !== undefined && message.method) {
      if (
        [
          "item/commandExecution/requestApproval",
          "item/fileChange/requestApproval",
        ].includes(message.method)
      )
        this.emit("approval", {
          id: message.id,
          method: message.method,
          params,
        });
      else
        this.send({
          id: message.id,
          error: {
            code: -32601,
            message:
              "Workstream does not support this interactive request yet. Explain the missing input in your final response.",
          },
        });
      return;
    }
    const threadId = String(params.threadId ?? "");
    const turn = this.turns.get(threadId);
    if (message.method === "thread/tokenUsage/updated") {
      const usage = tokenUsageSchema.safeParse(
        (params.tokenUsage as { total?: unknown } | undefined)?.total,
      );
      if (usage.success)
        this.emit("usage", threadId, {
          ...usage.data,
          ...(this.threadModels.get(threadId) ? { model: this.threadModels.get(threadId) } : {}),
        });
    }
    if (message.method === "turn/plan/updated") {
      const plan = z
        .array(
          z.object({
            step: z.string(),
            status: z.enum(["pending", "inProgress", "completed"]),
          }),
        )
        .safeParse(params.plan);
      if (plan.success) this.emit("steps", threadId, plan.data);
    }
    if (message.method?.endsWith("Delta")) this.emit("heartbeat", threadId);
    if (message.method === "item/started") {
      const item = params.item as
        | {
            type?: string;
            command?: string;
            tool?: string;
            server?: string;
            query?: string;
          }
        | undefined;
      const labels: Record<string, string> = {
        commandExecution: `Running: ${item?.command ?? "command"}`,
        fileChange: "Editing worktree files",
        mcpToolCall: `Using ${item?.server ?? "MCP"}: ${item?.tool ?? "tool"}`,
        webSearch: `Searching: ${item?.query ?? "web sources"}`,
        imageView: "Inspecting an image",
        contextCompaction: "Compacting session context",
      };
      if (item?.type && labels[item.type])
        this.emit("activity", threadId, labels[item.type]);
    }
    if (message.method === "item/completed") {
      const item = params.item as
        | {
            type?: string;
            text?: string;
            phase?: string;
            command?: string;
            exitCode?: number;
          }
        | undefined;
      if (
        turn &&
        item?.type === "agentMessage" &&
        item.text &&
        item.phase !== "commentary"
      )
        turn.text = item.text;
      if (item?.type === "agentMessage" && item.phase === "commentary")
        this.emit("activity", threadId, item.text);
      if (item?.type === "commandExecution")
        this.emit(
          "activity",
          threadId,
          `Command finished (${item.exitCode ?? "unknown"}): ${item.command ?? ""}`,
        );
    }
    if (message.method === "turn/started" && turn) {
      turn.turnId = (params.turn as { id: string }).id;
      this.emit("turn", threadId, turn.turnId);
    }
    if (message.method === "turn/completed" && turn) {
      const result = params.turn as {
        status: string;
        error?: { message?: string };
      };
      this.turns.delete(threadId);
      this.emit("resolved", threadId);
      if (result.status === "completed") turn.resolve(turn.text);
      else
        turn.reject(
          new Error(
            result.error?.message ??
              `Agent ${result.status}. Work is preserved.`,
          ),
        );
    }
    if (message.method === "serverRequest/resolved")
      this.emit("approvalResolved", String(params.requestId));
    if (
      message.method === "account/login/completed" ||
      message.method === "account/updated"
    )
      void this.refresh().catch(() => {});
  }
  async startThread(
    cwd: string,
    profile: Profile,
    instructions: string,
    write: boolean,
    mcp: AgentMcpServer[] = [],
  ) {
    if (!this.runtime.authenticated)
      throw new Error("Sign in to Codex in Settings before running an agent.");
    const model =
      profile.model || this.runtime.models.find((m) => m.isDefault)?.id;
    if (!model || !this.runtime.models.some((m) => m.id === model))
      throw new Error("Choose an available model in Settings.");
    const response = (await this.request("thread/start", {
      cwd,
      model,
      sandbox: write ? "workspace-write" : "read-only",
      approvalPolicy: "on-request",
      developerInstructions: instructions,
      serviceName: "workstream",
      // Workstream's read-only connector proxy (see connectors.ts). Added next to the user's own MCP servers.
      ...(mcp.length
        ? {
            config: Object.fromEntries(
              mcp.flatMap((server) => [
                [`mcp_servers.${server.name}.url`, server.url],
                [`mcp_servers.${server.name}.http_headers`, server.headers],
              ]),
            ),
          }
        : {}),
    })) as { thread: { id: string } };
    this.threadModels.set(response.thread.id, model);
    return response.thread.id;
  }
  async run(
    threadId: string,
    prompt: string,
    schema: unknown,
    profile: Profile,
    images: string[] = [],
  ) {
    const selected =
      this.runtime.models.find((m) => m.id === profile.model) ??
      this.runtime.models.find((m) => m.isDefault);
    const effort = selected?.efforts.includes(profile.effort)
      ? profile.effort
      : selected?.defaultEffort;
    return new Promise<string>((resolve, reject) => {
      this.turns.set(threadId, { resolve, reject, text: "" });
      void this.request("turn/start", {
        threadId,
        input: [
          { type: "text", text: prompt },
          ...images.map((path) => ({ type: "localImage", path })),
        ],
        outputSchema: schema,
        effort,
      }).catch((error) => {
        this.turns.delete(threadId);
        reject(error);
      });
    });
  }
  async interrupt(threadId: string) {
    const turn = this.turns.get(threadId);
    if (turn?.turnId)
      await this.request("turn/interrupt", { threadId, turnId: turn.turnId });
  }
  respond(id: string | number, accept: boolean, session = false) {
    this.send({
      id,
      result: {
        decision: accept
          ? session
            ? "acceptForSession"
            : "accept"
          : "decline",
      },
    });
  }
  private disconnect(error: Error) {
    this.process = undefined;
    this.runtime = {
      ...this.runtime,
      connected: false,
      authenticated: false,
      error: error.message,
    };
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const turn of this.turns.values()) turn.reject(error);
    this.turns.clear();
    this.emit("changed");
  }
  close() {
    const child = this.process;
    this.disconnect(new Error("Codex disconnected."));
    child?.kill();
  }
}
