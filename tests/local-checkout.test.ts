import { mkdir, mkdtemp, readFile, writeFile, access } from "node:fs/promises";
import { join, basename, dirname } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { git } from "../electron/process";
import { checkoutInRepo, describeLocation, discardLocalTests, prepareWorktree, pullTargetBranch, removeTaskWorktree, switchRepoBack, worktreeRootFor } from "../electron/repository";
import { detectDevCommand, findLocalUrl } from "../electron/devserver";
import type { Project, Run } from "../shared/types";

const exists = (path: string) => access(path).then(() => true, () => false);

async function setup() {
  const base = await mkdtemp(join(tmpdir(), "ws-local-"));
  const remote = join(base, "remote.git");
  await git(base, ["init", "--bare", "-b", "develop", remote]);
  const repo = join(base, "shop");
  await git(base, ["clone", remote, repo]).catch(async () => {
    await git(base, ["init", "-b", "develop", repo]);
  });
  for (const [k, v] of [["user.name", "T"], ["user.email", "t@example.invalid"]]) await git(repo, ["config", k, v]);
  await writeFile(join(repo, ".gitignore"), ".env*\nnode_modules\n");
  await writeFile(join(repo, "app.txt"), "base");
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "-m", "base"]);
  await git(repo, ["remote", "remove", "origin"]).catch(() => {});
  await git(repo, ["remote", "add", "origin", remote]);
  await git(repo, ["push", "-u", "origin", "develop"]);
  await writeFile(join(repo, ".env"), "SECRET=1");
  await writeFile(join(repo, ".env.local"), "LOCAL=1");
  const project = { id: "p", path: repo, remote, provider: "azure", targetBranch: "develop", branchPrefix: "feature" } as Project;
  const run = { id: "run-1", branch: "feature/DPP-7-fix-price", targetBranch: "develop", localOnlyFiles: [] } as unknown as Run;
  return { base, repo, project, run };
}

describe("worktrees next to the repository", () => {
  it("creates a readable worktree beside the repo and copies ignored .env files", async () => {
    const { repo, project, run } = await setup();
    await prepareWorktree(project, run);
    expect(dirname(run.worktree!)).toBe(worktreeRootFor(project));
    expect(basename(run.worktree!)).toBe("DPP-7-fix-price");
    expect(worktreeRootFor(project)).toBe(`${repo}.worktrees`);
    expect(run.envFiles?.sort()).toEqual([".env", ".env.local"]);
    expect(await readFile(join(run.worktree!, ".env"), "utf8")).toBe("SECRET=1");
    // Copied settings never show up as changes.
    expect(await git(run.worktree!, ["status", "--porcelain"])).toBe("");
  });

  it("removes the worktree after the PR, checks the branch out in the repo and can switch back", async () => {
    const { repo, project, run } = await setup();
    await prepareWorktree(project, run);
    await writeFile(join(run.worktree!, "app.txt"), "fixed");
    await writeFile(join(run.worktree!, "price.test.ts"), "local test");
    await git(run.worktree!, ["commit", "-am", "fix"]);
    await git(run.worktree!, ["push", "-u", "origin", run.branch]);
    run.commit = await git(run.worktree!, ["rev-parse", "HEAD"]);
    run.prUrl = "https://example/pr/1";
    run.localOnlyFiles = ["price.test.ts"];
    // Uncommitted work in the repo stops it without touching anything.
    await writeFile(join(repo, "app.txt"), "my own change");
    await expect(checkoutInRepo(project, run)).rejects.toThrow("uncommitted changes");
    expect(await exists(run.worktree!)).toBe(true);
    await git(repo, ["checkout", "--", "app.txt"]);
    const result = await checkoutInRepo(project, run);
    expect(result.previous).toBe("develop");
    expect(await git(repo, ["branch", "--show-current"])).toBe(run.branch);
    expect(await readFile(join(repo, "app.txt"), "utf8")).toBe("fixed");
    expect(await exists(run.worktree!)).toBe(false);
    expect(run.worktreeRemoved).toBe(true);
    // Local-only tests are not kept anywhere: they were never part of the PR.
    expect(result.moved).toEqual(["price.test.ts"]);
    expect(await exists(join(`${repo}.worktrees`, "_kept-local-tests"))).toBe(false);
    await switchRepoBack(project, run.previousRepoBranch!);
    expect(await git(repo, ["branch", "--show-current"])).toBe("develop");
    await expect(prepareWorktree(project, run)).rejects.toThrow("removed after its pull request");
  });

  it("puts changed repository tests back to their committed version before checking out", async () => {
    const { repo, project, run } = await setup();
    await writeFile(join(repo, "price.test.ts"), "original test");
    await git(repo, ["add", "price.test.ts"]);
    await git(repo, ["commit", "-m", "test"]);
    await git(repo, ["push", "origin", "develop"]);
    await prepareWorktree(project, run);
    await writeFile(join(run.worktree!, "app.txt"), "fixed");
    await git(run.worktree!, ["commit", "-am", "fix"]);
    await git(run.worktree!, ["push", "-u", "origin", run.branch]);
    run.commit = await git(run.worktree!, ["rev-parse", "HEAD"]);
    run.prUrl = "https://example/pr/1";
    await writeFile(join(run.worktree!, "price.test.ts"), "edited test");
    const result = await checkoutInRepo(project, run);
    expect(await git(repo, ["branch", "--show-current"])).toBe(run.branch);
    expect(await readFile(join(repo, "price.test.ts"), "utf8")).toBe("original test");
    expect(result.moved).toEqual(["price.test.ts"]);
  });

  it("removes local tests and agent settings when the task is done, leaving product files alone", async () => {
    const { project, run } = await setup();
    await prepareWorktree(project, run);
    await writeFile(join(run.worktree!, "app.txt"), "fixed");
    await writeFile(join(run.worktree!, "price.test.ts"), "local test");
    await mkdir(join(run.worktree!, ".claude"), { recursive: true });
    await writeFile(join(run.worktree!, ".claude", "settings.local.json"), "{}");
    const removed = await discardLocalTests(run);
    expect(removed.sort()).toEqual([".claude/settings.local.json", "price.test.ts"]);
    expect(await exists(join(run.worktree!, "price.test.ts"))).toBe(false);
    expect(await exists(join(run.worktree!, ".claude"))).toBe(false);
    expect(await readFile(join(run.worktree!, "app.txt"), "utf8")).toBe("fixed");
  });

  it("refuses when the worktree has changes that are not in the PR", async () => {
    const { project, run } = await setup();
    await prepareWorktree(project, run);
    await writeFile(join(run.worktree!, "app.txt"), "x");
    await git(run.worktree!, ["commit", "-am", "x"]);
    await git(run.worktree!, ["push", "-u", "origin", run.branch]);
    run.commit = await git(run.worktree!, ["rev-parse", "HEAD"]);
    run.prUrl = "https://example/pr/2";
    await writeFile(join(run.worktree!, "stray.txt"), "not reviewed");
    await expect(checkoutInRepo(project, run)).rejects.toThrow("not in the PR");
    expect(await exists(run.worktree!)).toBe(true);
  });
});

describe("dev server helpers", () => {
  it("picks the dev script and package manager", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ws-dev-"));
    await writeFile(join(dir, "package.json"), JSON.stringify({ scripts: { start: "x", dev: "vite" } }));
    await writeFile(join(dir, "yarn.lock"), "");
    expect(await detectDevCommand(dir)).toEqual({ manager: "yarn", script: "dev" });
  });
  it("finds the local URL in coloured output", () => {
    const esc = String.fromCharCode(27);
    expect(findLocalUrl(`  ${esc}[32m➜${esc}[39m  Local:   ${esc}[36mhttp://localhost:${esc}[1m5173${esc}[22m/${esc}[39m`)).toBe("http://localhost:5173/");
    expect(findLocalUrl(`ready - started server on 0.0.0.0:3000, url: http://0.0.0.0:3000.`)).toBe("http://localhost:3000");
    expect(findLocalUrl(`Local: ${esc}[36mhttp://localhost:5173/${esc}[39m`)).toBe("http://localhost:5173/");
  });
});

describe("agent settings from every engine", () => {
  it("treats Claude, Copilot and Codex local settings as agent state, not product changes", async () => {
    const { isAgentState } = await import("../electron/repository");
    for (const file of [
      ".claude/settings.local.json",
      ".github/copilot/settings.json",
      ".github/copilot/settings.local.json",
      ".copilot/session.json",
      ".codex/config.toml",
    ])
      expect(isAgentState(file)).toBe(true);
    for (const file of [".github/copilot-instructions.md", ".claude/agents/x.md", "src/app.ts", ".github/workflows/ci.yml"])
      expect(isAgentState(file)).toBe(false);
  });
});

describe("after the pull request is completed", () => {
  /** Someone else merged the task into develop on the server. */
  async function mergedOnServer(base: string, remote: string, branch: string) {
    const other = join(base, "other");
    await git(base, ["clone", remote, other]);
    for (const [k, v] of [["user.name", "M"], ["user.email", "m@example.invalid"]]) await git(other, ["config", k, v]);
    await git(other, ["fetch", "origin", branch]);
    await git(other, ["merge", "--no-ff", "-m", "Merged PR", `origin/${branch}`]);
    await git(other, ["push", "origin", "develop"]);
    return git(other, ["rev-parse", "HEAD"]);
  }
  it("switches the repo from the task branch back to develop and fast-forwards it", async () => {
    const { base, repo, project, run } = await setup();
    await prepareWorktree(project, run);
    await writeFile(join(run.worktree!, "app.txt"), "fixed");
    await git(run.worktree!, ["commit", "-am", "fix"]);
    await git(run.worktree!, ["push", "-u", "origin", run.branch]);
    run.commit = await git(run.worktree!, ["rev-parse", "HEAD"]);
    run.prUrl = "https://example/pr/1";
    // "Check out in my repo" puts the repo on the task branch and removes the worktree.
    await checkoutInRepo(project, run);
    const merged = await mergedOnServer(base, project.remote, run.branch);
    const result = await pullTargetBranch(project, run);
    expect(result).toMatchObject({ switched: true, branch: "develop", after: merged });
    // Like the terminal: what moved, and which commits came in.
    expect(result.total).toBe(2);
    expect(result.commits.map((c) => c.subject)).toEqual(["Merged PR", "fix"]);
    expect(await git(repo, ["rev-parse", "HEAD"])).toBe(merged);
    const where = await describeLocation(project, run);
    expect(where).toMatchObject({ repoBranch: "develop", repoChanges: 0, targetBehind: 0, worktreeExists: false });
    // Pulling again reports "already up to date".
    expect((await pullTargetBranch(project, run)).total).toBe(0);
    // Uncommitted work on the task branch stops the switch.
    await git(repo, ["checkout", run.branch]);
    await writeFile(join(repo, "app.txt"), "my edit");
    await expect(pullTargetBranch(project, run)).rejects.toThrow("uncommitted changes");
    expect(await git(repo, ["branch", "--show-current"])).toBe(run.branch);
  });
  it("removes a finished worktree with its local tests but keeps the branch", async () => {
    const { repo, project, run } = await setup();
    await prepareWorktree(project, run);
    await writeFile(join(run.worktree!, "app.txt"), "fixed");
    await git(run.worktree!, ["commit", "-am", "fix"]);
    await writeFile(join(run.worktree!, "price.test.ts"), "local test");
    const before = await describeLocation(project, run);
    expect(before).toMatchObject({ worktreeExists: true, worktreeBranch: run.branch, worktreeChanges: 1, repoBranch: "develop" });
    await removeTaskWorktree(project, run);
    expect(run.worktreeRemoved).toBe(true);
    expect(await exists(run.worktree!)).toBe(false);
    expect((await describeLocation(project, run)).worktreeExists).toBe(false);
    expect(await git(repo, ["branch", "--list", run.branch])).toContain(run.branch);
  });
  it("updates develop without touching another checked-out branch, and never forces", async () => {
    const { base, repo, project, run } = await setup();
    await prepareWorktree(project, run);
    await writeFile(join(run.worktree!, "app.txt"), "fixed");
    await git(run.worktree!, ["commit", "-am", "fix"]);
    await git(run.worktree!, ["push", "-u", "origin", run.branch]);
    const merged = await mergedOnServer(base, project.remote, run.branch);
    await git(repo, ["checkout", "-b", "my-own-work"]);
    const result = await pullTargetBranch(project, run);
    expect(result).toMatchObject({ switched: false, branch: "my-own-work" });
    expect(await git(repo, ["rev-parse", "develop"])).toBe(merged);
    expect(await git(repo, ["branch", "--show-current"])).toBe("my-own-work");
    // A local develop commit that is not on the server stops the update.
    await git(repo, ["checkout", "develop"]);
    await writeFile(join(repo, "local.txt"), "x");
    await git(repo, ["add", "local.txt"]);
    await git(repo, ["commit", "-m", "local only"]);
    await mergedOnServer(join(base, "again"), project.remote, run.branch).catch(() => {});
    await git(repo, ["checkout", "my-own-work"]);
    const before = await git(repo, ["rev-parse", "develop"]);
    await pullTargetBranch(project, run).catch(() => {});
    expect(await git(repo, ["rev-parse", "develop"])).toBe(before);
  });
  it("keeps the worktree when it has changes that are not in the pull request", async () => {
    const { project, run } = await setup();
    await prepareWorktree(project, run);
    await writeFile(join(run.worktree!, "app.txt"), "unpublished edit");
    await expect(removeTaskWorktree(project, run)).rejects.toThrow("not in the pull request");
    expect(await exists(run.worktree!)).toBe(true);
    expect(run.worktreeRemoved).toBeFalsy();
  });
});
