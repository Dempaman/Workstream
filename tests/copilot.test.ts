import { describe, expect, it, vi } from "vitest";
import { Copilot, copilotLimits, copilotModels, extractJson } from "../electron/copilot";

/** A stand-in for @github/copilot-sdk: records sessions and plays permission requests. */
function fakeSdk(requests: Record<string, unknown>[], answer = '{"ok":true}') {
  const decisions: unknown[] = [];
  const configs: Record<string, unknown>[] = [];
  class CopilotClient {
    rpc = { account: { getQuota: async () => ({ quotaSnapshots: { premium_interactions: { isUnlimitedEntitlement: false, remainingPercentage: 70, resetDate: "2026-11-01T00:00:00Z" } } }) } };
    async start() {}
    async stop() {}
    async forceStop() {}
    async getAuthStatus() {
      return { isAuthenticated: true, login: "dbjork" };
    }
    async listModels() {
      return [
        { id: "auto", name: "Auto", capabilities: {}, supportedReasoningEfforts: [] },
        { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5", capabilities: {}, billing: { multiplier: 1 }, supportedReasoningEfforts: ["low", "high"], defaultReasoningEffort: "high" },
        { id: "off", name: "Off", capabilities: {}, policy: { state: "disabled" } },
      ];
    }
    async createSession(config: Record<string, unknown> & { onPermissionRequest: (r: unknown) => unknown }) {
      configs.push(config);
      const handlers: ((e: unknown) => void)[] = [];
      return {
        on: (h: (e: unknown) => void) => (handlers.push(h), () => {}),
        abort: async () => {},
        disconnect: async () => {},
        sendAndWait: async () => {
          handlers.forEach((h) => h({ type: "assistant.usage", data: { inputTokens: 10, cacheReadTokens: 5, outputTokens: 3 } }));
          for (const request of requests) decisions.push(await config.onPermissionRequest(request));
          return { data: { content: "```json\n" + answer + "\n```" } };
        },
      };
    }
  }
  const RuntimeConnection = { forStdio: (o: unknown) => o };
  return { sdk: { CopilotClient, RuntimeConnection } as never, decisions, configs };
}

describe("GitHub Copilot engine", () => {
  it("maps models, quota and fenced JSON", () => {
    const models = copilotModels([
      { id: "gpt-5", name: "GPT-5", billing: { multiplier: 1 } },
      { id: "auto", name: "Auto" },
      { id: "x", name: "X", policy: { state: "disabled" } },
    ]);
    expect(models.map((m) => [m.id, m.isDefault])).toEqual([["gpt-5", false], ["auto", true]]);
    expect(models[0].description).toBe("1x premium requests");
    const [bucket] = copilotLimits({ premium_interactions: { isUnlimitedEntitlement: false, remainingPercentage: 25, resetDate: "2026-11-01T00:00:00Z" }, chat: { isUnlimitedEntitlement: true, remainingPercentage: 100 } });
    expect(bucket.name).toBe("Copilot premium requests");
    expect(bucket.primary?.usedPercent).toBe(75);
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("runs a read-only stage: reads allowed, writes refused, own MCP reads only, commands ask you", async () => {
    const { sdk, decisions, configs } = fakeSdk([
      { kind: "read", path: "src/a.ts" },
      { kind: "write", fileName: "src/a.ts" },
      { kind: "mcp", serverName: "figma", toolName: "get_design_context", readOnly: true },
      { kind: "mcp", serverName: "figma", toolName: "use_figma", readOnly: false },
      { kind: "mcp", serverName: "workstream-jira", toolName: "anything", readOnly: false },
      { kind: "memory" },
      { kind: "shell", fullCommandText: "npm test", canOfferSessionApproval: true },
    ]);
    const copilot = new Copilot(() => "C:/runtime/copilot-runtime.exe", async () => sdk);
    await copilot.connect();
    expect(copilot.runtime.accountLabel).toBe("dbjork");
    expect(copilot.runtime.models.map((m) => m.id)).toEqual(["auto", "claude-sonnet-4.5"]);
    copilot.on("approval", (request: { id: string; params: { command: string; availableDecisions: string[] } }) => {
      expect(request.params.command).toBe("npm test");
      expect(request.params.availableDecisions).toContain("acceptForSession");
      copilot.respond(request.id, true, true);
    });
    const usage = vi.fn();
    copilot.on("usage", usage);
    const id = await copilot.startThread("/repo/wt", { engine: "copilot", model: "claude-sonnet-4.5", effort: "high" }, "RULES", false, [
      { id: "jira", name: "workstream-jira", url: "http://127.0.0.1:1/mcp", headers: { Authorization: "x" } },
    ]);
    const text = await copilot.run(id, "Plan it", { type: "object" }, { engine: "copilot", model: "claude-sonnet-4.5", effort: "high" });
    expect(text).toBe('{"ok":true}');
    expect(decisions.map((d) => (d as { kind: string }).kind)).toEqual([
      "approve-once",
      "reject",
      "approve-once",
      "reject",
      "approve-once",
      "reject",
      "approve-for-session",
    ]);
    expect(configs[0]).toMatchObject({
      model: "claude-sonnet-4.5",
      reasoningEffort: "high",
      workingDirectory: "/repo/wt",
      systemMessage: { mode: "append", content: "RULES" },
      mcpServers: { "workstream-jira": { type: "http", url: "http://127.0.0.1:1/mcp" } },
    });
    expect(usage).toHaveBeenCalledWith(id, expect.objectContaining({ inputTokens: 15, cachedInputTokens: 5, outputTokens: 3 }));
  });

  it("lets the developer write inside its worktree only", async () => {
    const { sdk, decisions } = fakeSdk([
      { kind: "write", fileName: "src/a.ts" },
      { kind: "write", fileName: "../other/secret.ts" },
    ]);
    const copilot = new Copilot(() => undefined, async () => sdk);
    await copilot.connect();
    let asked = 0;
    copilot.on("approval", (request: { id: string }) => {
      asked++;
      copilot.respond(request.id, false);
    });
    const id = await copilot.startThread("/repo/wt", { engine: "copilot", model: "", effort: "" }, "", true);
    await copilot.run(id, "Build it", {}, { engine: "copilot", model: "", effort: "" });
    expect(decisions.map((d) => (d as { kind: string }).kind)).toEqual(["approve-once", "reject"]);
    expect(asked).toBe(1);
  });

  it("says plainly when Copilot is not signed in", async () => {
    const { sdk } = fakeSdk([]);
    (sdk as unknown as { CopilotClient: { prototype: { getAuthStatus: () => Promise<unknown> } } }).CopilotClient.prototype.getAuthStatus = async () => ({ isAuthenticated: false });
    const copilot = new Copilot(() => undefined, async () => sdk);
    await copilot.connect();
    expect(copilot.runtime.authenticated).toBe(false);
    expect(copilot.runtime.error).toContain("Sign in to GitHub");
    await expect(copilot.startThread("/x", { model: "", effort: "" }, "", false)).rejects.toThrow("Connect GitHub Copilot");
  });
});
