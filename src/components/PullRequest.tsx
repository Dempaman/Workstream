import { useState } from "react";
import {
  CheckCircle2,
  GitMerge,
  LoaderCircle,
  RefreshCw,
  Trash2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { TechIcon } from "@/components/TechStack";
import type { Command, Project, Run, Snapshot } from "../../shared/types";

type Send = (command: Command) => Promise<Snapshot | null>;
const when = (value?: string) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "";

/** Small status next to "Open pull request": open, merged or abandoned, with a manual re-check. */
export function PullRequestPill({
  run,
  send,
  pending,
}: {
  run: Run;
  send: Send;
  pending: boolean;
}) {
  if (!run.prUrl) return null;
  const state = run.prStatus?.state ?? "active";
  const label =
    state === "completed"
      ? "Merged"
      : state === "abandoned"
        ? "Abandoned"
        : state === "missing"
          ? "PR not found"
          : "PR open";
  return (
    <span
      className={`pr-pill ${state}`}
      title={
        run.prStatus ? `Checked ${when(run.prStatus.checkedAt)}` : undefined
      }
    >
      {state === "completed" ? (
        <GitMerge size={13} />
      ) : state === "abandoned" ? (
        <XCircle size={13} />
      ) : (
        <CheckCircle2 size={13} />
      )}
      {label}
      <button
        type="button"
        className="pr-recheck"
        disabled={pending}
        aria-label="Check the pull request status now"
        title="Check now"
        onClick={() => void send({ type: "checkPullRequest", runId: run.id })}
      >
        <RefreshCw size={12} />
      </button>
    </span>
  );
}

/**
 * Shown when the pull request is completed or abandoned: pull the latest target
 * branch into your repository and remove the task worktree, each with one click.
 */
export function PullRequestDone({
  run,
  project,
  send,
  pending,
}: {
  run: Run;
  project: Project;
  send: Send;
  pending: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const state = run.prStatus?.state;
  if (state !== "completed" && state !== "abandoned") return null;
  const worktreeLeft = Boolean(run.worktree && !run.worktreeRemoved);
  const act = async (command: Command) => {
    setBusy(true);
    try {
      await send(command);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={`panel detail-section pr-done ${state}`}>
      <h2>
        {state === "completed" ? <GitMerge size={18} /> : <XCircle size={18} />}
        {state === "completed"
          ? `Merged into ${run.targetBranch}`
          : "Pull request abandoned"}
      </h2>
      <p>
        {state === "completed"
          ? `The pull request was completed${run.prStatus?.closedAt ? ` on ${when(run.prStatus.closedAt)}` : ""}. The task is done.`
          : "The pull request was closed without merging."}{" "}
        {worktreeLeft
          ? "The task worktree is still on your disk."
          : "The task worktree has been removed."}
      </p>
      <div className="button-row">
        {state === "completed" && (
          <Button
            disabled={pending || busy}
            onClick={() =>
              void act({ type: "pullTargetBranch", runId: run.id })
            }
          >
            {busy ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <TechIcon id="git" size={13} />
            )}
            {busy
              ? `Pulling the latest ${run.targetBranch}…`
              : `Pull the latest ${run.targetBranch} into ${project.name}`}
          </Button>
        )}
        {worktreeLeft && (
          <Button
            variant="outline"
            disabled={pending || busy}
            title={run.worktree}
            onClick={() => void act({ type: "removeWorktree", runId: run.id })}
          >
            <Trash2 size={14} /> Remove the worktree
          </Button>
        )}
      </div>
      {(run.repoAction || busy) && <RepoProgress run={run} />}
      {run.lastPull && !run.repoAction && !busy && (
        <div className="pull-result" role="status" key={run.lastPull.at}>
          <strong>
            <CheckCircle2 size={15} />
            {run.lastPull.total
              ? `${run.lastPull.branch === run.targetBranch ? "" : "Local "}${run.targetBranch} moved from ${run.lastPull.before.slice(0, 7)} to ${run.lastPull.after.slice(0, 7)}: ${run.lastPull.total} new commit${run.lastPull.total === 1 ? "" : "s"}`
              : `${run.targetBranch} is already up to date at ${run.lastPull.after.slice(0, 7)}`}
          </strong>
          <small>
            {when(run.lastPull.at)}
            {run.lastPull.switched
              ? ` · switched ${project.name} to ${run.targetBranch}`
              : ""}
            {run.lastPull.branch !== run.targetBranch
              ? ` · ${project.name} stays on ${run.lastPull.branch}`
              : ""}
          </small>
          {run.lastPull.commits.length > 0 && (
            <ul>
              {run.lastPull.commits.map((commit, index) => (
                <li
                  key={commit.hash}
                  style={{ animationDelay: `${120 + index * 70}ms` }}
                >
                  <code>{commit.hash}</code> {commit.subject}
                </li>
              ))}
              {run.lastPull.total > run.lastPull.commits.length && (
                <li className="muted-note">
                  and {run.lastPull.total - run.lastPull.commits.length} more
                </li>
              )}
            </ul>
          )}
        </div>
      )}
      <p className="muted-note">
        Pulling is fast-forward only and never overwrites your work: if{" "}
        {project.name} is still on the task branch it switches back to{" "}
        {run.targetBranch} first (only without uncommitted changes). Removing
        the worktree deletes the task folder and its local test files; the
        branch and its commits are kept.
      </p>
    </section>
  );
}

/** Live progress of a repository action: a moving bar and the Git steps as they happen. */
function RepoProgress({ run }: { run: Run }) {
  const action = run.repoAction;
  const done = action?.done ?? [];
  const expected = Math.max(action?.expected ?? 3, done.length + 1);
  const percent = action
    ? Math.min(95, ((done.length + 0.5) / expected) * 100)
    : 8;
  return (
    <div className="repo-progress" role="status" aria-live="polite">
      <div className="repo-progress-bar" aria-hidden>
        <span style={{ width: `${percent}%` }} />
      </div>
      <ol>
        {done.map((step) => (
          <li key={step} className="done">
            <CheckCircle2 size={14} /> {step}
          </li>
        ))}
        <li className="current">
          <LoaderCircle size={14} className="spin" />{" "}
          {action?.current ?? "Starting…"}
        </li>
      </ol>
    </div>
  );
}
