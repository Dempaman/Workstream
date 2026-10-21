import { describe, expect, it } from "vitest";
import { costByAgent, formatUsd, nanoAiuToUsd, priceFor, sessionCost, tokenCost } from "../shared/pricing";
import type { AgentSession } from "../shared/types";

const usage = (input: number, cached: number, output: number, extra = {}) => ({
  totalTokens: input + output,
  inputTokens: input,
  cachedInputTokens: cached,
  outputTokens: output,
  reasoningOutputTokens: 0,
  ...extra,
});
const session = (over: Partial<AgentSession>): AgentSession => ({ role: "planner", threadId: Math.random().toString(), ...over });

describe("pricing", () => {
  it("matches model ids in the forms each runtime reports", () => {
    expect(priceFor("gpt-6.1-sol")?.label).toBe("GPT-6.1 Sol");
    expect(priceFor("GPT-6.1-Sol")?.label).toBe("GPT-6.1 Sol");
    expect(priceFor("gpt-6-sol")?.label).toBe("GPT-6 Sol");
    expect(priceFor("claude-opus-5-5-20260901")?.label).toBe("Claude Opus 5.5");
    expect(priceFor("claude-opus-5.5")?.label).toBe("Claude Opus 5.5");
    expect(priceFor("claude-opus-5")?.label).toBe("Claude Opus 5");
    expect(priceFor("opus")?.label).toBe("Claude Opus 5.5");
    expect(priceFor("gpt-5.4-mini")?.label).toBe("GPT-5.4 mini");
    expect(priceFor("some-unknown-model")).toBeUndefined();
    expect(priceFor(undefined)).toBeUndefined();
  });

  it("prices cached, uncached, cache-write and output tokens separately", () => {
    // The run in the screenshot: 6,038,371 input of which 5,531,607 cached, 28,352 output, GPT-6.1 Sol.
    const cost = tokenCost(usage(6_038_371, 5_531_607, 28_352), priceFor("gpt-6.1-sol")!);
    expect(cost).toBeCloseTo((506_764 * 2 + 5_531_607 * 0.1 + 28_352 * 10) / 1e6, 6);
    const claude = tokenCost(usage(1_000_000, 600_000, 0, { cacheWriteTokens: 100_000 }), priceFor("opus")!);
    expect(claude).toBeCloseTo((300_000 * 4 + 600_000 * 0.2 + 100_000 * 5) / 1e6, 6);
  });

  it("uses the runtime's reported cost unless you set your own price", () => {
    const s = session({ engine: "claude", model: "opus", usage: usage(1000, 0, 1000, { reportedCostUsd: 1.23 }) });
    expect(sessionCost(s)).toMatchObject({ usd: 1.23, source: "reported" });
    const own = sessionCost(s, { opus: { input: 1, cachedInput: 0, output: 1 } });
    expect(own.source).toBe("estimate");
    expect(own.usd).toBeCloseTo(0.002, 6);
  });

  it("falls back to the runtime default model and flags unknown models", () => {
    const old = session({ engine: "codex", model: "", usage: usage(1_000_000, 0, 0) });
    expect(sessionCost(old).source).toBe("unpriced");
    expect(sessionCost(old, {}, { codex: "gpt-6.1-sol" })).toMatchObject({ usd: 2, source: "estimate" });
    expect(sessionCost(session({ model: "mystery", usage: usage(5, 0, 5) })).source).toBe("unpriced");
    expect(sessionCost(session({ model: "opus" })).source).toBe("none");
  });

  it("groups cost per agent in pipeline order, with verification separate", () => {
    const agents = costByAgent([
      session({ role: "reviewer", engine: "codex", model: "gpt-6.1-sol", usage: usage(1_000_000, 0, 0) }),
      session({ role: "planner", engine: "claude", model: "opus", usage: usage(10, 0, 10, { reportedCostUsd: 0.5 }) }),
      session({ role: "developer", engine: "copilot", purpose: "verification", usage: usage(1, 0, 1, { model: "gpt-6-luna", reportedCostUsd: 0.01 }) }),
      session({ role: "developer", engine: "copilot", usage: usage(1, 0, 1, { model: "claude-sonnet-5.5", reportedCostUsd: 0.25 }) }),
      session({ role: "developer", engine: "codex", model: "gpt-6.1-sol", usage: usage(1_000_000, 0, 0) }),
    ]);
    expect(agents.map((a) => a.key)).toEqual(["planner", "developer", "verification", "reviewer"]);
    const developer = agents[1]!;
    expect(developer.sessions).toBe(2);
    expect(developer.engines).toEqual(["copilot", "codex"]);
    expect(developer.usd).toBeCloseTo(2.25, 6);
    expect(agents[3]!.usd).toBeCloseTo(2, 6);
  });

  it("converts Copilot nano-AIU and formats dollars", () => {
    expect(nanoAiuToUsd(1e9)).toBeCloseTo(0.01, 9);
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.004)).toBe("< $0.01");
    expect(formatUsd(1234.5)).toBe("$1,234.50");
  });
});
