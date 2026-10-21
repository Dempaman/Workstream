import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { MemoryDb, extractMemories, redactSecrets } from "../electron/memorydb";
import type { Run } from "../shared/types";

const db = async () => new MemoryDb(join(await mkdtemp(join(tmpdir(), "ws-mem-")), "memory.sqlite"));
const run = (over: Partial<Run>): Run =>
  ({
    id: "r", projectId: "p1", title: "", ticketKey: "", description: "", stage: "complete", status: "idle",
    createdAt: "", updatedAt: "", branch: "", targetBranch: "develop", reviews: [], checks: [], activity: [],
    sessions: [], files: [], repairCount: 0, profiles: {} as Run["profiles"],
    plan: { summary: "qqq", markdown: "", acceptanceCriteria: ["x"], checks: [], specialization: "", risks: [] },
    ...over,
  }) as Run;

describe("memory database", () => {
  it("redacts secrets before storing", () => {
    const text = redactSecrets("token ghp_abcdefghijklmnopqrstuvwxyz123456 and API_KEY=supersecret123 and https://user:pw@dev.azure.com and Bearer abcdefghijklmnopqrstuvwxyz");
    expect(text).not.toMatch(/ghp_|supersecret|user:pw|abcdefghijklmnopqrstuvwxyz$/);
    expect(text).toContain("API_KEY=[redacted]");
  });

  it("extracts outcome, your plan feedback, review findings and failed checks", () => {
    const items = extractMemories(
      run({
        ticketKey: "DPP-1",
        title: "Dealer locator",
        development: { summary: "Added map search", files: [], criteriaCovered: [], limitations: ["No live CMS"] },
        planFeedback: ["Use the existing SmartLink, not a new link component"],
        reviews: [
          { verdict: "changes_requested", summary: "", acceptanceGaps: [], findings: [{ severity: "warning", file: "src/blocks/Dealer.tsx", line: 3, scenario: "Missing aria-label on search", recommendation: "Use tStr for aria-label" }] },
          { verdict: "pass", summary: "", acceptanceGaps: [], findings: [] },
        ],
        files: ["src/blocks/Dealer.tsx"],
      }),
    );
    expect(items.map((i) => i.kind)).toEqual(["outcome", "feedback", "finding"]);
    expect(items[2].title).toContain("(fixed)");
    expect(items[0].body).toContain("Limitations: No live CMS");
  });

  it("remembers change requests after the PR with the original plan", () => {
    const original = { summary: "Badge filters and new dealer cards", markdown: "", acceptanceCriteria: ["x"], checks: [], specialization: "", risks: [] };
    const items = extractMemories(
      run({
        ticketKey: "DPP-2937",
        title: "Find dealers",
        plan: { ...original, summary: "Add space between map and badges" },
        development: { summary: "Added 16px gap", files: [], criteriaCovered: [], limitations: [] },
        planFeedback: ["Change request after the PR: Keep the old dealer cards", "Use SmartLink"],
        revisions: [
          { number: 1, request: "Keep the old dealer cards", requestedAt: "a", fromCommit: "a", startHash: "a", previousPlan: original, previousDevelopment: { summary: "Built cards and filters", files: [], criteriaCovered: [], limitations: [] }, developmentSummary: "Restored the cards", completedAt: "b" },
          { number: 2, request: "Add space between the map and the badges", requestedAt: "c", fromCommit: "c", startHash: "c" },
        ],
      }),
    );
    const outcome = items[0].body;
    expect(outcome).toContain("Original plan: Badge filters and new dealer cards");
    expect(outcome).toContain("First version built: Built cards and filters");
    expect(outcome).toContain("Change request 1 (pushed): Keep the old dealer cards -> Restored the cards");
    expect(outcome).toContain("Change request 2 (in progress)");
    expect(outcome).toContain("Latest change built: Added 16px gap");
    const feedback = items.filter((i) => i.kind === "feedback").map((i) => i.title);
    expect(feedback).toEqual([
      "Your change request 1 on DPP-2937 after the PR",
      "Your change request 2 on DPP-2937 after the PR",
      "Your plan feedback on DPP-2937",
    ]);
  });

  it("finds related memories by meaning of words and shared files, never across projects", async () => {
    const m = await db();
    m.recordRun(run({ id: "a", ticketKey: "DPP-1", title: "Dealer locator map", files: ["src/blocks/Dealer.tsx"], development: { summary: "Map search for dealers", files: [], criteriaCovered: [], limitations: [] } }));
    m.recordRun(run({ id: "b", ticketKey: "DPP-2", title: "Checkout button alignment", files: ["src/pages/Checkout.tsx"], development: { summary: "Aligned buttons", files: [], criteriaCovered: [], limitations: [] } }));
    m.recordRun(run({ id: "c", projectId: "other-customer", ticketKey: "FAZ-9", title: "Dealer list for Fazer", development: { summary: "Dealer list", files: [], criteriaCovered: [], limitations: [] } }));
    const found = m.forTask(run({ id: "new", title: "Show dealers closer to the user", description: "Improve the dealer locator", files: [] }));
    expect(found[0].runLabel).toBe("DPP-1");
    expect(found.some((f) => f.runLabel === "FAZ-9")).toBe(false);
    const byFile = m.forTask(run({ id: "new2", title: "Spacing fix", description: "padding", files: ["src/pages/Checkout.tsx"], plan: { summary: "checkout spacing", markdown: "", acceptanceCriteria: ["x"], checks: [], specialization: "", risks: [] } }));
    expect(byFile[0].runLabel).toBe("DPP-2");
  });

  it("always includes pinned notes, supports Swedish text and survives re-recording a run", async () => {
    const m = await db();
    m.add("p1", "Always use themeColors", "Never hardcode colours; use themeColors from src/theme.");
    m.recordRun(run({ id: "a", title: "Återförsäljare på kartan", development: { summary: "Karta", files: [], criteriaCovered: [], limitations: [] } }));
    expect(m.list("p1", "aterforsaljare")[0].title).toContain("Återförsäljare");
    const picked = m.forTask(run({ id: "z", title: "Unrelated", description: "nothing in common", plan: undefined }));
    expect(picked.map((p) => p.title)).toEqual(["Always use themeColors"]);
    const before = m.count("p1");
    m.recordRun(run({ id: "a", title: "Återförsäljare på kartan", development: { summary: "Karta v2", files: [], criteriaCovered: [], limitations: [] } }));
    expect(m.count("p1")).toBe(before);
    const item = m.list("p1")[0];
    m.update(item.id, { body: "password=hunter2hunter2 updated" });
    expect(m.list("p1").find((i) => i.id === item.id)?.body).toContain("password=[redacted]");
    m.delete(item.id);
    expect(m.count("p1")).toBe(before - 1);
  });
});
