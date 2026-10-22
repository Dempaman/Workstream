import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { Store } from "../electron/store";
import { Workflow } from "../electron/workflow";
import { git } from "../electron/process";
import type { Plan, Run } from "../shared/types";

const plan: Plan = {
  summary: "Add a file",
  markdown: "Create result.txt.",
  acceptanceCriteria: ["result.txt contains done"],
  checks: [{ name: "Check result", executable: "node", args: ["-e", "if(require('fs').readFileSync('result.txt','utf8')!=='done')process.exit(1)"] }],
  specialization: "file update",
  risks: [],
};
const finished = (run: Run) => vi.waitFor(() => expect(run.status).not.toBe("running"), { timeout: 60000, interval: 50 });

describe("tests before publishing", () => {
  it("runs the unit tests on the task branch and stops publishing when they fail", async () => {
    const directory = await mkdtemp(join(tmpdir(), "workstream-gate-"));
    await git(directory, ["init", "-b", "develop"]);
    await git(directory, ["config", "user.name", "Workstream Test"]);
    await git(directory, ["config", "user.email", "test@example.invalid"]);
    await writeFile(join(directory, ".gitignore"), "node_modules\n");
    await writeFile(join(directory, "package.json"), JSON.stringify({ name: "gate", type: "module" }));
    await writeFile(join(directory, "sum.test.mjs"), 'import { test, expect } from "vitest";\ntest("adds", () => expect(1 + 1).toBe(3));\n');
    await git(directory, ["add", "."]);
    await git(directory, ["commit", "-m", "base"]);
    await git(directory, ["remote", "add", "origin", directory]);
    await git(directory, ["fetch", "origin"]);
    // The repository's node_modules (Vitest) is borrowed by the task worktree.
    await symlink(join(process.cwd(), "node_modules"), join(directory, "node_modules"), "junction");
    const store = new Store(await mkdtemp(join(tmpdir(), "workstream-gate-state-")));
    const workflow = new Workflow(store, join(process.cwd(), "skills"), join(directory, "worktrees"), () => {}, async () => {});
    vi.spyOn(workflow.codex, "connect").mockResolvedValue();
    vi.spyOn(workflow.codex, "startThread").mockImplementation(async () => randomUUID());
    await workflow.command({ type: "connectProject", path: directory });
    const project = store.state.projects[0];
    await workflow.command({ type: "createRun", projectId: project.id, title: "Add a result", ticketKey: "", description: "Add result.txt." });
    const run = store.state.runs[0];
    vi.spyOn(workflow.codex, "run").mockImplementation(async () => {
      if (run.stage === "planning") return JSON.stringify(plan);
      if (run.stage === "developing") {
        await writeFile(join(run.worktree!, "result.txt"), "done");
        return JSON.stringify({ summary: "Added", files: ["result.txt"], criteriaCovered: plan.acceptanceCriteria, limitations: [] });
      }
      return JSON.stringify({ verdict: "pass", summary: "Fine", findings: [], acceptanceGaps: [] });
    });
    await workflow.command({ type: "plan", runId: run.id });
    await finished(run);
    await workflow.command({ type: "approve", runId: run.id, plan: run.plan!, publish: false });
    await finished(run);
    expect(run.stage).toBe("ready");

    project.testGate = { unit: true, e2e: false };
    await workflow.command({ type: "publish", runId: run.id });
    await finished(run);
    expect(run.testGate?.status).toBe("failed");
    expect(run.testGate?.unit).toMatchObject({ files: 1, failed: 1 });
    expect(run.testGate?.unit?.failures[0]).toMatchObject({ file: "sum.test.mjs", title: "adds" });
    expect(run.stage).toBe("ready");
    expect(run.error).toMatch(/Tests failed on this branch before publishing/);
    expect(run.commit).toBeUndefined();
    // Nothing was committed on the task branch.
    expect(await git(run.worktree!, ["log", "--oneline", "-1"])).toContain("base");

    // Publishing anyway is your explicit decision, recorded with the reason (it also goes into the PR description).
    await workflow.command({ type: "publishWithoutTests", runId: run.id, reason: "The sum test is known to be broken on develop" });
    await finished(run);
    expect(run.testGate?.overridden).toBe("The sum test is known to be broken on develop");
    expect(run.activity.some((a) => a.text.includes("Publishing without passing tests"))).toBe(true);
    expect(run.activity.filter((a) => a.text.startsWith("Running the unit tests before publishing"))).toHaveLength(1);
  }, 120_000);
});
