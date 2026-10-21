import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { git } from "../electron/process";
import {
  discoverProject,
  inspectChanges,
  prepareWorktree,
} from "../electron/repository";
import type { Run } from "../shared/types";

describe("isolated ticket worktrees", () => {
  it("starts at a fetched base, preserves source changes, and detects new-file edits", async () => {
    const directory = await mkdtemp(join(tmpdir(), "workstream-repo-"));
    await git(directory, ["init", "-b", "develop"]);
    await git(directory, ["config", "user.name", "Workstream Test"]);
    await git(directory, [
      "config",
      "user.email",
      "workstream-test@example.invalid",
    ]);
    await writeFile(join(directory, "app.txt"), "original");
    await git(directory, ["add", "app.txt"]);
    await git(directory, ["commit", "-m", "base"]);
    await git(directory, ["remote", "add", "origin", directory]);
    await writeFile(join(directory, "app.txt"), "user changes");
    const project = await discoverProject(directory);
    const run = {
      id: "task",
      branch: "feature/TEST-1-change",
      targetBranch: "develop",
    } as Run;
    const worktreeRoot = await mkdtemp(join(tmpdir(), "workstream-trees-"));
    await prepareWorktree(project, run, worktreeRoot);
    expect(await readFile(join(directory, "app.txt"), "utf8")).toBe(
      "user changes",
    );
    expect(await readFile(join(run.worktree!, "app.txt"), "utf8")).toBe(
      "original",
    );
    await writeFile(join(run.worktree!, "new.txt"), "first version");
    const before = await inspectChanges(run);
    expect(before.files).toEqual(["new.txt"]);
    expect(before.diff).toContain("first version");
    await writeFile(join(run.worktree!, "new.txt"), "second version");
    expect((await inspectChanges(run)).hash).not.toBe(before.hash);
    await prepareWorktree(project, run, worktreeRoot);
    expect(await readFile(join(run.worktree!, "new.txt"), "utf8")).toBe(
      "second version",
    );
    await git(run.worktree!, ["config", "core.autocrlf", "true"]);
    await writeFile(join(run.worktree!, "app.txt"), "changed\n");
    const withWarnings = await inspectChanges(run);
    expect(withWarnings.files).toEqual(["app.txt", "new.txt"]);
    expect((await inspectChanges(run)).hash).toBe(withWarnings.hash);
  }, 30_000);
});
