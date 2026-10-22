import { mkdtemp, writeFile } from "node:fs/promises";
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
  checks: [{ name: "Check", executable: "node", args: ["-e", "0"] }],
  specialization: "file update",
  risks: [],
};
const finished = (run: Run) => vi.waitFor(() => expect(run.status).not.toBe("running"), { timeout: 20000, interval: 20 });

describe("cost limit per task", () => {
  it("stops the task when its sessions reach the limit, and continues after you allow more", async () => {
    const directory = await mkdtemp(join(tmpdir(), "workstream-cost-"));
    await git(directory, ["init", "-b", "develop"]);
    await git(directory, ["config", "user.name", "T"]);
    await git(directory, ["config", "user.email", "t@example.invalid"]);
    await writeFile(join(directory, "base.txt"), "base");
    await git(directory, ["add", "."]);
    await git(directory, ["commit", "-m", "base"]);
    await git(directory, ["remote", "add", "origin", directory]);
    const store = new Store(await mkdtemp(join(tmpdir(), "workstream-cost-state-")));
    const workflow = new Workflow(store, join(process.cwd(), "skills"), join(directory, "worktrees"), () => {}, async () => {});
    store.state.settings.costLimitUsd = 1;
    store.state.settings.prices = { "test-model": { input: 10, cachedInput: 1, output: 10 } };
    vi.spyOn(workflow.codex, "connect").mockResolvedValue();
    vi.spyOn(workflow.codex, "startThread").mockImplementation(async () => randomUUID());
    const interrupt = vi.spyOn(workflow.codex, "interrupt").mockResolvedValue();
    await workflow.command({ type: "connectProject", path: directory });
    await workflow.command({ type: "createRun", projectId: store.state.projects[0].id, title: "T", ticketKey: "", description: "Add result." });
    const run = store.state.runs[0];
    let expensive = true;
    vi.spyOn(workflow.codex, "run").mockImplementation(async (threadId) => {
      if (run.stage === "planning") return JSON.stringify(plan);
      if (run.stage === "developing") {
        if (expensive) {
          // 200k input tokens at $10 per million = $2, over the $1 limit.
          workflow.codex.emit("usage", threadId, { totalTokens: 200000, inputTokens: 200000, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, model: "test-model" });
          throw new Error("turn interrupted");
        }
        await writeFile(join(run.worktree!, "result.txt"), "done");
        return JSON.stringify({ summary: "Added", files: ["result.txt"], criteriaCovered: [], limitations: [] });
      }
      return JSON.stringify({ verdict: "pass", summary: "Fine", findings: [], acceptanceGaps: [] });
    });
    await workflow.command({ type: "plan", runId: run.id });
    await finished(run);
    await workflow.command({ type: "approve", runId: run.id, plan: run.plan!, publish: false });
    await finished(run);
    expect(interrupt).toHaveBeenCalled();
    expect(run.costLimitHit).toBe(true);
    expect(run.status).toBe("blocked");
    expect(run.error).toMatch(/reached your limit of \$1\.00/);

    expensive = false;
    await workflow.command({ type: "raiseCostLimit", runId: run.id });
    expect(run.costLimitHit).toBe(false);
    expect(run.costAllowanceUsd).toBeCloseTo(3, 5);
    await workflow.command({ type: "continue", runId: run.id });
    await finished(run);
    expect(run.stage).toBe("ready");
  });
});
