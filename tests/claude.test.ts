import { describe, expect, it, vi } from "vitest";
import * as processes from "../electron/process";
import { Claude, claudeLimits, forClaudeCode, memorySecrets } from "../electron/claude";
import { z } from "zod";
import { developmentSchema } from "../shared/types";

const models = async () =>
  Response.json({ data: [{ id: "claude-test-1", display_name: "Claude Test" }] });

function fakeSdk(script: (options: Record<string, unknown>) => AsyncGenerator<unknown>) {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    load: async () => ({
      query: ((params: { options: Record<string, unknown> }) => {
        calls.push(params.options);
        const generator = script(params.options);
        return Object.assign(generator, { interrupt: vi.fn(async () => undefined) });
      }) as never,
    }),
  };
}

async function connected(sdk: ReturnType<typeof fakeSdk>) {
  vi.spyOn(processes, "execute").mockResolvedValue({
    code: 0, output: "", stdout: "2.1.288 (Claude Code)\n", stderr: "",
  });
  const secrets = memorySecrets();
  secrets.set("sk-ant-api03-test-key-0000000000000000");
  const claude = new Claude(secrets, models, sdk.load);
  await claude.connect(process.execPath, "api-key");
  return claude;
}

describe("Claude runtime", () => {
  it("refuses to connect without an API key and never stores it in runtime state", async () => {
    const claude = new Claude(memorySecrets(), models);
    await expect(claude.connect("claude", "api-key")).rejects.toThrow("Anthropic API key");
    const sdk = fakeSdk(async function* () {});
    const ready = await connected(sdk);
    expect(ready.runtime.authenticated).toBe(true);
    expect(JSON.stringify(ready.runtime)).not.toContain("test-key-0000");
    expect(ready.runtime.models[0].id).toBe("claude-test-1");
  });

  it("returns structured output, reports usage and keeps read-only roles from editing", async () => {
    const sdk = fakeSdk(async function* () {
      yield { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "Looking" }], usage: { input_tokens: 10, cache_read_input_tokens: 90, output_tokens: 5 } } };
      yield { type: "result", subtype: "success", is_error: false, structured_output: { verdict: "pass" } };
    });
    const claude = await connected(sdk);
    const usage = vi.fn();
    claude.on("usage", usage);
    const thread = await claude.startThread("/repo", { model: "claude-test-1", effort: "high" }, "Rules", false);
    const text = await claude.run(thread, "Review", { type: "object" }, { model: "claude-test-1", effort: "high" });
    expect(JSON.parse(text)).toEqual({ verdict: "pass" });
    expect(usage).toHaveBeenLastCalledWith(thread, expect.objectContaining({ inputTokens: 100, cachedInputTokens: 90, outputTokens: 5, totalTokens: 105 }));
    expect(sdk.calls[0]).toMatchObject({ cwd: "/repo", permissionMode: "default", settingSources: ["project"], model: "claude-test-1" });
    expect(sdk.calls[0].disallowedTools).toContain("Edit");
    expect((sdk.calls[0].env as Record<string, string>).ANTHROPIC_API_KEY).toBe("sk-ant-api03-test-key-0000000000000000");
  });

  it("routes tool permission requests through Workstream approvals", async () => {
    let decision: unknown;
    const sdk = fakeSdk(async function* (options) {
      const canUseTool = options.canUseTool as (n: string, i: unknown, o: unknown) => Promise<unknown>;
      decision = await canUseTool("Bash", { command: "npm test" }, { signal: new AbortController().signal, suggestions: [{ type: "addRules" }] });
      yield { type: "result", subtype: "success", is_error: false, structured_output: {} };
    });
    const claude = await connected(sdk);
    claude.on("approval", (request: { id: string; params: { availableDecisions: string[] } }) => {
      expect(request.params.availableDecisions).toContain("acceptForSession");
      claude.respond(request.id, true, true);
    });
    const thread = await claude.startThread("/repo", { model: "", effort: "high" }, "Rules", true);
    await claude.run(thread, "Develop", {}, { model: "", effort: "high" });
    expect(sdk.calls[0].permissionMode).toBe("acceptEdits");
    expect(decision).toMatchObject({ behavior: "allow", updatedPermissions: [{ type: "addRules" }] });
  });

  it("stops at once when the API rejects the key instead of waiting for retries", async () => {
    const sdk = fakeSdk(async function* () {
      yield { type: "system", subtype: "api_retry", attempt: 1, error_status: 401 };
      yield { type: "result", subtype: "success", is_error: false, structured_output: {} };
    });
    const claude = await connected(sdk);
    const thread = await claude.startThread("/repo", { model: "", effort: "high" }, "Rules", false);
    await expect(claude.run(thread, "x", {}, { model: "", effort: "high" })).rejects.toThrow("rejected the API key (401)");
  });

  it("gives agents the read-only connector proxy and auto-allows only those tools", async () => {
    const sdk = fakeSdk(async function* () {
      yield { type: "result", subtype: "success", is_error: false, structured_output: {} };
    });
    const claude = await connected(sdk);
    const server = { id: "atlassian", name: "workstream_atlassian", url: "http://127.0.0.1:5000/mcp/atlassian", headers: { "X-Workstream-Key": "k" } };
    const thread = await claude.startThread("/repo", { model: "", effort: "high" }, "Rules", false, [server]);
    await claude.run(thread, "Plan", {}, { model: "", effort: "high" });
    expect(sdk.calls[0].mcpServers).toEqual({ workstream_atlassian: { type: "http", url: server.url, headers: server.headers } });
    expect(sdk.calls[0].allowedTools).toEqual(["mcp__workstream_atlassian"]);
  });

  it("uses your own Claude Code sign-in without any API key", async () => {
    vi.spyOn(processes, "execute").mockImplementation(async (_program, args) => ({
      code: 0,
      output: "",
      stdout: args.includes("status")
        ? JSON.stringify({ loggedIn: true, email: "dennis@example.com", subscriptionType: "max" })
        : "2.1.288 (Claude Code)",
      stderr: "",
    }));
    const sdk = fakeSdk(async function* () {
      yield { type: "result", subtype: "success", is_error: false, structured_output: { ok: true } };
    });
    const claude = new Claude(memorySecrets(), models, sdk.load);
    await claude.connect(process.execPath, "claude-code");
    expect(claude.runtime.accountLabel).toContain("dennis@example.com");
    expect(claude.runtime.models.map((m) => m.id)).toEqual(["opus", "sonnet", "haiku"]);
    const thread = await claude.startThread("/repo", { model: "opus", effort: "high" }, "Rules", false);
    await claude.run(thread, "Plan", {}, { model: "opus", effort: "high" });
    expect((sdk.calls[0].env as Record<string, string>).ANTHROPIC_API_KEY).toBe("");
    expect(sdk.calls[0].model).toBe("opus");
  });

  it("reports when Claude Code is not signed in", async () => {
    vi.spyOn(processes, "execute").mockImplementation(async (_program, args) => ({
      code: 0, output: "", stderr: "",
      stdout: args.includes("status") ? JSON.stringify({ loggedIn: false }) : "2.1.288",
    }));
    const claude = new Claude(memorySecrets(), models);
    await expect(claude.connect(process.execPath, "claude-code")).rejects.toThrow("Sign in with Claude");
  });

  it("maps Claude plan usage to the same windows as Codex", () => {
    const buckets = claudeLimits({
      subscription_type: "max",
      rate_limits: {
        five_hour: { utilization: 35, resets_at: "2026-10-15T13:00:00Z" },
        seven_day: { utilization: 12, resets_at: "2026-10-22T08:00:00Z" },
        seven_day_opus: { utilization: 40, resets_at: null },
        model_scoped: [{ display_name: "Fable", utilization: 5, resets_at: null }],
      },
    });
    expect(buckets[0]).toEqual({
      id: "claude",
      name: "Claude max plan",
      primary: { usedPercent: 35, windowDurationMins: 300, resetsAt: Date.parse("2026-10-15T13:00:00Z") / 1000 },
      secondary: { usedPercent: 12, windowDurationMins: 10080, resetsAt: Date.parse("2026-10-22T08:00:00Z") / 1000 },
    });
    expect(buckets.map((b) => b.name)).toEqual(["Claude max plan", "Opus (weekly)", "Fable (weekly)"]);
    expect(claudeLimits({ rate_limits: null })).toEqual([]);
  });

  it("reads plan usage without sending a prompt", async () => {
    vi.spyOn(processes, "execute").mockImplementation(async (_program, args) => ({
      code: 0, output: "", stderr: "",
      stdout: args.includes("status") ? JSON.stringify({ loggedIn: true }) : "2.1.288",
    }));
    let prompted = false;
    const sdk = {
      load: async () => ({
        query: ((params: { prompt: AsyncIterable<unknown> }) => {
          const iterator = params.prompt[Symbol.asyncIterator]();
          void iterator.next().then((r) => { if (!r.done) prompted = true; });
          return {
            usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => ({
              subscription_type: "pro",
              rate_limits_available: true,
              rate_limits: { five_hour: { utilization: 80, resets_at: null } },
            }),
          };
        }) as never,
      }),
    };
    const claude = new Claude(memorySecrets(), models, sdk.load);
    await claude.connect(process.execPath, "claude-code");
    await claude.refreshUsage(true);
    expect(claude.runtime.limits?.[0]).toMatchObject({ name: "Claude pro plan", primary: { usedPercent: 80 } });
    expect(claude.runtime.limitsError).toBeUndefined();
    expect(prompted).toBe(false);
  });

  it("removes the draft 2020-12 $schema that Claude Code rejects", () => {
    const schema = z.toJSONSchema(developmentSchema) as Record<string, unknown>;
    expect(schema.$schema).toContain("2020-12");
    const cleaned = forClaudeCode(schema);
    expect(JSON.stringify(cleaned)).not.toContain("$schema");
    expect(cleaned.properties).toEqual(schema.properties);
  });
});
