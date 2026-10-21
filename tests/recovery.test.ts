import { describe, expect, it } from "vitest";
import { acceptBlockers, codeProblems, fixRequest } from "../shared/gates";
import type { Run } from "../shared/types";

const run = (over: Partial<Run>) =>
  ({ checks: [], reviews: [], sessions: [], repairCount: 2, status: "blocked", stage: "reviewing", ...over }) as unknown as Run;
const review = (findings: unknown[], gaps: string[] = []) => ({ verdict: "changes_requested", summary: "", findings, acceptanceGaps: gaps });

describe("recovery guide", () => {
  it("lists failed checks, review errors and warnings and failed behaviour, not info notes", () => {
    const r = run({
      checks: [{ name: "Lint", executable: "npm", args: ["run", "lint"], exitCode: 1, output: "", passed: false }] as never,
      reviews: [
        review([
          { severity: "error", file: "src/a.tsx", line: 12, scenario: "Crashes when list is empty.", recommendation: "Guard the empty case." },
          { severity: "warning", file: "src/b.ts", line: 0, scenario: "Unused import.", recommendation: "" },
          { severity: "info", file: "src/c.ts", line: 1, scenario: "Nice.", recommendation: "" },
        ]),
      ] as never,
      verification: { summary: "", evidence: [{ check: "Paragraph shown", result: "failed", details: "Not rendered" }], needs: [] } as never,
    });
    const problems = codeProblems(r);
    expect(problems.map((p) => p.kind)).toEqual(["check", "error", "warning", "behaviour"]);
    expect(problems[1]).toMatchObject({ where: "src/a.tsx:12", fix: "Guard the empty case." });
    expect(problems[2]!.where).toBe("src/b.ts");
    const request = fixRequest(r);
    expect(request).toContain("1. npm run lint: Lint failed (exit code 1).");
    expect(request).toContain("2. src/a.tsx:12: Crashes when list is empty. Fix: Guard the empty case.");
    expect(acceptBlockers(r)).toHaveLength(3);
  });

  it("has no code problems when only unconfirmed items remain, so they can be accepted", () => {
    const r = run({ reviews: [review([], ["Legal approval of the wording"])] as never });
    expect(codeProblems(r)).toEqual([]);
    expect(acceptBlockers(r)).toEqual([]);
  });
});

describe("fixing findings directly", () => {
  it("is allowed inside an open change round before the PR, not while running or after publishing", async () => {
    const { fixAllowed } = await import("../shared/gates");
    const base = { status: "blocked", stage: "reviewing", approval: {}, worktree: "C:/w", revisions: [{ number: 1 }] };
    expect(fixAllowed(base as never)).toBe(true);
    expect(fixAllowed({ ...base, status: "running" } as never)).toBe(false);
    expect(fixAllowed({ ...base, stage: "complete", prUrl: "https://x" } as never)).toBe(false);
    expect(fixAllowed({ ...base, approval: undefined } as never)).toBe(false);
  });
});

describe("proposed criteria at approval", () => {
  it("leaves out proposed criteria you did not tick and keeps confirmed ones", async () => {
    const { isProposedCriterion, planWithCriteria } = await import("../shared/gates");
    const plan = {
      acceptanceCriteria: [
        "Confirmed: Dates show YYYY-MM-DD only.",
        "Proposed: Malformed data never crashes.",
        "Proposed: Readable at 200% zoom.",
      ],
    };
    expect(plan.acceptanceCriteria.filter(isProposedCriterion)).toHaveLength(2);
    expect(planWithCriteria(plan, []).acceptanceCriteria).toEqual(["Confirmed: Dates show YYYY-MM-DD only."]);
    expect(planWithCriteria(plan, ["Proposed: Readable at 200% zoom."]).acceptanceCriteria).toHaveLength(2);
  });
});

describe("acceptance after commit hooks reformat files", () => {
  it("carries over only when every new gap was accepted before and there are no code findings", async () => {
    const { acceptanceCarriesOver } = await import("../electron/guards");
    const run = { acceptedGaps: [{ text: "Legal approval" }, { text: "CMS translations" }] } as never;
    const review = (gaps: string[], findings: unknown[] = []) =>
      ({ verdict: "changes_requested", summary: "", findings, acceptanceGaps: gaps }) as never;
    expect(acceptanceCarriesOver(run, review(["Legal approval"]))).toBe(true);
    expect(acceptanceCarriesOver(run, review(["Legal approval", "New gap"]))).toBe(false);
    expect(acceptanceCarriesOver(run, review(["Legal approval"], [{ severity: "warning" }]))).toBe(false);
    expect(acceptanceCarriesOver({} as never, review(["Legal approval"]))).toBe(false);
  });
});
