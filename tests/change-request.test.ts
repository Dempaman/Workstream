import { mkdtemp, readFile, writeFile, access, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { git } from "../electron/process";
import { checkoutInRepo, prepareWorktree, reopenWorktree } from "../electron/repository";
import { activeRevision, type Plan, type Project, type Run } from "../shared/types";

vi.mock("../electron/publish", async (original) => {
  const actual = await original<typeof import("../electron/publish")>();
  const { git: g } = await import("../electron/process");
  return {
    ...actual,
    pullRequestOpen: vi.fn(async () => "open"),
    // Stand-in for the provider: commit and push to the local bare remote, like the real publisher.
    publish: vi.fn(async (_project: Project, run: Run) => {
      const { activeRevision: active } = await import("../shared/types");
      const revision = active(run);
      // Stage exactly what the real publisher stages: the reviewed file list.
      const { inspectChanges } = await import("../electron/repository");
      const before = await inspectChanges(run);
      await g(run.worktree!, ["add", "--", ...before.files]);
      await g(run.worktree!, ["commit", "-m", revision ? `change request ${revision.number}` : "first"]);
      await g(run.worktree!, ["push", "--set-upstream", "origin", run.branch]);
      run.commit = await g(run.worktree!, ["rev-parse", "HEAD"]);
      // Like the real publisher: nothing may be left uncommitted and the reviewed hash must not move.
      if ((await g(run.worktree!, ["status", "--porcelain"])) || (await inspectChanges(run)).hash !== before.hash)
        throw new actual.ReviewContentChanged("Commit hooks or another process changed the reviewed content.");
      descriptions.push(actual.pullRequestDescription(run, []));
      return "https://example.invalid/pr/1";
    }),
  };
});
const descriptions: string[] = [];
const { Store } = await import("../electron/store");
const { Workflow } = await import("../electron/workflow");
const publishModule = await import("../electron/publish");

const exists = (path: string) => access(path).then(() => true, () => false);
const planFor = (text: string): Plan => ({
  summary: `Write ${text}`,
  markdown: `result.txt contains ${text}`,
  acceptanceCriteria: [`result.txt contains ${text}`],
  checks: [
    {
      name: "Check result",
      executable: "node",
      args: ["-e", `if(require('fs').readFileSync('result.txt','utf8')!==${JSON.stringify(text)})process.exit(1)`],
    },
  ],
  specialization: "file update",
  risks: [],
});

async function repoWithRemote(prefix: string) {
  const base = await mkdtemp(join(tmpdir(), prefix));
  const remote = join(base, "remote.git");
  await git(base, ["init", "--bare", "-b", "develop", remote]);
  const repo = join(base, "shop");
  await git(base, ["init", "-b", "develop", repo]);
  for (const [k, v] of [["user.name", "T"], ["user.email", "t@example.invalid"]]) await git(repo, ["config", k, v]);
  await writeFile(join(repo, ".gitignore"), ".env*\n");
  await writeFile(join(repo, "base.txt"), "base");
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "-m", "base"]);
  await git(repo, ["remote", "add", "origin", remote]);
  await git(repo, ["push", "-u", "origin", "develop"]);
  return { base, remote, repo };
}

async function flow() {
  const { base, remote, repo } = await repoWithRemote("ws-change-");
  const store = new Store(await mkdtemp(join(tmpdir(), "ws-change-state-")));
  const workflow = new Workflow(store, join(process.cwd(), "skills"), join(base, "fallback"), () => {}, async () => {});
  vi.spyOn(workflow.codex, "connect").mockResolvedValue();
  const thread = vi.spyOn(workflow.codex, "startThread").mockImplementation(async () => randomUUID());
  await workflow.command({ type: "connectProject", path: repo });
  await workflow.command({
    type: "createRun",
    projectId: store.state.projects[0].id,
    title: "Add a result",
    ticketKey: "DPP-1",
    description: "Add result.txt containing done.",
  });
  const run = store.state.runs[0];
  let wanted = "done";
  let baseText = "changed";
  const prompts: string[] = [];
  vi.spyOn(workflow.codex, "run").mockImplementation(async (_thread, prompt) => {
    prompts.push(String(prompt));
    if (run.stage === "planning") return JSON.stringify(planFor(wanted));
    if (run.stage === "developing") {
      await writeFile(join(run.worktree!, "result.txt"), wanted);
      await writeFile(join(run.worktree!, "base.txt"), baseText);
      return JSON.stringify({ summary: `Wrote ${wanted}`, files: ["result.txt"], criteriaCovered: [], limitations: [] });
    }
    return JSON.stringify({ verdict: "pass", summary: "Looks right", findings: [], acceptanceGaps: [] });
  });
  const finished = () =>
    vi.waitFor(() => expect(run.status).not.toBe("running"), { timeout: 15000, interval: 20 });
  await workflow.command({ type: "plan", runId: run.id });
  await finished();
  await workflow.command({ type: "approve", runId: run.id, plan: run.plan!, publish: true });
  await finished();
  expect(run.error).toBeUndefined();
  expect(run.stage).toBe("complete");
  return { workflow, store, run, remote, repo, thread, prompts, finished, want: (text: string) => (wanted = text), setBase: (text: string) => (baseText = text) };
}

describe("change requests on an existing pull request", () => {
  it("plans, develops, reviews and pushes a new commit to the same branch", async () => {
    const { workflow, run, remote, thread, prompts, finished, want } = await flow();
    const firstCommit = run.commit!;
    const firstPlan = run.plan!;
    want("done twice");
    await workflow.command({ type: "requestChanges", runId: run.id, request: "Make it say done twice" });
    await finished();
    expect(run.error).toBeUndefined();
    expect(run.stage).toBe("approval");
    const revision = activeRevision(run)!;
    expect(revision.number).toBe(1);
    expect(revision.fromCommit).toBe(firstCommit);
    expect(revision.previousPlan).toEqual(firstPlan);
    expect(run.approval).toBeUndefined();
    expect(run.repairCount).toBe(0);
    // The change planner reads the PR branch, not the repository folder.
    expect(thread.mock.calls.at(-1)![0]).toBe(run.worktree);
    expect(prompts.at(-1)).toContain("Make it say done twice");
    expect(prompts.at(-1)).toContain("Plan only these changes");
    // Development cannot start without approving the change plan.
    await expect(workflow.command({ type: "continue", runId: run.id })).rejects.toThrow("Approve");
    await workflow.command({ type: "approve", runId: run.id, plan: run.plan!, publish: true });
    await finished();
    expect(run.error).toBeUndefined();
    expect(run.stage).toBe("complete");
    expect(prompts.some((p) => p.includes("changesThisRound"))).toBe(true);
    expect(activeRevision(run)).toBeUndefined();
    expect(run.revisions![0].completedAt).toBeTruthy();
    expect(run.revisions![0].commit).toBe(run.commit);
    expect(run.revisions![0].developmentSummary).toBe("Wrote done twice");
    // Appended on top of the first commit, never rewritten.
    expect(await git(remote, ["rev-parse", `refs/heads/${run.branch}`])).toBe(run.commit);
    expect(await git(remote, ["rev-parse", `${run.commit}^`])).toBe(firstCommit);
    const description = descriptions.at(-1)!;
    expect(description).toContain("Write done");
    expect(description).toContain("Change request 1: Make it say done twice");
    expect(description).toContain("Plan: Write done twice");
    workflow.close();
  }, 40_000);

  it("commits files that the change request restores to their original content", async () => {
    // Round 1 changed base.txt; the change request puts it back exactly as it was on develop.
    const { workflow, run, remote, finished, want, setBase } = await flow();
    expect(await git(remote, ["show", `${run.branch}:base.txt`])).toBe("changed");
    want("done twice");
    setBase("base");
    await workflow.command({ type: "requestChanges", runId: run.id, request: "Keep base.txt as it was" });
    await finished();
    await workflow.command({ type: "approve", runId: run.id, plan: run.plan!, publish: true });
    await finished();
    expect(run.error).toBeUndefined();
    expect(run.stage).toBe("complete");
    expect(await git(remote, ["show", `${run.branch}:base.txt`])).toBe("base");
    expect(await git(run.worktree!, ["status", "--porcelain"])).toBe("");
    workflow.close();
  }, 40_000);

  it("turns line comments on a published run into a change request", async () => {
    const { workflow, run, prompts, finished } = await flow();
    await workflow.command({ type: "addComment", runId: run.id, file: "result.txt", line: 1, side: "new", code: "done", text: "Say done twice" });
    await workflow.command({ type: "sendComments", runId: run.id });
    await finished();
    expect(run.stage).toBe("approval");
    expect(activeRevision(run)?.request).toContain("1. result.txt, line 1 (`done`): Say done twice");
    expect(prompts.at(-1)).toContain("Say done twice");
    expect(run.comments![0].status).toBe("sent");
    workflow.close();
  }, 40_000);

  it("takes a change request before the PR, keeps it unpublished until review passes, then publishes once", async () => {
    const { workflow, store, remote } = await flow();
    // A second task that stops at Ready (publish not approved yet).
    await workflow.command({ type: "createRun", projectId: store.state.projects[0].id, title: "Second", ticketKey: "DPP-2", description: "Write done." });
    const run = store.state.runs.find((r) => r.ticketKey === "DPP-2")!;
    const finished = () => vi.waitFor(() => expect(run.status).not.toBe("running"), { timeout: 15000, interval: 20 });
    let wanted = "done";
    vi.mocked(workflow.codex.run).mockImplementation(async () => {
      if (run.stage === "planning") return JSON.stringify(planFor(wanted));
      if (run.stage === "developing") {
        await writeFile(join(run.worktree!, "result.txt"), wanted);
        return JSON.stringify({ summary: `Wrote ${wanted}`, files: ["result.txt"], criteriaCovered: [], limitations: [] });
      }
      return JSON.stringify({ verdict: "pass", summary: "Looks right", findings: [], acceptanceGaps: [] });
    });
    await workflow.command({ type: "plan", runId: run.id });
    await finished();
    await workflow.command({ type: "approve", runId: run.id, plan: run.plan!, publish: false });
    await finished();
    expect(run.stage).toBe("ready");
    const before = { reviewedHash: run.reviewedHash, plan: run.plan };
    // Cancelling right away returns to Ready with the earlier review intact.
    await workflow.command({ type: "requestChanges", runId: run.id, request: "Actually change it" });
    await finished();
    expect(run.stage).toBe("approval");
    expect(activeRevision(run)?.beforePr).toBe(true);
    await workflow.command({ type: "cancelChanges", runId: run.id });
    expect(run.stage).toBe("ready");
    expect(run.reviewedHash).toBe(before.reviewedHash);
    expect(run.plan).toEqual(before.plan);
    // Now for real.
    wanted = "done twice";
    await workflow.command({ type: "requestChanges", runId: run.id, request: "Make it say done twice" });
    await finished();
    await workflow.command({ type: "approve", runId: run.id, plan: run.plan!, publish: true });
    await finished();
    expect(run.error).toBeUndefined();
    expect(run.stage).toBe("complete");
    // One commit on top of develop: the change request is part of the first version.
    expect(await git(remote, ["rev-list", "--count", `develop..${run.branch}`])).toBe("1");
    expect(await git(remote, ["show", `${run.branch}:result.txt`])).toBe("done twice");
    expect(descriptions.at(-1)).toContain("Change request 1 (before the PR): Make it say done twice");
    workflow.close();
  }, 60_000);

  it("can be cancelled before any file changed and leaves the PR as it was", async () => {
    const { workflow, run, finished, want } = await flow();
    const before = { plan: run.plan, commit: run.commit, checks: run.checks };
    want("something else");
    await workflow.command({ type: "requestChanges", runId: run.id, request: "Try something else" });
    await finished();
    expect(run.stage).toBe("approval");
    await workflow.command({ type: "cancelChanges", runId: run.id });
    expect(run.stage).toBe("complete");
    expect(run.revisions).toEqual([]);
    expect(run.plan).toEqual(before.plan);
    expect(run.commit).toBe(before.commit);
    expect(run.checks).toEqual(before.checks);
    expect(run.approval?.publish).toBe(true);
    workflow.close();
  }, 40_000);

  it("refuses when the pull request is no longer open", async () => {
    const { workflow, run, finished } = await flow();
    vi.mocked(publishModule.pullRequestOpen).mockResolvedValueOnce("closed");
    await workflow.command({ type: "requestChanges", runId: run.id, request: "One more thing" });
    await finished();
    expect(run.status).toBe("blocked");
    expect(run.error).toContain("completed or abandoned");
    expect(run.stage).toBe("complete");
    expect(run.revisions ?? []).toEqual([]);
    workflow.close();
  }, 40_000);

  it("stops when the developer changed nothing for the request", async () => {
    const { workflow, run, finished, want } = await flow();
    want("done"); // same content as already committed
    await workflow.command({ type: "requestChanges", runId: run.id, request: "Keep it as it is" });
    await finished();
    await workflow.command({ type: "approve", runId: run.id, plan: run.plan!, publish: true });
    await finished();
    expect(run.status).toBe("blocked");
    expect(run.error).toContain("made no changes");
    // Nothing changed, so it can still be cancelled.
    await workflow.command({ type: "cancelChanges", runId: run.id });
    expect(run.stage).toBe("complete");
    workflow.close();
  }, 40_000);

  it("only accepts change requests on finished runs", async () => {
    const { workflow, run, finished } = await flow();
    run.stage = "ready";
    await expect(
      workflow.command({ type: "requestChanges", runId: run.id, request: "Change it" }),
    ).rejects.toThrow("Request changes is available once");
    run.stage = "complete";
    await finished();
    workflow.close();
  }, 40_000);
});

describe("reopening the pull request branch", () => {
  async function published() {
    const { base, remote, repo } = await repoWithRemote("ws-reopen-");
    await writeFile(join(repo, ".env"), "SECRET=1");
    const project = { id: "p", path: repo, remote, provider: "azure", targetBranch: "develop", branchPrefix: "feature" } as Project;
    const run = { id: "r", branch: "feature/DPP-9-price", targetBranch: "develop", localOnlyFiles: [] } as unknown as Run;
    await prepareWorktree(project, run);
    await writeFile(join(run.worktree!, "price.txt"), "1");
    await git(run.worktree!, ["add", "price.txt"]);
    await git(run.worktree!, ["-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-m", "price"]);
    await git(run.worktree!, ["push", "-u", "origin", run.branch]);
    run.commit = await git(run.worktree!, ["rev-parse", "HEAD"]);
    run.prUrl = "https://example.invalid/pr/9";
    return { base, remote, repo, project, run };
  }
  async function pushFromColleague(base: string, remote: string, branch: string, force = false) {
    const other = join(base, `colleague-${randomUUID()}`);
    await git(base, ["clone", "-b", branch, remote, other]);
    if (force) await git(other, ["reset", "--hard", "HEAD~1"]);
    await writeFile(join(other, "colleague.txt"), "hello");
    await git(other, ["add", "colleague.txt"]);
    await git(other, ["-c", "user.name=C", "-c", "user.email=c@example.invalid", "commit", "-m", "colleague"]);
    await git(other, ["push", ...(force ? ["--force"] : []), "origin", branch]);
    return git(other, ["rev-parse", "HEAD"]);
  }

  it("recreates the worktree after Check out in my repo and picks up newer commits", async () => {
    const { base, remote, repo, project, run } = await published();
    await checkoutInRepo(project, run);
    expect(await git(repo, ["branch", "--show-current"])).toBe(run.branch);
    const colleague = await pushFromColleague(base, remote, run.branch);
    const result = await reopenWorktree(project, run);
    expect(result.fromCommit).toBe(colleague);
    expect(result.notes.join(" ")).toContain("1 newer commit");
    expect(result.notes.join(" ")).toContain("back to develop");
    expect(await git(repo, ["branch", "--show-current"])).toBe("develop");
    expect(run.worktreeRemoved).toBe(false);
    expect(await exists(run.worktree!)).toBe(true);
    expect(await git(run.worktree!, ["rev-parse", "HEAD"])).toBe(colleague);
    expect(await readFile(join(run.worktree!, ".env"), "utf8")).toBe("SECRET=1");
  });

  it("fast-forwards an existing worktree and refuses unexpected local changes", async () => {
    const { base, remote, project, run } = await published();
    const colleague = await pushFromColleague(base, remote, run.branch);
    await writeFile(join(run.worktree!, "price.txt"), "uncommitted");
    await expect(reopenWorktree(project, run)).rejects.toThrow("changes that are not in the PR");
    await git(run.worktree!, ["checkout", "--", "price.txt"]);
    const result = await reopenWorktree(project, run);
    expect(result.fromCommit).toBe(colleague);
    expect(await git(run.worktree!, ["rev-parse", "HEAD"])).toBe(colleague);
  });

  it("stops without changing anything when your repo has uncommitted changes on the branch", async () => {
    const { repo, project, run } = await published();
    await checkoutInRepo(project, run);
    await writeFile(join(repo, "price.txt"), "my tweak");
    await expect(reopenWorktree(project, run)).rejects.toThrow("uncommitted changes");
    expect(await git(repo, ["branch", "--show-current"])).toBe(run.branch);
    expect(await readFile(join(repo, "price.txt"), "utf8")).toBe("my tweak");
  });

  it("recovers when only an empty worktree folder is left and the repo has the branch", async () => {
    // What a half-finished removal on Windows leaves: files and .git gone, folder kept, branch checked out in the repo.
    const { repo, project, run } = await published();
    const leftover = run.worktree!;
    await git(repo, ["worktree", "remove", "--force", leftover]);
    await mkdir(leftover);
    await git(repo, ["checkout", run.branch]);
    const result = await reopenWorktree(project, run);
    expect(result.fromCommit).toBe(run.commit);
    expect(await git(repo, ["branch", "--show-current"])).toBe("develop");
    expect(await git(run.worktree!, ["rev-parse", "HEAD"])).toBe(run.commit);
    expect(run.worktreeRemoved).toBe(false);
  });

  it("Check out in my repo copes with a worktree that is already gone", async () => {
    const { repo, project, run } = await published();
    const leftover = run.worktree!;
    await git(repo, ["worktree", "remove", "--force", leftover]);
    await mkdir(leftover);
    await checkoutInRepo(project, run);
    expect(await git(repo, ["branch", "--show-current"])).toBe(run.branch);
    expect(run.worktreeRemoved).toBe(true);
    expect(run.previousRepoBranch).toBe("develop");
    expect(await exists(leftover)).toBe(false);
    await rm(leftover, { recursive: true, force: true });
  });

  it("refuses when the pushed branch was rewritten", async () => {
    const { base, remote, project, run } = await published();
    await pushFromColleague(base, remote, run.branch, true);
    await expect(reopenWorktree(project, run)).rejects.toThrow("rewritten");
  });
});
