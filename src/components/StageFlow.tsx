import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  BookOpen,
  CircleAlert,
  CircleCheck,
  Code2,
  FlaskConical,
  GitPullRequest,
  LoaderCircle,
  PartyPopper,
  ScanSearch,
  UserRound,
  Bot,
  Cog,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  activeRevision,
  engineNames,
  type Run,
  type Stage,
} from "../../shared/types";

/** The seven steps people see. Several internal stages map onto one step. */
export type Step =
  "plan" | "approve" | "develop" | "verify" | "review" | "publish" | "done";
export const steps: Step[] = [
  "plan",
  "approve",
  "develop",
  "verify",
  "review",
  "publish",
  "done",
];
export const stepOf: Record<Stage, Step> = {
  intake: "plan",
  planning: "plan",
  approval: "approve",
  developing: "develop",
  verifying: "verify",
  reviewing: "review",
  ready: "publish",
  publishing: "publish",
  complete: "done",
};
type Meta = {
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
};
export const stepMeta: Record<Step, Meta> = {
  plan: { label: "Plan", icon: BookOpen },
  approve: { label: "Approve", icon: UserRound },
  develop: { label: "Develop", icon: Code2 },
  verify: { label: "Verify", icon: FlaskConical },
  review: { label: "Review", icon: ScanSearch },
  publish: { label: "Publish", icon: GitPullRequest },
  done: { label: "Done", icon: PartyPopper },
};

/** Who is acting right now, and what it means, in plain words. */
export function stageStory(run: Run) {
  const engine = (role: "planner" | "developer" | "reviewer") =>
    engineNames[run.profiles[role]?.engine ?? "codex"];
  const running = run.status === "running";
  const revision = activeRevision(run);
  if (run.status === "blocked")
    return {
      actor: "you" as const,
      who: "Your turn",
      title: "Needs your attention",
      text: "The workflow stopped in this step. Your work is preserved. The details and what to do are shown below.",
    };
  if (revision && run.stage === "planning" && running)
    return {
      actor: "agent" as const,
      who: `Planner · ${engine("planner")}`,
      title: `Planning change request ${revision.number}`,
      text: "The planner is reading the pull request branch and planning only the changes you asked for. It cannot change files.",
    };
  if (revision && run.stage === "approval")
    return {
      actor: "you" as const,
      who: "Your turn",
      title: "Approve the change plan",
      text: revision.beforePr
        ? "Read the planned changes, ask for adjustments or approve. Nothing is published until development, checks and review pass."
        : "Read the planned changes, ask for adjustments or approve. The pull request is only updated after development, checks and review pass.",
    };
  if (revision && run.stage === "publishing")
    return {
      actor: "system" as const,
      who: "Workstream",
      title: "Updating the pull request",
      text: "Committing the reviewed changes on top of the branch and pushing a new commit to the same pull request. Nothing is force-pushed.",
    };
  if (run.stage === "complete" && running)
    return {
      actor: "system" as const,
      who: "Workstream",
      title: "Reopening the branch",
      text: "Checking that the pull request is still open and getting its branch ready for your change request.",
    };
  switch (run.stage) {
    case "intake":
      return {
        actor: "you" as const,
        who: "Your turn",
        title: "Ready to plan",
        text: "Click Create plan. The planner reads the repository and proposes how to solve the task. Nothing changes in your code yet.",
      };
    case "planning":
      return running
        ? {
            actor: "agent" as const,
            who: `Planner · ${engine("planner")}`,
            title: "Planning",
            text: "The planner is reading the repository and writing an implementation plan. It cannot change files.",
          }
        : {
            actor: "you" as const,
            who: "Your turn",
            title: "Planning paused",
            text: "Create the plan again to continue.",
          };
    case "approval":
      return {
        actor: "you" as const,
        who: "Your turn",
        title: "Approve the plan",
        text: "Read the plan, request changes or approve it. Development only starts after your approval.",
      };
    case "developing":
      return {
        actor: "agent" as const,
        who: `Developer · ${engine("developer")}`,
        title: run.repairCount
          ? `Fixing review findings (repair ${run.repairCount}/2)`
          : "Developing",
        text: "The developer is changing code in the task's own worktree. Your repository folder is not touched.",
      };
    case "verifying":
      return {
        actor: "system" as const,
        who: "Workstream + reviewer",
        title: "Verifying",
        text: "The approved checks run against the changes, and missing evidence is collected.",
      };
    case "reviewing":
      return {
        actor: "agent" as const,
        who: `Reviewer · ${engine("reviewer")}`,
        title: "Independent review",
        text: "A separate reviewer checks the diff against the acceptance criteria. It cannot edit files.",
      };
    case "ready":
      return {
        actor: "you" as const,
        who: "Your turn",
        title: "Ready to publish",
        text: "Checks and review passed. Click Commit & create PR when you are happy.",
      };
    case "publishing":
      return {
        actor: "system" as const,
        who: "Workstream",
        title: "Publishing",
        text: "Committing the reviewed files, pushing the branch and creating the pull request.",
      };
    case "complete":
      if (run.prStatus?.state === "completed")
        return {
          actor: "done" as const,
          who: "Done",
          title: "Pull request completed",
          text: `Merged into ${run.targetBranch}${run.prStatus.closedAt ? ` on ${new Date(run.prStatus.closedAt).toLocaleDateString(undefined, { dateStyle: "medium" })}` : ""}. The task is finished: pull the latest ${run.targetBranch} into your repository and remove the worktree below.`,
        };
      if (run.prStatus?.state === "abandoned")
        return {
          actor: "done" as const,
          who: "Closed",
          title: "Pull request abandoned",
          text: "The pull request was closed without merging. You can remove the worktree below, or start a new task.",
        };
      return {
        actor: "done" as const,
        who: "Done",
        title: run.revisions?.length
          ? "Pull request updated"
          : "Pull request created",
        text: "Waiting for the pull request to be completed. Try it locally, update Jira, open the PR, or use Request changes if something should be different.",
      };
  }
}

const formatDuration = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
};
/** Time spent per step, from the run's activity log. */
export function stepDurations(run: Run) {
  const firsts = new Map<Step, number>();
  // During a change request, time each step of the current round only.
  const since = activeRevision(run)?.requestedAt ?? "";
  for (const item of run.activity) {
    if (item.time < since) continue;
    const step = stepOf[item.stage];
    if (!firsts.has(step)) firsts.set(step, Date.parse(item.time));
  }
  const result = new Map<Step, string>();
  const ordered = steps.filter((s) => firsts.has(s));
  ordered.forEach((step, i) => {
    const next = ordered[i + 1];
    if (next)
      result.set(step, formatDuration(firsts.get(next)! - firsts.get(step)!));
  });
  return result;
}

export function StageTracker({ run }: { run: Run }) {
  const current = stepOf[run.stage];
  const index = steps.indexOf(current);
  const durations = stepDurations(run);
  const blocked = run.status === "blocked";
  const running = run.status === "running";
  const done = run.stage === "complete";
  return (
    <ol className="stage-tracker" aria-label="Workflow progress">
      {steps.map((step, i) => {
        const Icon = stepMeta[step].icon;
        const state =
          i < index || done
            ? "finished"
            : i === index
              ? blocked
                ? "blocked"
                : "current"
              : "upcoming";
        return (
          <li
            key={step}
            className={cn(
              "stage-step",
              state,
              running && i === index && "live",
            )}
            data-step={step}
            aria-current={i === index ? "step" : undefined}
          >
            <span className="stage-node">
              {state === "finished" ? (
                <CircleCheck size={18} />
              ) : state === "blocked" ? (
                <CircleAlert size={18} />
              ) : running && i === index ? (
                <LoaderCircle size={18} className="spin" />
              ) : (
                <Icon size={17} />
              )}
            </span>
            <span className="stage-label">{stepMeta[step].label}</span>
            <small>
              {state === "finished"
                ? (durations.get(step) ?? "Done")
                : state === "current"
                  ? running
                    ? "Working…"
                    : step === "approve" ||
                        run.stage === "ready" ||
                        run.stage === "intake"
                      ? "Your turn"
                      : "Current"
                  : state === "blocked"
                    ? "Stopped"
                    : ""}
            </small>
          </li>
        );
      })}
    </ol>
  );
}

const actorIcon = {
  you: UserRound,
  agent: Bot,
  system: Cog,
  done: PartyPopper,
};

export function StageBanner({ run }: { run: Run }) {
  const story = stageStory(run);
  const step = stepOf[run.stage];
  const Icon = run.status === "blocked" ? CircleAlert : stepMeta[step].icon;
  const Actor = actorIcon[story.actor];
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (run.status !== "running") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [run.status]);
  const since = run.live?.startedAt ?? run.updatedAt;
  return (
    <section
      key={`${run.stage}-${run.status}`}
      className={cn(
        "stage-banner",
        run.status === "blocked" && "blocked",
        story.actor === "you" && "your-turn",
      )}
      data-step={step}
      aria-live="polite"
    >
      <span className="stage-banner-icon">
        <Icon size={24} />
      </span>
      <div>
        <div className="stage-banner-top">
          <span className="stage-chip" data-step={step}>
            Step {steps.indexOf(step) + 1} of {steps.length} ·{" "}
            {stepMeta[step].label}
          </span>
          <span className={cn("actor-chip", story.actor)}>
            <Actor size={13} /> {story.who}
          </span>
          {run.status === "running" && (
            <span className="stage-elapsed">
              {formatDuration(now - Date.parse(since))} in this step
            </span>
          )}
        </div>
        <h2>{story.title}</h2>
        <p>{story.text}</p>
      </div>
    </section>
  );
}

/** Shows a short "moved to" message when the run enters a new stage while you watch. */
export function StageToast({ run }: { run: Run }) {
  const previous = useRef<{ id: string; stage: Stage; status: Run["status"] }>({
    id: run.id,
    stage: run.stage,
    status: run.status,
  });
  const [toast, setToast] = useState<{
    key: number;
    step: Step;
    text: string;
  } | null>(null);
  useEffect(() => {
    const before = previous.current;
    previous.current = { id: run.id, stage: run.stage, status: run.status };
    if (before.id !== run.id) return;
    const moved = before.stage !== run.stage;
    const stopped = before.status !== "blocked" && run.status === "blocked";
    if (!moved && !stopped) return;
    const story = stageStory(run);
    const step = stepOf[run.stage];
    setToast({
      key: Date.now(),
      step,
      text: stopped
        ? `Stopped: ${story.title}`
        : `Moved to ${stepMeta[step].label}: ${story.title}`,
    });
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [run]);
  if (!toast) return null;
  return (
    <div
      key={toast.key}
      className={cn("stage-toast", run.status === "blocked" && "blocked")}
      data-step={toast.step}
      role="status"
    >
      {toast.text}
    </div>
  );
}

/** Small seven-dot progress for run lists. */
export function MiniProgress({ run }: { run: Run }) {
  const index = steps.indexOf(stepOf[run.stage]);
  return (
    <span
      className="mini-progress"
      aria-label={`Step ${index + 1} of ${steps.length}`}
    >
      {steps.map((step, i) => (
        <i
          key={step}
          data-step={step}
          className={cn(
            i < index || run.stage === "complete"
              ? "finished"
              : i === index
                ? run.status === "blocked"
                  ? "blocked"
                  : "current"
                : "",
          )}
        />
      ))}
    </span>
  );
}

/** Run activity grouped by step, newest first, each group in its step colour. */
export function StageTimeline({ run }: { run: Run }) {
  const groups: { step: Step; items: Run["activity"] }[] = [];
  for (const item of [...run.activity].reverse()) {
    const step = stepOf[item.stage];
    const last = groups.at(-1);
    if (last && last.step === step) last.items.push(item);
    else groups.push({ step, items: [item] });
  }
  return (
    <div className="stage-timeline">
      {groups.map((group, g) => {
        const Icon = stepMeta[group.step].icon;
        return (
          <section key={`${group.step}-${g}`} data-step={group.step}>
            <header>
              <span className="stage-chip" data-step={group.step}>
                <Icon size={13} /> {stepMeta[group.step].label}
              </span>
              <small>
                {new Date(group.items.at(-1)!.time).toLocaleTimeString()}
                {group.items.length > 1 &&
                  ` – ${new Date(group.items[0].time).toLocaleTimeString()}`}
              </small>
            </header>
            <ol>
              {group.items.map((item) => (
                <li key={item.id} className={item.kind}>
                  <span className="timeline-dot" />
                  <div>
                    <p>{item.text}</p>
                    <time>{new Date(item.time).toLocaleTimeString()}</time>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
