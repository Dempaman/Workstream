import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gapKind, gapText, unresolvedItems } from "../shared/gates";
import { runCommitHook } from "../electron/repository";
import type { Run } from "../shared/types";

describe("gap tags", () => {
  it("routes gaps by the reviewer's tag and treats untagged gaps as collectable evidence", () => {
    expect(gapKind("Evidence: 200% zoom screenshot")).toBe("evidence");
    expect(gapKind("Needs you: attach the Figma frame")).toBe("you");
    expect(gapKind("outside the code: Legal approves the wording")).toBe("outside");
    expect(gapKind("Browser check missing")).toBe("evidence");
    expect(gapText("Outside the code: Legal approves the wording")).toBe("Legal approves the wording");
    expect(gapText("Needs you: attach the frame")).toBe("Attach the frame");
    const run = {
      reviews: [{ acceptanceGaps: ["Outside the code: CMS text", "Needs you: image", "Zoom check"], findings: [] }],
    } as unknown as Run;
    expect(unresolvedItems(run).map((i) => i.kind)).toEqual(["external", "you", "verification"]);
  });
});

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const gitVersion = git(tmpdir(), "--version").match(/(\d+)\.(\d+)/)!;
const hasHookRun = Number(gitVersion[1]) > 2 || Number(gitVersion[2]) >= 36;

describe("repository commit hook before review", () => {
  async function repo() {
    const dir = await mkdtemp(join(tmpdir(), "workstream-hook-"));
    git(dir, "init", "-q");
    git(dir, "config", "user.email", "t@example.com");
    git(dir, "config", "user.name", "T");
    await writeFile(join(dir, "a.txt"), "one\n");
    git(dir, "add", ".");
    git(dir, "commit", "-qm", "base");
    const base = git(dir, "rev-parse", "HEAD");
    await writeFile(join(dir, "a.txt"), "two   \n");
    return { dir, run: { worktree: dir, baseCommit: base, branch: "main" } as unknown as Run };
  }
  it("leaves nothing staged, also when Git has no 'git hook run' or the repo has no hook", async () => {
    const { dir, run } = await repo();
    const result = await runCommitHook(run);
    expect(result.ran === false || result.code === 0).toBe(true);
    expect(git(dir, "diff", "--cached", "--name-only")).toBe("");
  });
  it.runIf(hasHookRun)("runs the pre-commit hook so its formatting is in place before review", async () => {
    const { dir, run } = await repo();
    await mkdir(join(dir, ".git", "hooks"), { recursive: true });
    const hook = join(dir, ".git", "hooks", "pre-commit");
    await writeFile(hook, "#!/bin/sh\nsed -i 's/ *$//' a.txt\n");
    await chmod(hook, 0o755);
    const result = await runCommitHook(run);
    expect(result).toMatchObject({ ran: true, code: 0 });
    expect(await readFile(join(dir, "a.txt"), "utf8")).toBe("two\n");
    expect(git(dir, "diff", "--cached", "--name-only")).toBe("");
  });
});
