import { describe, expect, it } from "vitest";
import { taskStats } from "../shared/stats";
import type { Run } from "../shared/types";

const run = (id: string, model: string, reviews: string[], repairs: number, tokens: number, skill?: string): Run =>
  ({
    id,
    stage: "complete",
    prUrl: "x",
    createdAt: "2026-10-22T08:00:00Z",
    updatedAt: "2026-10-22T10:00:00Z",
    activity: [],
    repairCount: repairs,
    reviews: reviews.map((verdict) => ({ verdict })),
    sessions: [
      {
        role: "developer",
        threadId: id,
        engine: "codex",
        model,
        usage: { totalTokens: tokens, inputTokens: tokens, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, model },
        ...(skill ? { instructions: { text: "", notes: false, skills: [{ path: skill, hash: "x" }] } } : {}),
      },
    ],
  }) as unknown as Run;

describe("task statistics", () => {
  it("averages cost, reviews, repairs and first-review passes per developer model and by generated skills", () => {
    const prices = { m1: { input: 10, cachedInput: 1, output: 10 }, m2: { input: 20, cachedInput: 2, output: 20 } };
    const runs = [run("a", "m1", ["pass"], 0, 100000, ".agents/skills/shop-develop"), run("b", "m1", ["changes_requested", "pass"], 1, 300000), run("c", "m2", ["pass"], 0, 100000)];
    const stats = taskStats(runs, prices, new Set([".agents/skills/shop-develop"]));
    expect(stats.total.tasks).toBe(3);
    const m1 = stats.byModel.find((r) => r.label === "codex · m1")!;
    expect(m1.tasks).toBe(2);
    expect(m1.avgCostUsd).toBeCloseTo(2, 5);
    expect(m1.avgReviews).toBe(1.5);
    expect(m1.avgRepairs).toBe(0.5);
    expect(m1.firstReviewPass).toBe(0.5);
    expect(m1.avgHours).toBe(2);
    expect(stats.skills.map((r) => [r.label, r.tasks])).toEqual([["With generated skills", 1], ["Without", 2]]);
  });
});
