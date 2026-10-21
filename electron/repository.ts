import { access, copyFile, readdir, readFile, realpath, mkdir, lstat, rmdir, rm as rmFile } from "node:fs/promises";
import { basename, join, dirname, relative, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { activeRevision, isTestFile, type Project, type Run, type RunLocation } from "../shared/types";
import { execute, git } from "./process";
import { hash, safeRemote, scopedPath } from "./guards";
import { providerForRemote } from "./hosting";
import { readSkills } from "./agentsetup";
import { readStack } from "./techstack";

/**
 * Files the agent tools themselves create in a worktree (their local settings),
 * for every engine: Claude Code (.claude/settings.local.json), GitHub Copilot
 * (.github/copilot/settings*.json, .copilot/) and Codex (.codex/). Only used for
 * untracked files, so anything your repository tracks is never treated as agent state.
 */
export const isAgentState = (file: string) =>
  /^(?:\.claude\/settings\.local\.json|\.github\/copilot\/settings(?:\.local)?\.json|\.copilot\/.*|\.codex\/.*)$/.test(
    file.replace(/\\/g, "/"),
  );

/**
 * Test files that stay out of the pull request: every new, changed or deleted
 * test file. They remain in the worktree so checks and reviewers can use them.
 */
export async function localTestFiles(_run: Run, files: string[]) {
  return files.filter((file) => isTestFile(file));
}

export async function discoverProject(path: string): Promise<Project> {
  const canonical = await realpath(path);
  const root = await realpath(
    await git(canonical, ["rev-parse", "--show-toplevel"]),
  );
  const remote = safeRemote(
    await git(root, ["remote", "get-url", "origin"]).catch(() => ""),
  );
  const provider = providerForRemote(remote);
  const branches = await git(root, ["branch", "--list", "develop"]);
  const skillInfo = await readSkills(root);
  const skills = skillInfo.map((skill) => skill.path);
  return {
    id: randomUUID(),
    name: basename(root),
    path: root,
    remote,
    provider,
    targetBranch: branches ? "develop" : "main",
    branchPrefix: provider === "azure" ? "feature" : "codex",
    instructions: await readFile(join(root, "AGENTS.md"))
      .then(() => true)
      .catch(() => false),
    skills,
    skillInfo,
    stack: await readStack(root),
  };
}
/** Task worktrees live next to the repository: C:\\Source\\repo -> C:\\Source\\repo.worktrees. */
export const worktreeRootFor = (project: Pick<Project, "path">) =>
  `${project.path.replace(/[\\/]+$/, "")}.worktrees`;

/** Readable, unique folder name from the branch, for example DPP-1234-fix-price. */
async function worktreeFolder(root: string, run: Run) {
  const base =
    (run.branch.split("/").pop() ?? "task").replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 80) || "task";
  for (let i = 1; i < 100; i++) {
    const candidate = join(root, i === 1 ? base : `${base}-${i}`);
    if (!(await exists(candidate))) return candidate;
  }
  return join(root, run.id);
}
const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );
/**
 * `git status --porcelain -z` entries. Read untrimmed: the status code's leading
 * space (" M file") matters, and git() trims output.
 */
async function statusEntries(cwd: string) {
  const result = await execute("git", ["status", "--porcelain", "-z", "--untracked-files=all"], cwd);
  if (result.code !== 0) throw new Error(result.output || "git status failed");
  const parts = result.stdout.split("\0");
  const entries: { code: string; file: string }[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    entries.push({ code: part.slice(0, 2), file: part.slice(3) });
    // Renames and copies are followed by the original path.
    if (/^[RC]/.test(part)) i++;
  }
  return entries;
}
/** A working Git worktree has a .git file. A leftover folder (for example after a removal Windows only half finished) does not. */
const isWorktree = (path: string) => exists(join(path, ".git"));
/** Removes a leftover worktree folder only when it is empty; anything inside is kept. */
const removeIfEmpty = (path: string) => rmdir(path).catch(() => {});

/**
 * Copies the repository's local .env files into a new worktree so agents can
 * run the site with your settings. Only files Git ignores and does not track
 * are copied, so they can never become part of a commit.
 */
export async function copyEnvFiles(repo: string, worktree: string) {
  const copied: string[] = [];
  for (const entry of await readdir(repo, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isFile() || !/^\.env(\..+)?$/.test(entry.name)) continue;
    const tracked = await execute("git", ["ls-files", "--error-unmatch", "--", entry.name], repo);
    if (tracked.code === 0) continue;
    const ignored = await execute("git", ["check-ignore", "-q", "--", entry.name], repo);
    if (ignored.code !== 0) continue;
    if (await exists(join(worktree, entry.name))) continue;
    await copyFile(join(repo, entry.name), join(worktree, entry.name));
    copied.push(entry.name);
  }
  return copied;
}

export async function prepareWorktree(
  project: Project,
  run: Run,
  fallbackRoot?: string,
) {
  await git(project.path, ["check-ref-format", "--branch", run.branch]);
  await git(project.path, [
    "check-ref-format",
    `refs/heads/${run.targetBranch}`,
  ]);
  if (run.worktree) {
    if (run.worktreeRemoved)
      throw new Error(
        "This task's worktree was removed after its pull request. Use Request changes to reopen the branch.",
      );
    const branch = await git(run.worktree, ["branch", "--show-current"]);
    if (branch !== run.branch)
      throw new Error(
        "Saved worktree branch changed. Inspect it before continuing.",
      );
    if (!run.baseCommit)
      throw new Error("The saved worktree has no recorded base commit.");
    return;
  }
  await git(project.path, ["fetch", "origin", run.targetBranch]);
  run.baseCommit = await git(project.path, ["rev-parse", "FETCH_HEAD"]);
  let root = worktreeRootFor(project);
  try {
    await mkdir(root, { recursive: true });
  } catch (error) {
    if (!fallbackRoot) throw error;
    // The repository's parent folder is not writable: use the app data folder instead.
    root = fallbackRoot;
    await mkdir(root, { recursive: true });
  }
  const worktree = await worktreeFolder(root, run);
  // Existing branches are deliberately not overwritten or silently reused.
  await git(project.path, [
    "worktree",
    "add",
    "-b",
    run.branch,
    worktree,
    run.baseCommit,
  ]);
  run.worktree = worktree;
  run.envFiles = await copyEnvFiles(project.path, worktree).catch(() => []);
}

/**
 * Removes the task worktree after its PR and checks the branch out in your
 * own repository folder, where node_modules and settings already exist.
 * Refuses rather than discarding anything: the worktree must match the pushed
 * commit and your repository must have no uncommitted changes to tracked files.
 * Local-only test files are moved to a kept folder first.
 */
export async function checkoutInRepo(project: Project, run: Run) {
  if (!run.worktree || !run.commit || !run.prUrl)
    throw new Error("Check out in your repo after the pull request exists.");
  if (!run.worktreeRemoved && !(await isWorktree(run.worktree))) {
    // The worktree is already gone (or only an empty folder is left): nothing in it to protect.
    await git(project.path, ["worktree", "prune"]);
    await removeIfEmpty(run.worktree);
    const dirty = await git(project.path, ["status", "--porcelain", "--untracked-files=no"]);
    const previous = await git(project.path, ["branch", "--show-current"]).catch(() => "");
    if (dirty && previous !== run.branch)
      throw new Error(
        "Your repository folder has uncommitted changes. Commit or stash them, then try again. Nothing was changed.",
      );
    run.worktreeRemoved = true;
    if (previous && previous !== run.branch) run.previousRepoBranch = previous;
  }
  if (run.worktreeRemoved) {
    await git(project.path, ["checkout", run.branch]);
    return { moved: [] as string[], previous: run.previousRepoBranch };
  }
  const head = await git(run.worktree, ["rev-parse", "HEAD"]);
  if (head !== run.commit)
    throw new Error("The worktree has commits that were not pushed with the PR. Inspect it before checking out.");
  const pushed = await git(project.path, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${run.branch}`]).catch(() => "");
  if (pushed !== run.commit)
    throw new Error("The pushed branch does not match the worktree. Fetch and inspect before checking out.");
  const status = await statusEntries(run.worktree);
  const keep = new Set(run.localOnlyFiles ?? []);
  const local = (file: string) => keep.has(file) || isTestFile(file);
  const unexpected = status.filter((entry) => !local(entry.file));
  if (unexpected.length)
    throw new Error(
      `The worktree has changes that are not in the PR (${unexpected.slice(0, 3).map((e) => e.file).join(", ")}). Nothing was removed.`,
    );
  const dirty = await git(project.path, ["status", "--porcelain", "--untracked-files=no"]);
  if (dirty)
    throw new Error(
      "Your repository folder has uncommitted changes. Commit or stash them, then try again. Nothing was changed.",
    );
  const previous = await git(project.path, ["branch", "--show-current"]).catch(() => "");
  // Local-only test files are not kept: they were never part of the pull request.
  const moved = await discardLocalTests(run);
  try {
    await git(project.path, ["worktree", "remove", run.worktree]);
  } catch (error) {
    // Windows can delete the files but not the folder (an editor or dev server holds it open).
    // Git has then already unregistered the worktree, so carry on rather than leave it half done.
    if (!(await isWorktree(run.worktree))) {
      await git(project.path, ["worktree", "prune"]);
      await removeIfEmpty(run.worktree);
    } else {
      throw new Error(
        `The worktree could not be removed, often because a dev server or editor still has files open there. Close it and try again. ${error instanceof Error ? error.message.slice(0, 200) : ""}`,
      );
    }
  }
  run.worktreeRemoved = true;
  run.previousRepoBranch = previous || undefined;
  await git(project.path, ["checkout", run.branch]);
  return { moved, previous };
}
const isAncestor = async (cwd: string, older: string, newer: string) =>
  (await execute("git", ["merge-base", "--is-ancestor", older, newer], cwd)).code === 0;

/**
 * Gets the pull request branch ready for another round of changes.
 * Reuses the task worktree when it is still there, otherwise creates a new one
 * from the branch. Newer commits on origin (someone else pushed) are picked up
 * by fast-forward only. Anything that would need a reset, a merge or discarding
 * work stops with a message instead. Never pushes.
 */
export async function reopenWorktree(project: Project, run: Run, fallbackRoot?: string) {
  if (!run.commit || !run.prUrl)
    throw new Error("Request changes after the pull request exists.");
  if (!run.baseCommit) throw new Error("This run has no recorded base commit.");
  await git(project.path, ["check-ref-format", "--branch", run.branch]);
  const notes: string[] = [];
  await git(project.path, [
    "fetch",
    "origin",
    `+refs/heads/${run.branch}:refs/remotes/origin/${run.branch}`,
  ]).catch((error) => {
    throw new Error(
      `Could not fetch ${run.branch} from origin. If the pull request was completed and the branch deleted, start a new task. ${error instanceof Error ? error.message.slice(0, 200) : ""}`,
    );
  });
  const remote = await git(project.path, [
    "rev-parse",
    "--verify",
    "--quiet",
    `refs/remotes/origin/${run.branch}`,
  ]).catch(() => "");
  if (!remote) throw new Error(`${run.branch} no longer exists on origin. Start a new task.`);
  if (!(await isAncestor(project.path, run.commit, remote)))
    throw new Error(
      `origin/${run.branch} no longer contains the commit Workstream pushed (the branch was rewritten). Inspect it yourself; nothing was changed.`,
    );
  if (remote !== run.commit) {
    const count = await git(project.path, ["rev-list", "--count", `${run.commit}..${remote}`]);
    notes.push(`Picked up ${count} newer commit(s) from origin/${run.branch}.`);
  }
  // 1. The task worktree is still there: bring it up to date.
  if (run.worktree && !run.worktreeRemoved && (await isWorktree(run.worktree))) {
    const branch = await git(run.worktree, ["branch", "--show-current"]);
    if (branch !== run.branch)
      throw new Error("The task worktree is on another branch. Inspect it before requesting changes.");
    const keep = new Set(run.localOnlyFiles ?? []);
    const unexpected = (await statusEntries(run.worktree))
      .filter((entry) => !(keep.has(entry.file) || isTestFile(entry.file)))
      .map((entry) => `${entry.code} ${entry.file}`);
    if (unexpected.length)
      throw new Error(
        `The task worktree has changes that are not in the PR (${unexpected.slice(0, 3).map((line) => line.slice(3)).join(", ")}). Commit or remove them first; nothing was changed.`,
      );
    const head = await git(run.worktree, ["rev-parse", "HEAD"]);
    if (head !== remote) {
      if (!(await isAncestor(run.worktree, head, remote)))
        throw new Error(
          "The task worktree has commits that are not on origin. Push or inspect them first; nothing was changed.",
        );
      await git(run.worktree, ["merge", "--ff-only", remote]);
    }
    return { notes, fromCommit: remote };
  }
  // 2. The worktree was removed (usually by Check out in my repo), or only an empty folder is left.
  await git(project.path, ["worktree", "prune"]);
  if (run.worktree) await removeIfEmpty(run.worktree);
  const current = await git(project.path, ["branch", "--show-current"]).catch(() => "");
  if (current === run.branch) {
    const dirty = await git(project.path, ["status", "--porcelain", "--untracked-files=no"]);
    if (dirty)
      throw new Error(
        `Your repository folder has uncommitted changes on ${run.branch}. Commit and push them, or stash them, then try again. Nothing was changed.`,
      );
    const back =
      run.previousRepoBranch && run.previousRepoBranch !== run.branch
        ? run.previousRepoBranch
        : run.targetBranch;
    await git(project.path, ["check-ref-format", "--branch", back]);
    await git(project.path, ["checkout", back]);
    notes.push(`Switched your repository folder from ${run.branch} back to ${back} so the task worktree can use the branch.`);
  }
  const local = await git(project.path, [
    "rev-parse",
    "--verify",
    "--quiet",
    `refs/heads/${run.branch}`,
  ]).catch(() => "");
  if (local && local !== remote) {
    if (!(await isAncestor(project.path, local, remote)))
      throw new Error(
        `Your local ${run.branch} has commits that are not on origin. Push them first so they are part of the PR; nothing was changed.`,
      );
    // Fast-forward only: local is an ancestor of origin, so no commit is lost.
    await git(project.path, ["branch", "-f", run.branch, remote]);
  }
  let root = worktreeRootFor(project);
  try {
    await mkdir(root, { recursive: true });
  } catch (error) {
    if (!fallbackRoot) throw error;
    root = fallbackRoot;
    await mkdir(root, { recursive: true });
  }
  const worktree = await worktreeFolder(root, run);
  await git(
    project.path,
    local
      ? ["worktree", "add", worktree, run.branch]
      : ["worktree", "add", "--track", "-b", run.branch, worktree, `origin/${run.branch}`],
  );
  run.worktree = worktree;
  run.worktreeRemoved = false;
  run.envFiles = await copyEnvFiles(project.path, worktree).catch(() => []);
  return { notes, fromCommit: remote };
}

/** What changed in this round only (tracked and new files), for the reviewer. */
/**
 * A tree object of the worktree exactly as it is (tracked changes and new,
 * non-ignored files), written through a temporary index so nothing you see
 * changes: no staging, no commit.
 */
export async function snapshotTree(worktree: string) {
  const index = join(tmpdir(), `workstream-index-${randomUUID()}`);
  const env = { GIT_INDEX_FILE: index };
  try {
    await git(worktree, ["read-tree", "HEAD"], { env });
    await git(worktree, ["add", "-A", "--", "."], { env });
    return await git(worktree, ["write-tree"], { env });
  } finally {
    await rmFile(index, { force: true }).catch(() => {});
  }
}

/** What changed in this round only, for the reviewer. */
export async function revisionDiff(run: Run, fromCommit: string, fromTree?: string) {
  if (!run.worktree) return "";
  if (fromTree) {
    // Before the PR nothing is committed between rounds, so compare snapshots.
    const now = await snapshotTree(run.worktree).catch(() => "");
    if (now) return (await git(run.worktree, ["diff", "--no-ext-diff", fromTree, now]).catch(() => "")).slice(0, 400_000);
  }
  const diff = await git(run.worktree, ["diff", "--no-ext-diff", fromCommit]).catch(() => "");
  const added = (await git(run.worktree, ["ls-files", "--others", "--exclude-standard"]).catch(() => ""))
    .split("\n")
    .filter((file) => file && !(run.localOnlyFiles ?? []).includes(file));
  return `${diff}${added.length ? `\nNew files in this round: ${added.join(", ")}` : ""}`.slice(0, 400_000);
}
export async function switchRepoBack(project: Project, branch: string) {
  const dirty = await git(project.path, ["status", "--porcelain", "--untracked-files=no"]);
  if (dirty)
    throw new Error("Your repository folder has uncommitted changes. Commit or stash them first.");
  await git(project.path, ["check-ref-format", "--branch", branch]);
  await git(project.path, ["checkout", branch]);
}
export async function inspectChanges(run: Run) {
  if (!run.worktree || !run.baseCommit)
    throw new Error("No ticket worktree is available.");
  const tracked = (
    await git(run.worktree, ["diff", "--name-only", "-z", run.baseCommit])
  )
    .split("\0")
    .filter(Boolean);
  const untracked = (
    await git(run.worktree, [
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
    ])
  )
    .split("\0")
    .filter((file) => file && !isAgentState(file));
  // During a change request, also include files changed since the round started.
  // A file restored to its original content no longer differs from the base,
  // but it still has to be committed on top of the pull request. Using the round's
  // start commit (not HEAD) keeps the list and the hash the same after committing.
  const since = activeRevision(run)?.fromCommit;
  const sinceRound =
    since && since !== run.baseCommit
      ? (await git(run.worktree, ["diff", "--name-only", "-z", since]))
          .split("\0")
          .filter(Boolean)
      : [];
  const files = [...new Set([...tracked, ...sinceRound, ...untracked])].sort();
  let diff = await git(run.worktree, [
    "diff",
    "--no-ext-diff",
    "--binary",
    run.baseCommit,
  ]);
  const contents: string[] = [];
  for (const file of files) {
    scopedPath(run.worktree, file);
    const path = join(run.worktree, file);
    const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (info?.isSymbolicLink())
      throw new Error(
        "Symlink changes require manual review outside the first-release publisher.",
      );
    if (info) {
      const parent = await realpath(dirname(path));
      const rel = relative(await realpath(run.worktree), parent);
      if (rel.startsWith("..") || isAbsolute(rel))
        throw new Error(
          "A changed path traverses a symlink outside the ticket worktree.",
        );
    }
    const content = await readFile(join(run.worktree, file)).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return Buffer.from("[deleted]");
        throw error;
      },
    );
    contents.push(file + ":" + hash(content.toString("base64")));
    if (untracked.includes(file)) {
      const source = JSON.stringify(`a/${file}`),
        destination = JSON.stringify(`b/${file}`);
      diff += `\ndiff --git ${source} ${destination}\nnew file mode 100644\n--- /dev/null\n+++ ${destination}\n`;
      if (content.includes(0))
        diff += "Binary file added (preview unavailable)\n";
      else {
        const text = content.toString("utf8");
        const lines = text ? text.replace(/\n$/, "").split("\n") : [];
        diff += `@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join("\n")}\n`;
        if (text && !text.endsWith("\n"))
          diff += "\\ No newline at end of file\n";
      }
    }
  }
  if (diff.length > 1_500_000)
    throw new Error(
      "The change exceeds the review size limit. Narrow the task before continuing.",
    );
  return { files, diff, hash: hash(contents.join("\n")) };
}

/**
 * Runs the repository's own pre-commit hook (for example Prettier, ESLint --fix,
 * translation extraction) on the files that will be committed, before the checks
 * and review. The reviewer then sees exactly what the commit will contain, and
 * publishing no longer bounces back because a hook changed files. The files are
 * unstaged again afterwards; nothing is committed here.
 */
export async function runCommitHook(run: Run, timeout = 10 * 60_000) {
  const worktree = run.worktree!;
  const changes = await inspectChanges(run);
  const localOnly = await localTestFiles(run, changes.files);
  const files = changes.files.filter((file) => !localOnly.includes(file));
  if (!files.length) return { ran: false as const };
  // Leave an index the user or another tool prepared alone.
  const staged = (await git(worktree, ["diff", "--cached", "--name-only", "-z"])).split("\0").filter(Boolean);
  if (staged.length) return { ran: false as const };
  const present: string[] = [];
  const removed: string[] = [];
  for (const file of files)
    (await access(join(worktree, file)).then(() => true, () => false) ? present : removed).push(file);
  try {
    if (present.length) await git(worktree, ["add", "--", ...present]);
    if (removed.length) await git(worktree, ["rm", "--cached", "--ignore-unmatch", "--quiet", "--", ...removed]);
    // "git hook run" needs Git 2.36+; --ignore-missing makes a repository without a hook a no-op.
    const result = await execute("git", ["hook", "run", "--ignore-missing", "pre-commit"], worktree, { timeout });
    if (result.code !== 0 && /is not a git command|unknown option|usage: git hook/i.test(result.output))
      return { ran: false as const };
    return { ran: true as const, code: result.code, output: result.output };
  } finally {
    // Back to "nothing staged"; only the index is reset, files on disk stay as the hook left them.
    await git(worktree, ["reset", "--quiet"]).catch(() => {});
  }
}

/**
 * Removes what the agents left in the worktree that never goes into the pull
 * request: new test files are deleted, changed repository tests get their
 * committed version back, and agent state (.claude/settings.local.json) is
 * removed. Product changes are not touched. Returns the files it handled.
 */
export async function discardLocalTests(run: Run) {
  if (!run.worktree) return [];
  const keep = new Set(run.localOnlyFiles ?? []);
  const status = await statusEntries(run.worktree);
  const done: string[] = [];
  for (const entry of status) {
    const untracked = entry.code === "??";
    const agentState = untracked && (isAgentState(entry.file) || /^\.(?:claude|copilot|codex)\/?$/.test(entry.file.replace(/\\/g, "/")));
    if (!agentState && !keep.has(entry.file) && !isTestFile(entry.file)) continue;
    const path = join(run.worktree, entry.file);
    if (untracked) {
      await rmFile(path, { recursive: true, force: true });
      // The agent tool's folder (.claude, .github/copilot) is left empty once its settings file is gone.
      if (agentState) await rmdir(dirname(path)).catch(() => {});
    } else await git(run.worktree, ["checkout", "HEAD", "--", entry.file]);
    done.push(entry.file);
  }
  run.localOnlyFiles = [];
  return done;
}

/**
 * After the pull request is completed: brings the target branch (for example
 * develop) up to date in your repository. Fast-forward only, never forced. When
 * the repository is still on the task branch it switches back to the target
 * branch first (only with no uncommitted changes); on any other branch the local
 * target branch is updated without touching what you have checked out.
 */
export async function pullTargetBranch(project: Project, run: Run, onStep: (step: string) => void = () => {}) {
  const target = run.targetBranch;
  await git(project.path, ["check-ref-format", "--branch", target]);
  const current = await git(project.path, ["branch", "--show-current"]).catch(() => "");
  const before = await git(project.path, ["rev-parse", "--verify", "--quiet", target]).catch(() => "");
  const newCommits = async (after: string) =>
    before && before !== after
      ? (await git(project.path, ["log", "--format=%h%x09%s", "--max-count=20", `${before}..${after}`]).catch(() => ""))
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            const [hash, ...subject] = line.split("\t");
            return { hash, subject: subject.join("\t") };
          })
      : [];
  const count = async (after: string) =>
    before && before !== after ? Number(await git(project.path, ["rev-list", "--count", `${before}..${after}`]).catch(() => "0")) : 0;
  if (current && current !== target && current !== run.branch) {
    onStep(`Fetching origin/${target} and updating your local ${target}`);
    const updated = await execute("git", ["fetch", "origin", `${target}:${target}`], project.path);
    if (updated.code !== 0)
      throw new Error(
        `Your local ${target} has commits that are not on origin/${target}, so it was not updated. Nothing was changed. ${updated.output.slice(0, 200)}`,
      );
    onStep("Reading the new commits");
    const after = await git(project.path, ["rev-parse", target]);
    return { switched: false, branch: current, before, after, total: await count(after), commits: await newCommits(after) };
  }
  onStep(`Fetching origin/${target}`);
  await git(project.path, ["fetch", "origin", target]);
  let switched = false;
  if (current !== target) {
    onStep(`Switching ${project.name} to ${target}`);
    const dirty = await git(project.path, ["status", "--porcelain", "--untracked-files=no"]);
    if (dirty)
      throw new Error(
        `Your repository has uncommitted changes on ${current || "the current branch"}. Commit or stash them, then try again. Nothing was changed.`,
      );
    await git(project.path, ["checkout", target]);
    switched = true;
  }
  onStep(`Fast-forwarding ${target}`);
  const merged = await execute("git", ["merge", "--ff-only", `origin/${target}`], project.path);
  if (merged.code !== 0)
    throw new Error(
      `${target} could not be fast-forwarded to origin/${target} (it has local commits or conflicting local changes). Nothing was forced. ${merged.output.slice(0, 200)}`,
    );
  onStep("Reading the new commits");
  const after = await git(project.path, ["rev-parse", "HEAD"]);
  return { switched, branch: target, before, after, total: await count(after), commits: await newCommits(after) };
}

/**
 * Where a task lives right now (read-only, no network): its worktree and branch,
 * and what your repository has checked out. "Behind" compares the local target
 * branch with origin as of the last fetch.
 */
export async function describeLocation(project: Project, run: Run): Promise<RunLocation> {
  const out: RunLocation = { checkedAt: new Date().toISOString(), repoPath: project.path, worktreeExists: false };
  const short = (ref: string, cwd = project.path) => git(cwd, ["rev-parse", "--short", ref]).catch(() => "");
  out.repoBranch = await git(project.path, ["branch", "--show-current"]).catch(() => "");
  out.repoHead = await short("HEAD");
  out.repoChanges = (await git(project.path, ["status", "--porcelain", "--untracked-files=no"]).catch(() => ""))
    .split("\n")
    .filter(Boolean).length;
  const counts = await git(project.path, ["rev-list", "--left-right", "--count", `${run.targetBranch}...origin/${run.targetBranch}`]).catch(() => "");
  if (counts) {
    const [ahead, behind] = counts.split(/\s+/).map(Number);
    out.targetAhead = ahead;
    out.targetBehind = behind;
  }
  out.targetHead = await short(run.targetBranch);
  if (run.worktree && !run.worktreeRemoved && (await isWorktree(run.worktree))) {
    out.worktreeExists = true;
    out.worktreePath = run.worktree;
    out.worktreeBranch = await git(run.worktree, ["branch", "--show-current"]).catch(() => "");
    out.worktreeHead = await short("HEAD", run.worktree);
    out.worktreeChanges = (await statusEntries(run.worktree).catch(() => [])).length;
  }
  return out;
}

/**
 * Removes the task worktree once its pull request is completed or abandoned.
 * Local-only tests and agent settings go first; anything else that is not in
 * the pull request stops the removal so no work is lost. The branch is kept.
 */
export async function removeTaskWorktree(project: Project, run: Run) {
  if (!run.worktree || run.worktreeRemoved) return;
  if (await isWorktree(run.worktree)) {
    await discardLocalTests(run);
    const left = await statusEntries(run.worktree);
    if (left.length)
      throw new Error(
        `The worktree has changes that are not in the pull request (${left.slice(0, 3).map((entry) => entry.file).join(", ")}). Nothing was removed.`,
      );
    try {
      await git(project.path, ["worktree", "remove", run.worktree]);
    } catch (error) {
      if (await isWorktree(run.worktree))
        throw new Error(
          `The worktree could not be removed, often because a dev server or editor still has files open there. Close it and try again. ${error instanceof Error ? error.message.slice(0, 200) : ""}`,
        );
    }
  }
  await git(project.path, ["worktree", "prune"]).catch(() => {});
  await removeIfEmpty(run.worktree);
  run.worktreeRemoved = true;
}
