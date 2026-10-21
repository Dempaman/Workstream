import { describe, expect, it } from "vitest";
import {
  assertApproved,
  branchName,
  planHash,
  reviewPassed,
  safeRemote,
  scopedPath,
} from "../electron/guards";
import { azureRepository } from "../electron/publish";
import { planSchema, type Review, type Run } from "../shared/types";

const plan = planSchema.parse({
  summary: "Fix a bug",
  markdown: "Change the relevant file.",
  acceptanceCriteria: ["Correct behavior"],
  checks: [{ name: "Tests", executable: "npm", args: ["test", "--", "--run"] }],
  specialization: "frontend",
  risks: [],
});
describe("workflow authorization", () => {
  it("requires approval of the exact current plan", () => {
    const run = {
      plan,
      approval: { at: "now", planHash: planHash(plan), publish: false },
    } as Run;
    expect(() => assertApproved(run)).not.toThrow();
    expect(() =>
      assertApproved({
        ...run,
        plan: { ...plan, acceptanceCriteria: ["Different scope"] },
      }),
    ).toThrow("Approve");
    expect(() => assertApproved({ ...run, approval: undefined })).toThrow(
      "Approve",
    );
  });
  it("does not accept a pass verdict with unresolved warnings or acceptance gaps", () => {
    const review: Review = {
      verdict: "pass",
      summary: "Fine",
      findings: [],
      acceptanceGaps: [],
    };
    expect(reviewPassed(review)).toBe(true);
    expect(
      reviewPassed({ ...review, acceptanceGaps: ["No mobile check"] }),
    ).toBe(false);
    expect(
      reviewPassed({
        ...review,
        findings: [
          {
            severity: "warning",
            file: "x.ts",
            line: 1,
            scenario: "Cache becomes stale",
            recommendation: "Invalidate",
          },
        ],
      }),
    ).toBe(false);
    expect(reviewPassed({ ...review, verdict: "changes_requested" })).toBe(
      false,
    );
  });
});
describe("repository boundaries", () => {
  it("rejects files outside the worktree, Git internals, and common secret files", () => {
    const root = process.cwd();
    expect(scopedPath(root, "src/app.ts")).toMatch(/src[\\/]app.ts/);
    for (const file of [
      "../secret.txt",
      ".git/config",
      ".env",
      ".env.local",
      "keys/private.pem",
    ])
      expect(() => scopedPath(root, file)).toThrow();
  });
  it("does not invent ticket keys and produces project-specific branches", () => {
    expect(branchName("feature", "DPP-1234", "Fix button layout")).toBe(
      "feature/DPP-1234-fix-button-layout",
    );
    expect(branchName("codex", "", "Add support")).toBe("codex/add-support");
    expect(() => branchName("feature", "ticket; rm", "Fix")).toThrow();
  });
  it("redacts credential-bearing repository URLs", () => {
    expect(
      safeRemote(
        "https://user:secret@dev.azure.com/org/project/_git/repo?token=secret",
      ),
    ).toBe("https://dev.azure.com/org/project/_git/repo");
  });
  it("recognizes supported Azure URL forms without misrouting GitHub", () => {
    const expected = {
      organization: "org",
      project: "project",
      repository: "repo",
    };
    expect(
      azureRepository("https://dev.azure.com/org/project/_git/repo"),
    ).toEqual(expected);
    expect(azureRepository("ssh.dev.azure.com:v3/org/project/repo")).toEqual(
      expected,
    );
    expect(
      azureRepository("https://org.visualstudio.com/project/_git/repo"),
    ).toEqual(expected);
    expect(() => azureRepository("https://github.com/org/repo")).toThrow();
  });
});
