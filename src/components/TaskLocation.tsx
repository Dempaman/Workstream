import { useEffect, useState } from "react";
import { FolderGit2, HardDrive, RefreshCw } from "lucide-react";
import { TechIcon } from "@/components/TechStack";
import type { Command, Project, Run, Snapshot } from "../../shared/types";

type Send = (command: Command) => Promise<Snapshot | null>;
type Tone = "ok" | "warn" | "neutral" | "info";

const folderName = (path: string) =>
  path.split(/[\\/]/).filter(Boolean).pop() ?? path;

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`location-pill ${tone}`}>{children}</span>;
}

/**
 * Where this task lives right now: its worktree (branch, commit, changes) and
 * what your own repository has checked out. Read-only, no network; refreshed
 * when you open the task and after every repository action.
 */
export function TaskLocation({
  run,
  project,
  send,
}: {
  run: Run;
  project: Project;
  send: Send;
}) {
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    setBusy(true);
    try {
      await send({ type: "inspectLocation", runId: run.id });
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void refresh();
  }, [run.id]);
  const where = run.location;
  const onTaskBranch = where?.repoBranch === run.branch;
  const worktreeChanges = where?.worktreeChanges ?? 0;
  const repoChanges = where?.repoChanges ?? 0;
  return (
    <section
      className="panel detail-section task-location"
      aria-label="Where this task lives"
    >
      <header className="task-location-header">
        <h2>Where this task lives</h2>
        <span>
          {where
            ? `Checked ${new Date(where.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
            : ""}
        </span>
        <button
          type="button"
          className="location-refresh"
          disabled={busy}
          onClick={() => void refresh()}
          aria-label="Refresh where this task lives"
          title="Refresh"
        >
          <RefreshCw size={14} className={busy ? "spin" : undefined} />
        </button>
      </header>
      <div className="location-grid">
        <div className="location-column">
          <h3>
            <FolderGit2 size={15} /> Task worktree
          </h3>
          {where?.worktreeExists ? (
            <dl>
              <dt>Folder</dt>
              <dd title={where.worktreePath}>
                {folderName(where.worktreePath ?? "")}
              </dd>
              <dt>Branch</dt>
              <dd title={where.worktreeBranch}>
                <TechIcon id="git" size={11} />
                <span className="ellipsis">
                  {where.worktreeBranch || "detached"}
                </span>
              </dd>
              <dt>Commit</dt>
              <dd>
                <code>{where.worktreeHead}</code>
              </dd>
              <dt>Changes</dt>
              <dd>
                {worktreeChanges ? (
                  <Pill tone="warn">
                    {worktreeChanges} uncommitted file
                    {worktreeChanges === 1 ? "" : "s"}
                  </Pill>
                ) : (
                  <Pill tone="ok">Clean</Pill>
                )}
              </dd>
            </dl>
          ) : (
            <p className="location-empty">
              {run.worktree
                ? "Removed. The branch and its commits are kept."
                : "Created when you approve the plan."}
            </p>
          )}
        </div>
        <div className="location-column">
          <h3>
            <HardDrive size={15} /> Your repository · {project.name}
          </h3>
          {where?.repoBranch !== undefined ? (
            <dl>
              <dt>Branch</dt>
              <dd title={where.repoBranch}>
                <TechIcon id="git" size={11} />
                <span className="ellipsis">
                  {where.repoBranch || "detached HEAD"}
                </span>
                {onTaskBranch ? (
                  <Pill tone="info">This task</Pill>
                ) : (
                  <Pill tone="neutral">Not this task&apos;s branch</Pill>
                )}
              </dd>
              <dt>Commit</dt>
              <dd>
                <code>{where.repoHead}</code>
              </dd>
              <dt>Changes</dt>
              <dd>
                {repoChanges ? (
                  <Pill tone="warn">
                    {repoChanges} uncommitted change
                    {repoChanges === 1 ? "" : "s"}
                  </Pill>
                ) : (
                  <Pill tone="ok">Clean</Pill>
                )}
              </dd>
              <dt>{run.targetBranch}</dt>
              <dd title="Compared with origin as of the last fetch">
                {where.targetBehind ? (
                  <Pill tone="warn">{where.targetBehind} behind origin</Pill>
                ) : where.targetAhead ? (
                  <Pill tone="warn">{where.targetAhead} local commits</Pill>
                ) : (
                  <Pill tone="ok">Matches origin</Pill>
                )}
              </dd>
            </dl>
          ) : (
            <p className="location-empty" title={project.path}>
              {project.path}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
