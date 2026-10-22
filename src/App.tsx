import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Brain,
  Cable,
  Plug,
  Ticket,
  Moon,
  Sun,
  BookOpen,
  Check,
  CheckCheck,
  ChevronRight,
  Circle,
  CircleCheck,
  Clock3,
  Code2,
  FileCode2,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  LayoutDashboard,
  LoaderCircle,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  FlaskConical,
  HeartPulse,
  Square,
  Terminal,
  Workflow as WorkflowIcon,
  X,
  Zap,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { bridge } from "@/lib/bridge";
import { cn } from "@/lib/utils";
import { DiffReview } from "@/components/DiffReview";
import { BrandLogo, EngineMark } from "@/components/EngineMark";
import { AccountUsage, RunUsage } from "@/components/Usage";
import { PriceSettings } from "@/components/PriceSettings";
import { RunActivity } from "@/components/RunActivity";
import {
  MiniProgress,
  StageBanner,
  StageTimeline,
  StageToast,
  StageTracker,
  stepOf,
} from "@/components/StageFlow";
import { ImagePicker, SavedImages, type ImageInput } from "@/components/Images";
import {
  AccessChips,
  Connections,
  ProviderMark,
} from "@/components/Connections";
import {
  ConnectorsPage,
  JiraUpdate,
  TryLocally,
} from "@/components/ConnectorsPage";
import { MemoryPage, RunMemory } from "@/components/MemoryPage";
import { AcceptGaps } from "@/components/AcceptGaps";
import { OpenItems, RecoveryGuide } from "@/components/RecoveryGuide";
import { TechIcon, TechLogos, TechStack } from "@/components/TechStack";
import { PullRequestDone, PullRequestPill } from "@/components/PullRequest";
import { TaskLocation } from "@/components/TaskLocation";
import {
  changeRequestAllowed,
  codeProblems,
  unresolvedItems,
  isProposedCriterion,
  planWithCriteria,
} from "../shared/gates";
import {
  ChangeRequestBanner,
  RequestChanges,
} from "@/components/ChangeRequest";
import { RevisionPlan } from "@/components/PlanCompare";
import {
  AgentSetupHeader,
  RoleInstructions,
  SessionInstructions,
  initialSetup,
} from "@/components/AgentSetup";
import { SkillGenerator } from "@/components/SkillGenerator";
import { E2ePage, TaskE2e, TestGatePanel } from "@/components/E2ePage";
import { HealthPage } from "@/components/HealthPage";
import { TaskStats } from "@/components/TaskStats";
import {
  type Command,
  type Project,
  type Role,
  type Run,
  type Settings,
  type Snapshot,
  type Stage,
  engines,
  engineNames,
  engineShortNames,
  activeRevision,
  isTestFile,
  type Engine,
} from "../shared/types";

type Page =
  | "overview"
  | "runs"
  | "projects"
  | "agents"
  | "connections"
  | "connectors"
  | "memory"
  | "e2e"
  | "health"
  | "workflow";
const stageLabels: Record<Stage, string> = {
  intake: "Ready to plan",
  planning: "Planning",
  approval: "Needs approval",
  developing: "Developing",
  verifying: "Verifying",
  reviewing: "In review",
  ready: "Ready to publish",
  publishing: "Publishing",
  complete: "PR created",
};
const roleNames: Record<Role, string> = {
  planner: "Planner",
  developer: "Developer",
  reviewer: "Reviewer",
};
const stageIcons = [
  FileCode2,
  BookOpen,
  ShieldCheck,
  Code2,
  CheckCheck,
  ShieldCheck,
  GitPullRequest,
];
const flow = [
  "Task",
  "Plan",
  "Approve",
  "Develop",
  "Verify",
  "Review",
  "Deliver",
];
const date = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

function Brand({ small = false }: { small?: boolean }) {
  return (
    <div className={cn("brand", small && "brand-small")}>
      <span className="brand-mark">
        <i />
        <i />
        <i />
      </span>
      {!small && (
        <span>
          workstream<span className="brand-dot">.</span>
        </span>
      )}
    </div>
  );
}
function Status({ run }: { run: Run }) {
  return (
    <span
      data-step={stepOf[run.stage]}
      className={cn(
        "stage-status",
        "status-badge",
        run.status === "blocked"
          ? "blocked"
          : run.stage === "complete"
            ? "complete"
            : run.stage === "approval"
              ? "approval"
              : run.status === "running"
                ? "running"
                : "",
      )}
    >
      {run.status === "running" ? (
        <LoaderCircle size={12} className="spin" />
      ) : (
        <span className="status-dot" />
      )}
      {run.status === "blocked"
        ? "Needs attention"
        : run.stage === "complete" && run.prStatus?.state === "completed"
          ? "PR completed"
          : run.stage === "complete" && run.prStatus?.state === "abandoned"
            ? "PR abandoned"
            : stageLabels[run.stage]}
    </span>
  );
}
function Empty({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  useLayoutEffect(() => {
    if (snapshot)
      document.documentElement.classList.toggle(
        "dark",
        snapshot.theme === "dark",
      );
  }, [snapshot]);
  const [page, setPage] = useState<Page>("overview");
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"project" | "task" | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All runs");
  useEffect(() => {
    if (!snapshot?.runtime.connected && !snapshot?.claude.connected) return;
    const timer = setInterval(() => {
      void bridge
        .command({ type: "refreshUsage" })
        .then(setSnapshot)
        .catch(() => {});
    }, 60_000);
    return () => clearInterval(timer);
  }, [snapshot?.runtime.connected, snapshot?.claude.connected]);
  useEffect(() => {
    let active = true;
    bridge
      .snapshot()
      .then((value) => {
        if (active) setSnapshot(value);
      })
      .catch((error) => setError(String(error)));
    const unsubscribe = bridge.subscribe(setSnapshot);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  async function send(command: Command) {
    setPending(true);
    setError("");
    try {
      const next = await bridge.command(command);
      setSnapshot(next);
      return next;
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message.replace(
              /^Error invoking remote method '[^']+': Error: /,
              "",
            )
          : String(error),
      );
      return null;
    } finally {
      setPending(false);
    }
  }
  const navigate = (next: Page) => {
    // First visit: look up who each provider is signed in as (read-only).
    if (next === "connections" && !snapshot?.connections && snapshot?.desktop)
      void send({ type: "refreshConnections" });
    setPage(next);
    setSelected(null);
    setQuery("");
  };
  if (!snapshot)
    return (
      <div className="loading-screen">
        <Brand />
        <LoaderCircle className="spin" />
        {error && <p role="alert">{error}</p>}
      </div>
    );
  const run = snapshot.runs.find((r) => r.id === selected);
  const attention = snapshot.runs.filter(
    (r) => r.status === "blocked" || r.stage === "approval",
  ).length;
  const active = snapshot.runs.filter((r) => r.status === "running").length;
  const complete = snapshot.runs.filter((r) => r.stage === "complete").length;
  const connectedProjects = snapshot.projects.filter(
    (project) => !project.archived,
  );
  const ready =
    connectedProjects.length > 0 &&
    (snapshot.runtime.authenticated || snapshot.claude.authenticated);
  const filtered = snapshot.runs
    .filter((r) =>
      `${r.title} ${r.ticketKey}`.toLowerCase().includes(query.toLowerCase()),
    )
    .filter(
      (r) =>
        filter === "All runs" ||
        (filter === "Needs attention"
          ? r.status === "blocked" || r.stage === "approval"
          : filter === "Active"
            ? r.status === "running"
            : r.stage === "complete"),
    );
  const createTask = () =>
    setDialog(connectedProjects.length ? "task" : "project");
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <div className="workspace-switch">
          <div className="workspace-avatar">W</div>
          <div>
            <strong>My workspace</strong>
            <span>Local workspace</span>
          </div>
          <span className="local-dot" title="Runs on this computer" />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {(
            [
              { id: "overview", title: "Overview", icon: LayoutDashboard },
              { id: "runs", title: "All runs", icon: WorkflowIcon },
              { id: "projects", title: "Projects", icon: FolderGit2 },
              { id: "memory", title: "Memory", icon: Brain },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              className={cn("nav-item", page === item.id && "active")}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={18} />
              <span>{item.title}</span>
              {item.id === "runs" && snapshot.runs.length > 0 && (
                <span className="nav-count">{snapshot.runs.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="nav-label second">CONFIGURATION</div>
        <nav aria-label="Configuration">
          <button
            className={cn("nav-item", page === "agents" && "active")}
            onClick={() => navigate("agents")}
          >
            <Sparkles size={18} />
            Agents & models
          </button>
          <button
            className={cn("nav-item", page === "e2e" && "active")}
            onClick={() => navigate("e2e")}
          >
            <FlaskConical size={18} />
            Tests
          </button>
          <button
            className={cn("nav-item", page === "health" && "active")}
            onClick={() => navigate("health")}
          >
            <HeartPulse size={18} />
            Health
            {(snapshot.health?.items.filter((i) => i.status === "fail").length ?? 0) > 0 && (
              <span className="nav-count fail">{snapshot.health!.items.filter((i) => i.status === "fail").length}</span>
            )}
          </button>
          <button
            className={cn("nav-item", (page === "connections" || page === "connectors") && "active")}
            onClick={() => navigate("connections")}
          >
            <Cable size={18} />
            Connections
          </button>
          <button
            className={cn("nav-item", page === "workflow" && "active")}
            onClick={() => navigate("workflow")}
          >
            <Settings2 size={18} />
            How it works
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="local-card">
            <span className="local-card-icon">
              <ShieldCheck size={18} />
            </span>
            <strong>Your code stays local</strong>
            <p>Agents work in isolated Git worktrees on your machine.</p>
            <small>Selected context is sent to your model provider.</small>
          </div>
          <button
            className="connection-button"
            onClick={() => navigate("agents")}
          >
            <span
              className={cn(
                "connection-dot",
                (snapshot.runtime.connected ||
                  snapshot.claude.connected ||
                  snapshot.copilot.authenticated) &&
                  "connected",
              )}
            />
            <div>
              <strong>
                {(() => {
                  const on = [
                    snapshot.runtime.connected && "Codex",
                    snapshot.claude.connected && "Claude",
                    snapshot.copilot.authenticated && "Copilot",
                  ].filter(Boolean) as string[];
                  return on.length
                    ? `${on.length > 1 ? `${on.slice(0, -1).join(", ")} and ${on.at(-1)}` : on[0]} connected`
                    : "Connect your agent";
                })()}
              </strong>
              <span>
                {snapshot.runtime.authenticated ||
                snapshot.claude.authenticated ||
                snapshot.copilot.authenticated
                  ? "Ready when you are"
                  : "Set up your local runtime"}
              </span>
            </div>
            <ChevronRight size={15} />
          </button>
          <div className="version">
            <span>Workstream</span>
            <span>v{__APP_VERSION__} · local</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>
              {run
                ? run.ticketKey || "Task"
                : {
                    overview: "Overview",
                    runs: "All runs",
                    projects: "Projects",
                    agents: "Agents & models",
                    connections: "Connections",
                    connectors: "Connections",
                    memory: "Memory",
                    e2e: "Tests",
                    health: "Health",
                    workflow: "How it works",
                  }[page]}
            </strong>
          </div>
          <div className="topbar-right">
            <AccountUsage
              runtime={snapshot.runtime}
              claude={snapshot.claude}
              copilot={snapshot.copilot}
              claudeAuth={snapshot.settings.claudeAuth ?? "claude-code"}
              refresh={() => void send({ type: "refreshUsage", force: true })}
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label={
                snapshot.theme === "dark"
                  ? "Switch to light mode"
                  : "Switch to dark mode"
              }
              title={
                snapshot.theme === "dark"
                  ? "Switch to light mode"
                  : "Switch to dark mode"
              }
              disabled={pending}
              onClick={() =>
                void send({
                  type: "theme",
                  theme: snapshot.theme === "dark" ? "light" : "dark",
                })
              }
            >
              {snapshot.theme === "dark" ? <Sun /> : <Moon />}
            </Button>
            <span className="local-tag">
              <span />
              Local environment
            </span>
            <button
              aria-label="Show runs needing attention"
              className="icon-button"
              onClick={() => {
                navigate("runs");
                setFilter("Needs attention");
              }}
            >
              <Bell size={18} />
              {attention > 0 && <i />}
            </button>
            <span className="user-avatar">ME</span>
          </div>
        </header>
        <main className="main-content">
          {!snapshot.desktop && (
            <div className="notice">
              <Terminal size={16} />
              <span>
                Browser preview. Open the desktop app to connect repositories
                and run agents.
              </span>
            </div>
          )}
          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {snapshot.pendingApprovals.map((item) => (
            <section className="approval-request" key={item.id}>
              <h3>
                <ShieldCheck size={18} />
                Agent permission required
              </h3>
              <p>
                {(() => {
                  const owner = snapshot.runs.find((r) => r.id === item.runId);
                  return owner
                    ? `${owner.ticketKey ? `${owner.ticketKey}: ` : ""}${owner.title}`
                    : "Review this request before allowing the agent to continue.";
                })()}
              </p>
              <div className="approval-summary">
                <span className="approval-tool">{item.tool ?? "Request"}</span>
                {item.description && <span>{item.description}</span>}
              </div>
              {item.command && (
                <pre className="approval-command">{item.command}</pre>
              )}
              <details>
                <summary>Full request</summary>
                <pre>{item.details}</pre>
              </details>
              <div className="button-row">
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    void send({
                      type: "agentApproval",
                      id: item.id,
                      accept: false,
                    })
                  }
                >
                  Decline
                </Button>
                <Button
                  disabled={pending}
                  onClick={() =>
                    void send({
                      type: "agentApproval",
                      id: item.id,
                      accept: true,
                    })
                  }
                >
                  Allow once
                </Button>
                {item.canAllowSession && (
                  <Button
                    disabled={pending}
                    onClick={() =>
                      void send({
                        type: "agentApproval",
                        id: item.id,
                        accept: true,
                        scope: "session",
                      })
                    }
                  >
                    Allow for this agent session
                  </Button>
                )}
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    void send({
                      type: "agentApproval",
                      id: item.id,
                      accept: true,
                      scope: "run",
                    })
                  }
                  title="Accepts this and every later request in this run without asking. The agent's sandbox still applies."
                >
                  Allow everything for this run
                </Button>
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    void send({
                      type: "agentApproval",
                      id: item.id,
                      accept: true,
                      scope: "project",
                    })
                  }
                  title="Accepts agent requests in every run of this project without asking. Turn it off in the project settings. The agent's sandbox still applies."
                >
                  Always allow in this project
                </Button>
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    void send({
                      type: "agentApproval",
                      id: item.id,
                      accept: false,
                      scope: "pending",
                    })
                  }
                >
                  Decline all pending for this run
                </Button>
              </div>
            </section>
          ))}
          {run ? (
            <RunDetail
              key={run.id}
              run={run}
              project={snapshot.projects.find((p) => p.id === run.projectId)!}
              snapshot={snapshot}
              send={send}
              pending={pending}
              error={error}
              onBack={() => setSelected(null)}
              onOpenMemory={() => navigate("memory")}
            />
          ) : page === "overview" || page === "runs" ? (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">YOUR DEVELOPMENT, IN MOTION</div>
                  <h1>
                    {page === "overview"
                      ? "From task to pull request."
                      : "Every run. One workspace."}
                  </h1>
                  <p>
                    {page === "overview"
                      ? "A clear path from what needs doing to work ready for review."
                      : "Follow your tasks from the first plan to the final pull request."}
                  </p>
                </div>
                <Button onClick={createTask}>
                  <Plus size={16} />
                  New task
                </Button>
              </div>
              {page === "overview" && (
                <>
                  <div className="stats-grid">
                    {[
                      {
                        label: "Total runs",
                        value: snapshot.runs.length,
                        icon: WorkflowIcon,
                        detail: "Across your projects",
                      },
                      {
                        label: "In progress",
                        value: active,
                        icon: Activity,
                        detail: "Agents at work",
                        color: "blue",
                      },
                      {
                        label: "Needs attention",
                        value: attention,
                        icon: Clock3,
                        detail: "Ready for your decision",
                        color: "amber",
                      },
                      {
                        label: "PRs delivered",
                        value: complete,
                        icon: GitPullRequest,
                        detail: "Reviewed and published",
                        color: "green",
                      },
                    ].map((stat) => (
                      <div className="stat-card" key={stat.label}>
                        <div className="stat-top">
                          <span>{stat.label}</span>
                          <stat.icon size={17} className={stat.color} />
                        </div>
                        <strong>
                          {stat.value.toString().padStart(2, "0")}
                        </strong>
                        <small>{stat.detail}</small>
                      </div>
                    ))}
                  </div>
                  <section className="pipeline-card">
                    <div className="section-title">
                      <div>
                        <span className="section-icon">
                          <WorkflowIcon size={16} />
                        </span>
                        <h2>A workflow you can trust</h2>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => navigate("workflow")}
                      >
                        View workflow <ArrowUpRight size={14} />
                      </button>
                    </div>
                    <div className="pipeline">
                      {flow.map((label, index) => {
                        const Icon = stageIcons[index];
                        return (
                          <div
                            className="pipeline-step"
                            key={label}
                            data-step={
                              [
                                undefined,
                                "plan",
                                "approve",
                                "develop",
                                "verify",
                                "review",
                                "publish",
                              ][index]
                            }
                          >
                            <div
                              className={cn(
                                "pipeline-node",
                                index === 2 && "human",
                                index === 6 && "delivery",
                              )}
                            >
                              <Icon size={19} />
                            </div>
                            <strong>{label}</strong>
                            <span>
                              {
                                [
                                  "Your requirements",
                                  "Repository-aware",
                                  "You decide",
                                  "Dedicated agent",
                                  "Real checks",
                                  "Independent agent",
                                  "Ready for your team",
                                ][index]
                              }
                            </span>
                            {index < 6 && (
                              <ChevronRight
                                className="pipeline-chevron"
                                size={16}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className="pipeline-footer">
                      <ShieldCheck size={14} />
                      <span>
                        One isolated worktree per task. Every plan approved.
                        Every change reviewed.
                      </span>
                      <Badge variant="secondary">Human in the loop</Badge>
                    </div>
                  </section>
                </>
              )}
              <div
                className={cn(
                  "dashboard-lower",
                  page === "runs" && "full-width",
                )}
              >
                <section className="runs-panel">
                  <div className="section-title">
                    <div>
                      <h2>
                        {page === "overview" ? "Recent runs" : "Workflow runs"}
                      </h2>
                      <span className="subtle-count">
                        {snapshot.runs.length}
                      </span>
                    </div>
                    {page === "overview" && (
                      <button
                        className="text-button"
                        onClick={() => navigate("runs")}
                      >
                        View all <ArrowRight size={14} />
                      </button>
                    )}
                  </div>
                  <div className="runs-tools">
                    <div className="filters" aria-label="Filter runs">
                      {[
                        "All runs",
                        "Active",
                        "Needs attention",
                        "Completed",
                      ].map((item) => (
                        <button
                          key={item}
                          className={cn(filter === item && "selected")}
                          onClick={() => setFilter(item)}
                        >
                          {item}
                        </button>
                      ))}
                    </div>
                    <div className="search-box">
                      <Search size={15} />
                      <input
                        aria-label="Search runs"
                        placeholder="Search runs..."
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </div>
                  </div>
                  {filtered.length ? (
                    <div className="run-list">
                      {filtered
                        .slice(0, page === "overview" ? 6 : undefined)
                        .map((item) => (
                          <button
                            className="run-row"
                            key={item.id}
                            onClick={() => setSelected(item.id)}
                          >
                            <span className="run-icon">
                              <FileCode2 size={19} />
                            </span>
                            <span className="run-title">
                              <strong>{item.title}</strong>
                              <span>
                                {item.ticketKey && <b>{item.ticketKey}</b>}
                                {
                                  snapshot.projects.find(
                                    (p) => p.id === item.projectId,
                                  )?.name
                                }{" "}
                                <TechLogos
                                  ids={
                                    snapshot.projects.find(
                                      (p) => p.id === item.projectId,
                                    )?.stack
                                  }
                                  limit={4}
                                  size={11}
                                />{" "}
                                <span>·</span> {date(item.createdAt)}
                                {(item.prStatus?.state === "completed" ||
                                  item.prStatus?.state === "abandoned") && (
                                  <span
                                    className={`pr-pill small ${item.prStatus.state}`}
                                  >
                                    {item.prStatus.state === "completed"
                                      ? "Merged"
                                      : "Abandoned"}
                                  </span>
                                )}
                              </span>
                            </span>
                            <MiniProgress run={item} />
                            <Status run={item} />
                            <ChevronRight size={16} />
                          </button>
                        ))}
                    </div>
                  ) : (
                    <Empty
                      icon={<WorkflowIcon size={27} />}
                      title={
                        snapshot.runs.length
                          ? "No matching runs"
                          : "Your next idea starts here"
                      }
                      action={
                        !snapshot.runs.length ? (
                          <Button variant="outline" onClick={createTask}>
                            <Plus size={15} />
                            Create your first task
                          </Button>
                        ) : undefined
                      }
                    >
                      {snapshot.runs.length
                        ? "Try a different filter or search term."
                        : "Bring a task, connect a repository, and let your agents take it from there."}
                    </Empty>
                  )}
                </section>
                {page === "overview" && (
                  <aside className="getting-started">
                    <div className="section-title">
                      <div>
                        <Zap size={17} className="blue" />
                        <h2>
                          {ready ? "Ready to build" : "Make yourself at home"}
                        </h2>
                      </div>
                    </div>
                    <p>A little setup. A lot less busywork.</p>
                    {(() => {
                      const engines = snapshot.runtime.authenticated || snapshot.claude.authenticated || snapshot.copilot.authenticated;
                      const providers = new Set(snapshot.projects.filter((p) => !p.archived).map((p) => p.provider));
                      const signedIn = [...providers].every((p) => p === "other" || snapshot.connections?.[p as "azure" | "github"]?.signedIn);
                      const skills = snapshot.projects.some((p) => (p.skillInfo ?? []).some((k) => !k.workflow));
                      const tests = snapshot.projects.some((p) => p.e2eConfig || (p.unitTests ?? []).length);
                      const steps = [
                        { done: snapshot.projects.length > 0, title: "Connect a repository", description: "Choose a project on your computer", go: () => setDialog("project") },
                        { done: engines, title: "Meet your agents", description: "Connect Codex, Claude or Copilot and choose models", go: () => navigate("agents") },
                        { done: providers.size > 0 && signedIn, title: "Sign in to publish", description: "Azure DevOps or GitHub, for pull requests", go: () => navigate("connections") },
                        { done: skills, title: "Give the agents project skills", description: "Generate them from your code in Agents & models", go: () => navigate("agents") },
                        { done: tests, title: "Add tests that run before publishing", description: "Unit tests and end-to-end journeys", go: () => navigate("e2e") },
                        { done: snapshot.runs.length > 0, title: "Create your first task", description: "A ticket, a bug, or a new idea", go: createTask },
                      ];
                      const doneCount = steps.filter((x) => x.done).length;
                      return (
                        <>
                          <div className="setup-progress">
                            <span style={{ width: `${(doneCount / steps.length) * 100}%` }} />
                          </div>
                          {steps.map((step, i) => (
                            <SetupStep key={step.title} number={String(i + 1)} done={step.done} title={step.title} description={step.description} onClick={step.go} />
                          ))}
                          <button type="button" className="health-link" onClick={() => navigate("health")}>
                            Check that everything works (Health)
                          </button>
                        </>
                      );
                    })()}
                    <div className="setup-note">
                      <Sparkles size={16} />
                      <p>
                        Start with a pasted task.
                        <br />
                        No ticket integration needed.
                      </p>
                    </div>
                  </aside>
                )}
              </div>
              {page === "overview" && <TaskStats snapshot={snapshot} />}
              <div className="page-footer">
                <span>
                  <span className="tiny-dot" /> Built for deliberate, dependable
                  development.
                </span>
                <span>Your workspace. Your workflow.</span>
              </div>
            </>
          ) : page === "projects" ? (
            <Projects
              projects={snapshot.projects}
              pending={pending}
              send={send}
              onAdd={() => setDialog("project")}
            />
          ) : page === "agents" ? (
            <Agents
              key={snapshot.settings.codexPath}
              snapshot={snapshot}
              pending={pending}
              send={send}
            />
          ) : page === "memory" ? (
            <MemoryPage snapshot={snapshot} pending={pending} send={send} />
          ) : page === "health" ? (
            <HealthPage snapshot={snapshot} pending={pending} send={send} />
          ) : page === "e2e" ? (
            <E2ePage snapshot={snapshot} pending={pending} send={send} />
          ) : page === "connectors" || page === "connections" ? (
            <>
              <div className="page-tabs" role="tablist" aria-label="Connections">
                <button role="tab" aria-selected={page === "connections"} className={cn(page === "connections" && "active")} onClick={() => navigate("connections")}>
                  <Cable size={15} /> Git providers <small>publishing pull requests</small>
                </button>
                <button role="tab" aria-selected={page === "connectors"} className={cn(page === "connectors" && "active")} onClick={() => navigate("connectors")}>
                  <Plug size={15} /> Connectors <small>Jira, Figma and others for the agents</small>
                </button>
              </div>
              {page === "connectors" ? (
                <ConnectorsPage snapshot={snapshot} pending={pending} send={send} />
              ) : (
                <Connections snapshot={snapshot} pending={pending} send={send} />
              )}
            </>
          ) : (
            <WorkflowPage />
          )}
        </main>
      </div>
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        <DialogContent className="workstream-dialog">
          <DialogHeader>
            <DialogTitle>
              {dialog === "project"
                ? "Connect a repository"
                : "What are we working on?"}
            </DialogTitle>
            <DialogDescription>
              {dialog === "project"
                ? "Workstream reads your project conventions and creates isolated worktrees for each task."
                : "Paste your requirements. Your planner will investigate the repository before proposing a plan."}
            </DialogDescription>
          </DialogHeader>
          {dialog === "project" ? (
            <ConnectForm
              pending={pending}
              send={send}
              close={() => setDialog(null)}
            />
          ) : dialog === "task" ? (
            <TaskForm
              projects={connectedProjects}
              jira={snapshot.connectorList.some(
                (c) => c.id === "atlassian" && (c.connected || c.signedIn),
              )}
              pending={pending}
              send={send}
              created={(id) => {
                setDialog(null);
                setSelected(id);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

type Send = (command: Command) => Promise<Snapshot | null>;
function SetupStep({
  number,
  done,
  title,
  description,
  onClick,
}: {
  number: string;
  done: boolean;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button className="setup-step" onClick={onClick}>
      <span className={cn("setup-number", done && "done")}>
        {done ? <Check size={14} /> : number}
      </span>
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <ChevronRight size={14} />
    </button>
  );
}
function ConnectForm({
  pending,
  send,
  close,
}: {
  pending: boolean;
  send: Send;
  close: () => void;
}) {
  const [path, setPath] = useState("");
  return (
    <form
      className="form-stack"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await send({ type: "connectProject", path })) close();
      }}
    >
      <Field label="Repository folder">
        <div className="input-row">
          <Input
            placeholder="C:\Source\your-project"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            required
          />
          <Button
            variant="outline"
            type="button"
            onClick={async () => {
              const selected = await bridge.chooseFolder();
              if (selected) setPath(selected);
            }}
          >
            Browse
          </Button>
        </div>
      </Field>
      <div className="form-info">
        <FolderGit2 size={19} />
        <p>
          Choose an existing Git checkout. Your project files stay in place.
          Workstream detects the remote, instructions, and skills.
        </p>
      </div>
      <div className="dialog-footer">
        <Button type="button" variant="outline" onClick={close}>
          Cancel
        </Button>
        <Button disabled={pending || !path}>
          {pending ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <Plus size={16} />
          )}
          Connect repository
        </Button>
      </div>
    </form>
  );
}
function TaskForm({
  projects,
  jira,
  pending,
  send,
  created,
}: {
  projects: Project[];
  jira: boolean;
  pending: boolean;
  send: Send;
  created: (id: string) => void;
}) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [ticketKey, setTicketKey] = useState("");
  const [description, setDescription] = useState("");
  const [images, setImages] = useState<ImageInput[]>([]);
  const [imageBusy, setImageBusy] = useState(false);
  const [jiraKey, setJiraKey] = useState("");
  const [importing, setImporting] = useState(false);
  const [listing, setListing] = useState(false);
  const [jiraList, setJiraList] = useState<Snapshot["jiraList"]>();
  const importJira = async (key = jiraKey.trim()) => {
    setImporting(true);
    const next = await send({ type: "importJira", key });
    setImporting(false);
    const ticket = next?.jiraImport;
    if (ticket) {
      setTitle(ticket.title.slice(0, 200));
      setTicketKey(ticket.key);
      setDescription(ticket.description.slice(0, 50000));
    }
  };
  return (
    <form
      className="form-stack"
      onSubmit={async (e) => {
        e.preventDefault();
        const result = await send({
          type: "createRun",
          projectId,
          title,
          ticketKey,
          description,
          images,
        });
        if (result) created(result.runs[0].id);
      }}
    >
      {jira && (
        <div className="jira-import">
          <Ticket size={17} />
          <Input
            value={jiraKey}
            onChange={(e) => setJiraKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (/^[A-Za-z][A-Za-z0-9]*-[0-9]+$/.test(jiraKey.trim()))
                  void importJira();
              }
            }}
            placeholder="Jira key, for example DPP-1234"
            aria-label="Jira key to import"
          />
          <Button
            type="button"
            variant="outline"
            disabled={
              importing || !/^[A-Za-z][A-Za-z0-9]*-[0-9]+$/.test(jiraKey.trim())
            }
            onClick={() => void importJira()}
          >
            {importing && <LoaderCircle className="spin" size={14} />}
            <TechIcon id="jira" size={13} /> Import from Jira
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={listing}
            onClick={async () => {
              setListing(true);
              const next = await send({ type: "jiraMine" });
              setJiraList(next?.jiraList ?? []);
              setListing(false);
            }}
          >
            {listing && <LoaderCircle className="spin" size={14} />} My tickets
          </Button>
        </div>
      )}
      {jira && jiraList && (
        <ul className="jira-list">
          {jiraList.length ? (
            jiraList.map((ticket) => (
              <li key={ticket.key}>
                <button
                  type="button"
                  onClick={() => {
                    setJiraKey(ticket.key);
                    void importJira(ticket.key);
                  }}
                >
                  <strong>{ticket.key}</strong>
                  <span>{ticket.title}</span>
                  {ticket.status && <small>{ticket.status}</small>}
                </button>
              </li>
            ))
          ) : (
            <li className="muted-note">No open tickets assigned to you.</li>
          )}
        </ul>
      )}
      <Field label="Project">
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="form-columns">
        <Field label="Task title">
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What should change?"
            maxLength={200}
            required
          />
        </Field>
        <Field label="Ticket key (optional)">
          <Input
            value={ticketKey}
            onChange={(e) => setTicketKey(e.target.value)}
            placeholder="DPP-1234"
            maxLength={60}
          />
        </Field>
      </div>
      <ImagePicker images={images} onChange={setImages} onBusy={setImageBusy}>
        <Field label="Requirements & acceptance criteria">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the problem, desired outcome, and anything the agent should know…"
            rows={7}
            required
          />
        </Field>
      </ImagePicker>
      <div className="form-info">
        <ShieldCheck size={19} />
        <p>
          You’ll review the implementation plan before an agent changes any
          code.
        </p>
      </div>
      <div className="dialog-footer">
        <Button
          disabled={
            pending || imageBusy || !title.trim() || !description.trim()
          }
        >
          Create task <ArrowRight size={16} />
        </Button>
      </div>
    </form>
  );
}
function Projects({
  projects,
  pending,
  send,
  onAdd,
}: {
  projects: Project[];
  pending: boolean;
  send: Send;
  onAdd: () => void;
}) {
  const [showRemoved, setShowRemoved] = useState(false);
  const displayed = projects.filter(
    (project) => showRemoved || !project.archived,
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">A HOME FOR YOUR WORK</div>
          <h1>Connected projects</h1>
          <p>
            Repository context, conventions, and a safe place for every task.
          </p>
        </div>
        <Button onClick={onAdd}>
          <Plus size={16} />
          Connect repository
        </Button>
      </div>
      <label className="project-filter">
        <input
          type="checkbox"
          checked={showRemoved}
          onChange={(event) => setShowRemoved(event.target.checked)}
        />{" "}
        Show removed projects
      </label>
      {displayed.length ? (
        <div className="project-grid">
          {displayed.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              send={send}
              pending={pending}
            />
          ))}
        </div>
      ) : (
        <section className="panel">
          <Empty
            icon={<FolderGit2 size={28} />}
            title="Bring your first repository"
            action={
              <Button onClick={onAdd}>
                Connect repository <ArrowRight size={16} />
              </Button>
            }
          >
            Start with a local Git checkout. Workstream discovers its
            instructions and keeps each task in its own worktree.
          </Empty>
        </section>
      )}
    </>
  );
}
function ProjectCard({
  project,
  send,
  pending,
}: {
  project: Project;
  send: Send;
  pending: boolean;
}) {
  const [targetBranch, setTargetBranch] = useState(project.targetBranch);
  const [branchPrefix, setBranchPrefix] = useState(project.branchPrefix);
  const [name, setName] = useState(project.name);
  const [allowAgentCommands, setAllowAgentCommands] = useState(
    Boolean(project.allowAgentCommands),
  );
  const [editing, setEditing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  return (
    <section className="project-card">
      <div className="project-card-header">
        <span className="project-avatar">
          <FolderGit2 size={24} />
        </span>
        <div>
          <h2>{project.name}</h2>
          <ProviderMark provider={project.provider} size="sm" />
        </div>
      </div>
      <p className="path-label">{project.path}</p>
      <div className="button-row">
        {!project.archived && (
          <Button variant="outline" onClick={() => setEditing(!editing)}>
            {editing ? "Close settings" : "Edit project"}
          </Button>
        )}
        {project.archived ? (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              void send({
                type: "archiveProject",
                id: project.id,
                archived: false,
              })
            }
          >
            Restore project
          </Button>
        ) : (
          <Button variant="outline" onClick={() => setConfirmRemove(true)}>
            Remove project
          </Button>
        )}
      </div>
      {confirmRemove && (
        <div className="notice">
          <div>
            <p>
              Remove this project from connected projects? Run history and
              repository files are kept. You can restore it later.
            </p>
            <div className="button-row">
              <Button
                disabled={pending}
                onClick={async () => {
                  if (
                    await send({
                      type: "archiveProject",
                      id: project.id,
                      archived: true,
                    })
                  ) {
                    setConfirmRemove(false);
                    setEditing(false);
                  }
                }}
              >
                Confirm removal
              </Button>
              <Button variant="outline" onClick={() => setConfirmRemove(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
      <div className="project-details">
        <span>
          <BookOpen size={15} />
          {project.instructions ? "AGENTS.md detected" : "No root AGENTS.md"}
        </span>
        <span>
          <Sparkles size={15} />
          {project.skills.length} local skills
        </span>
      </div>
      {!!project.stack?.length && (
        <div className="project-stack">
          <small>Stack</small>
          <TechStack ids={project.stack} />
        </div>
      )}
      {editing && !project.archived && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            await send({
              type: "updateProject",
              id: project.id,
              name,
              targetBranch,
              branchPrefix,
              allowAgentCommands,
            });
          }}
        >
          <Field label="Project name">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={120}
            />
          </Field>
          <div className="form-columns">
            <Field label="PR target branch">
              <Input
                value={targetBranch}
                onChange={(e) => setTargetBranch(e.target.value)}
                required
              />
            </Field>
            <Field label="Branch prefix">
              <Input
                value={branchPrefix}
                onChange={(e) => setBranchPrefix(e.target.value)}
                required
              />
            </Field>
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={allowAgentCommands}
              onChange={(e) => setAllowAgentCommands(e.target.checked)}
            />
            Always allow agent commands in this project (no permission prompts;
            each agent&apos;s sandbox still applies, and you can say &quot;Ask
            me again&quot; in a run)
          </label>
          <Button
            variant="outline"
            disabled={
              pending ||
              (name === project.name &&
                targetBranch === project.targetBranch &&
                branchPrefix === project.branchPrefix &&
                allowAgentCommands === Boolean(project.allowAgentCommands))
            }
          >
            Save project settings
          </Button>
        </form>
      )}
      {project.provider === "other" ? (
        <p className="muted-note">
          Planning, development, and review are supported. Choose Azure DevOps
          or GitHub in Connections to publish pull requests.
        </p>
      ) : (
        <>
          <AccessChips access={project.access} />
          {project.access && !project.access.ok && (
            <p className="inline-error">{project.access.summary}</p>
          )}
        </>
      )}
    </section>
  );
}
function Agents({
  snapshot,
  pending,
  send,
}: {
  snapshot: Snapshot;
  pending: boolean;
  send: Send;
}) {
  const [settings, setSettings] = useState<Settings>(snapshot.settings);
  const [claudeKey, setClaudeKey] = useState("");
  const [loginCode, setLoginCode] = useState("");
  const claude = snapshot.claude;
  const claudeAuth = settings.claudeAuth ?? "claude-code";
  const setupProjects = snapshot.projects.filter((p) => !p.archived);
  const [setupProjectId, setSetupProjectId] = useState(
    setupProjects[0]?.id ?? "",
  );
  const setupProject =
    setupProjects.find((p) => p.id === setupProjectId) ?? setupProjects[0];
  const [setup, setSetup] = useState(() => initialSetup(setupProject));
  const [setupDirty, setSetupDirty] = useState(false);
  const chooseSetupProject = (id: string) => {
    setSetupProjectId(id);
    setSetup(initialSetup(setupProjects.find((p) => p.id === id)));
    setSetupDirty(false);
  };
  const update = (role: Role, model: string) =>
    setSettings((current) => ({
      ...current,
      profiles: {
        ...current.profiles,
        [role]: { ...current.profiles[role], model },
      },
    }));
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">THE RIGHT AGENT FOR THE JOB</div>
          <h1>Meet your team</h1>
          <p>Separate sessions. Clear responsibilities. Models you control.</p>
        </div>
        <Badge variant="outline">Codex · Claude · Copilot</Badge>
      </div>
      <section className="runtime-card">
        <div>
          <span className="runtime-icon">
            <EngineMark engine="codex" />
          </span>
          <div>
            <h2>Local Codex runtime</h2>
            <p>
              {snapshot.runtime.connected
                ? snapshot.runtime.accountLabel
                : "Connect an installed Codex executable to get started."}
            </p>
          </div>
          <span
            className={cn(
              "status-badge",
              snapshot.runtime.connected && "complete",
            )}
          >
            <span className="status-dot" />
            {snapshot.runtime.connected ? "Connected" : "Not connected"}
          </span>
        </div>
        <Field
          label="Codex executable"
          hint="Use codex if it is on PATH, or the full path to codex.exe."
        >
          <Input
            value={settings.codexPath}
            onChange={(e) =>
              setSettings({ ...settings, codexPath: e.target.value })
            }
          />
        </Field>
        <div className="button-row">
          <Button
            disabled={pending}
            onClick={async () => {
              if (await send({ type: "settings", settings }))
                await send({ type: "connectAgent" });
            }}
          >
            {pending && <LoaderCircle className="spin" size={15} />}
            {snapshot.runtime.connected
              ? "Refresh connection"
              : "Connect Codex"}
          </Button>
          <Button
            variant="outline"
            disabled={pending}
            onClick={async () => {
              if (await send({ type: "settings", settings }))
                await send({ type: "login" });
            }}
          >
            <BrandLogo brand="chatgpt" size={15} /> Sign in with ChatGPT{" "}
            <ArrowUpRight size={14} />
          </Button>
        </div>
        {snapshot.runtime.note && (
          <p className="muted-note">{snapshot.runtime.note}</p>
        )}
        {snapshot.runtime.error && (
          <p className="inline-error">{snapshot.runtime.error}</p>
        )}
      </section>
      <section className="runtime-card">
        <div>
          <span className="runtime-icon claude-icon">
            <EngineMark engine="claude" />
          </span>
          <div>
            <h2>Claude</h2>
            <p>
              {claude.connected
                ? claude.accountLabel
                : claudeAuth === "claude-code"
                  ? "Sign in with your Claude account through Claude Code."
                  : claude.hasKey
                    ? "API key saved. Connect to check it and load models."
                    : "Add an Anthropic API key to run agents on Claude."}
            </p>
          </div>
          <span className={cn("status-badge", claude.connected && "complete")}>
            <span className="status-dot" />
            {claude.connected ? "Connected" : "Not connected"}
          </span>
        </div>
        <Field label="Sign in with">
          <div className="engine-toggle auth-toggle" role="radiogroup">
            {(
              [
                ["claude-code", "Claude Code sign-in (your plan)"],
                ["api-key", "Anthropic API key"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={claudeAuth === value}
                className={cn(claudeAuth === value && "active")}
                onClick={() => setSettings({ ...settings, claudeAuth: value })}
              >
                {label}
              </button>
            ))}
          </div>
        </Field>
        <div className="form-columns">
          {claudeAuth === "api-key" ? (
            <Field
              label="Anthropic API key"
              hint={
                claude.hasKey
                  ? "A key is saved, encrypted with Windows credential protection. Paste a new key to replace it."
                  : "Stored encrypted on this computer, never in Workstream's state file. Usage is billed to the key's API account."
              }
            >
              <Input
                type="password"
                autoComplete="off"
                placeholder={claude.hasKey ? "••••••••••••••••" : "sk-ant-…"}
                value={claudeKey}
                onChange={(e) => setClaudeKey(e.target.value)}
              />
            </Field>
          ) : (
            <p className="muted-note">
              Uses the account you are signed in with in Claude Code, the same
              way Codex uses your ChatGPT sign-in. Agent runs count towards your
              Claude plan's usage limits. Meant for your own use: if you share
              Workstream with others, switch to an API key.
            </p>
          )}
          <Field
            label="Claude Code executable"
            hint="Use claude if it is on PATH, or the full path to claude.exe."
          >
            <Input
              value={settings.claudePath ?? "claude"}
              onChange={(e) =>
                setSettings({ ...settings, claudePath: e.target.value })
              }
            />
          </Field>
        </div>
        {claude.login && (
          <div className="login-code claude-login" role="status">
            <span>
              {claude.login.awaitingCode
                ? "If the browser shows a code, paste it here."
                : "Finish signing in to Claude in your browser…"}
            </span>
            {claude.login.url && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void send({ type: "openExternal", url: claude.login!.url! })
                }
              >
                Open sign-in page <ArrowUpRight size={13} />
              </Button>
            )}
            {claude.login.awaitingCode && (
              <form
                className="claude-code-form"
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (await send({ type: "claudeLoginCode", code: loginCode }))
                    setLoginCode("");
                }}
              >
                <Input
                  value={loginCode}
                  onChange={(e) => setLoginCode(e.target.value)}
                  placeholder="Paste code"
                  aria-label="Claude sign-in code"
                />
                <Button size="sm" disabled={loginCode.trim().length < 4}>
                  Submit
                </Button>
              </form>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void send({ type: "cancelClaudeLogin" })}
            >
              Cancel
            </Button>
          </div>
        )}
        <div className="button-row">
          {claudeAuth === "claude-code" && (
            <Button
              variant={claude.connected ? "outline" : "default"}
              disabled={pending || Boolean(claude.login)}
              onClick={async () => {
                if (await send({ type: "settings", settings }))
                  await send({ type: "loginClaude" });
              }}
            >
              Sign in with Claude <ArrowUpRight size={14} />
            </Button>
          )}
          <Button
            variant={claudeAuth === "claude-code" ? "outline" : "default"}
            disabled={
              pending ||
              (claudeAuth === "api-key" && !claudeKey.trim() && !claude.hasKey)
            }
            onClick={async () => {
              if (!(await send({ type: "settings", settings }))) return;
              if (claudeAuth === "api-key" && claudeKey.trim()) {
                if (await send({ type: "claudeKey", key: claudeKey.trim() }))
                  setClaudeKey("");
              } else await send({ type: "connectClaude" });
            }}
          >
            {pending && <LoaderCircle className="spin" size={15} />}
            {claudeAuth === "api-key" && claudeKey.trim()
              ? "Save key & connect"
              : claude.connected
                ? "Refresh connection"
                : "Connect Claude"}
          </Button>
          {claudeAuth === "api-key" && claude.hasKey && (
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => void send({ type: "claudeKey", key: null })}
            >
              Remove key
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() =>
              void send({
                type: "openExternal",
                url: "https://docs.claude.com/en/docs/claude-code/setup",
              })
            }
          >
            Install Claude Code <ArrowUpRight size={14} />
          </Button>
        </div>
        {claude.error && <p className="inline-error">{claude.error}</p>}
      </section>
      <section className="runtime-card">
        <div>
          <span className="runtime-icon copilot-icon">
            <EngineMark engine="copilot" />
          </span>
          <div>
            <h2>GitHub Copilot</h2>
            <p>
              {snapshot.copilot.authenticated
                ? `${snapshot.copilot.accountLabel} · ${snapshot.copilot.models.length} models on your plan`
                : snapshot.copilot.connected
                  ? "Runtime ready, not signed in"
                  : "Uses your GitHub account's Copilot plan. The Copilot runtime ships with Workstream."}
            </p>
          </div>
          <span
            className={cn(
              "status-badge",
              snapshot.copilot.authenticated && "complete",
            )}
          >
            <span className="status-dot" />
            {snapshot.copilot.authenticated ? "Connected" : "Not connected"}
          </span>
        </div>
        <p className="muted-note">
          Sign in with the GitHub account that has Copilot (for example your
          company seat). Agent runs count towards that account's premium
          requests. Copilot agents follow the same rules as the others:
          read-only stages cannot edit files, and commands ask you first.
        </p>
        {snapshot.connections?.github?.loginCode && (
          <p className="login-code">
            Enter code <code>{snapshot.connections.github.loginCode}</code> at{" "}
            {snapshot.connections.github.loginUrl ?? "github.com/login/device"}
          </p>
        )}
        <div className="button-row">
          <Button
            disabled={pending}
            onClick={async () => {
              if (await send({ type: "settings", settings }))
                await send({ type: "connectCopilot" });
            }}
          >
            {pending && <LoaderCircle className="spin" size={15} />}
            {snapshot.copilot.connected
              ? "Refresh connection"
              : "Connect Copilot"}
          </Button>
          <Button
            variant="outline"
            disabled={
              pending || Boolean(snapshot.connections?.github?.signingIn)
            }
            onClick={async () => {
              if (await send({ type: "signIn", provider: "github" }))
                await send({ type: "connectCopilot" });
            }}
          >
            <BrandLogo brand="github" size={15} /> Sign in with GitHub{" "}
            <ArrowUpRight size={14} />
          </Button>
        </div>
        {snapshot.copilot.error && (
          <p className="inline-error">{snapshot.copilot.error}</p>
        )}
      </section>
      <AgentSetupHeader
        projects={setupProjects}
        project={setupProject}
        saved={Boolean(setupProject?.agentSetup) && !setupDirty}
        onProject={chooseSetupProject}
        send={async (command) => {
          const next = await send(command);
          const fresh = next?.projects.find((p) => p.id === setupProject?.id);
          if (fresh && !setupDirty) setSetup(initialSetup(fresh));
          return next;
        }}
        pending={pending}
      />
      {setupProject && (
        <SkillGenerator
          project={setupProject}
          snapshot={snapshot}
          pending={pending}
          send={async (command) => {
            const next = await send(command);
            const fresh = next?.projects.find((p) => p.id === setupProject.id);
            if (!fresh) return next;
            if (!setupDirty) setSetup(initialSetup(fresh));
            else if (command.type === "saveGeneratedSkills" && fresh.agentSetup) {
              // Keep your unsaved notes and ticks, and add the skills that were just saved.
              const saved = fresh.agentSetup;
              setSetup((current) =>
                current
                  ? (Object.fromEntries(
                      (Object.keys(current) as Role[]).map((role) => [
                        role,
                        { ...current[role], skills: [...new Set([...current[role].skills, ...saved[role].skills])] },
                      ]),
                    ) as typeof current)
                  : initialSetup(fresh),
              );
            }
            return next;
          }}
        />
      )}
      <div className="agent-grid">
        {(["planner", "developer", "reviewer"] as Role[]).map((role, i) => {
          const Icon = [BookOpen, Code2, ShieldCheck][i];
          const profile = settings.profiles[role];
          const engine: Engine = profile.engine ?? "codex";
          const engineRuntime =
            engine === "claude"
              ? snapshot.claude
              : engine === "copilot"
                ? snapshot.copilot
                : snapshot.runtime;
          const selectedModel =
            engineRuntime.models.find((m) => m.id === profile.model) ??
            engineRuntime.models.find((m) => m.isDefault);
          return (
            <section className="agent-card" key={role}>
              <span className={cn("agent-avatar", role)}>
                <Icon size={25} />
              </span>
              <span className="agent-role">AGENT 0{i + 1}</span>
              <h2>{roleNames[role]}</h2>
              <p>
                {
                  [
                    "Investigates your repository and turns requirements into a concrete plan.",
                    "Receives the full approved plan and implements it in an isolated worktree.",
                    "Independently checks the diff, acceptance criteria, and verification evidence.",
                  ][i]
                }
              </p>
              <Field label="Runs on">
                <div className="engine-toggle runs-on-toggle" role="radiogroup">
                  {engines.map((option) => (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={engine === option}
                      title={engineNames[option]}
                      className={cn(engine === option && "active")}
                      onClick={() =>
                        setSettings((current) => ({
                          ...current,
                          profiles: {
                            ...current.profiles,
                            [role]: {
                              ...current.profiles[role],
                              engine: option,
                              model: "",
                            },
                          },
                        }))
                      }
                    >
                      <EngineMark engine={option} size={14} />
                      <span className="engine-label">
                        {engineShortNames[option]}
                      </span>
                      {!(option === "claude"
                        ? snapshot.claude.connected
                        : option === "copilot"
                          ? snapshot.copilot.authenticated
                          : snapshot.runtime.connected) && (
                        <span className="engine-off" title="Not connected" />
                      )}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Model">
                <select
                  value={profile.model}
                  onChange={(e) => update(role, e.target.value)}
                >
                  <option value="">Runtime default</option>
                  {engineRuntime.models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Reasoning effort">
                <select
                  value={profile.effort}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      profiles: {
                        ...settings.profiles,
                        [role]: { ...profile, effort: e.target.value },
                      },
                    })
                  }
                >
                  {[
                    ...new Set([
                      profile.effort,
                      ...(selectedModel?.efforts ?? ["low", "medium", "high"]),
                    ]),
                  ].map((effort) => (
                    <option key={effort} value={effort}>
                      {effort}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="agent-permission">
                {role === "developer" ? (
                  <Code2 size={13} />
                ) : (
                  <ShieldCheck size={13} />
                )}
                {role === "developer"
                  ? "Write access · ticket worktree"
                  : "Read-only access"}
              </div>
              <RoleInstructions
                role={role}
                rules={snapshot.roleRules[role]}
                project={setupProject}
                setup={setup}
                onChange={(next) => {
                  setSetup(next);
                  setSetupDirty(true);
                }}
                send={send}
              />
            </section>
          );
        })}
      </div>
      <PriceSettings
        models={[
          ...snapshot.runtime.models.map((model) => ({
            engine: "codex" as const,
            model,
          })),
          ...snapshot.claude.models.map((model) => ({
            engine: "claude" as const,
            model,
          })),
          ...snapshot.copilot.models.map((model) => ({
            engine: "copilot" as const,
            model,
          })),
        ]}
        prices={settings.prices ?? {}}
        onChange={(prices) =>
          setSettings((current) => ({ ...current, prices }))
        }
        onOpen={(url) => void send({ type: "openExternal", url })}
      />
      <section className="panel limits-panel">
        <h2>Limits</h2>
        <div className="limits-grid">
          <label>
            Cost limit per task (USD)
            <input
              type="number"
              min={0}
              step={1}
              value={settings.costLimitUsd ?? ""}
              placeholder="No limit"
              onChange={(e) =>
                setSettings((current) => ({
                  ...current,
                  costLimitUsd: e.target.value === "" ? undefined : Math.max(0, Number(e.target.value)),
                }))
              }
            />
            <small>
              A task that reaches it stops safely (work is kept) and asks you before spending more. Checked by
              Workstream, not by the agents, using the prices above.
            </small>
          </label>
          <label>
            Tasks at the same time
            <select
              value={settings.parallelTasks ?? 2}
              onChange={(e) => setSettings((current) => ({ ...current, parallelTasks: Number(e.target.value) }))}
            >
              <option value={1}>1 (one after another)</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
            </select>
            <small>
              Each task works in its own worktree. Commits, pushes and the tests before publishing still take turns
              per project.
            </small>
          </label>
        </div>
      </section>
      <div className="settings-footer">
        <p>
          Engine, model and effort are captured when a task is created. Notes
          and repository skills are read fresh each time an agent starts, so
          edits to a SKILL.md apply to the next agent session.
        </p>
        <Button
          disabled={pending}
          onClick={async () => {
            if (!(await send({ type: "settings", settings }))) return;
            if (
              setupProject &&
              setup &&
              (setupDirty || !setupProject.agentSetup)
            )
              if (
                await send({
                  type: "updateAgentSetup",
                  projectId: setupProject.id,
                  setup,
                })
              )
                setSetupDirty(false);
          }}
        >
          Save agents
        </Button>
      </div>
    </>
  );
}
function WorkflowPage() {
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">HOW IT WORKS</div>
          <h1>From task to pull request</h1>
          <p>
            Skills guide the agents. Workstream itself enforces the steps: the
            agents cannot skip your approval, the independent review or the
            tests before publishing.
          </p>
        </div>
        <Badge variant="secondary">Workflow v1</Badge>
      </div>
      <div className="workflow-detail">
        {[
          {
            title: "Investigate & plan",
            skill: "task-planner",
            text: "Read repository instructions, inspect relevant code, define acceptance criteria, and propose real verification commands.",
          },
          {
            title: "Your approval",
            skill: "Application gate",
            text: "Review or revise the complete plan. Choose whether approval includes committing, pushing, and creating the pull request.",
          },
          {
            title: "Develop in isolation",
            skill: "develop",
            text: "Fetch the target branch, create a dedicated Git worktree, and give a developer the approved plan and project context.",
          },
          {
            title: "Verify & independently review",
            skill: "review",
            text: "Run approved checks, then start a separate read-only reviewer. Return findings to the developer for up to two repair rounds.",
          },
          {
            title: "Test, then publish with evidence",
            skill: "Application gate",
            text: "Run the project's unit and end-to-end tests on the task branch (Tests page), confirm the reviewed files are unchanged, honor commit hooks, push without force, and create or update the pull request on Azure DevOps or GitHub.",
          },
        ].map((item, i) => (
          <section className="workflow-detail-step" key={item.title}>
            <span>{String(i + 1).padStart(2, "0")}</span>
            <div>
              <div>
                <h2>{item.title}</h2>
                <Badge variant="outline">{item.skill}</Badge>
              </div>
              <p>{item.text}</p>
            </div>
            {i < 4 && <ArrowDown className="workflow-down" size={16} />}
          </section>
        ))}
      </div>
      <div className="form-info workflow-note">
        <ShieldCheck size={20} />
        <p>
          Worktrees and progress are preserved on failure. Workstream never
          force-pushes or auto-merges, and only updates Jira when you press
          Post to Jira. A created PR does not imply passing CI.
        </p>
      </div>
      <section className="panel glossary">
        <h2>Words you will see</h2>
        <dl>
          {[
            ["Plan", "What the planner proposes to change, the acceptance criteria and the checks. Nothing is built until you approve it."],
            ["Acceptance criteria", "The things that must be true when the task is done. Criteria marked Proposed are extras the planner suggested; they are left out unless you tick them."],
            ["Checks", "Commands from the approved plan (for example lint or a test file) that Workstream runs after each development round."],
            ["Independent review", "A separate, read-only agent that never saw how the code was written reviews the diff against the plan."],
            ["Finding", "A problem the reviewer found in the code. Errors and warnings block publishing; info does not."],
            ["Acceptance gap", "Something the reviewer could not confirm. Evidence: the agent can collect it. Needs you: only you can provide it. Outside the code: depends on other people or systems, and you can accept it with a reason."],
            ["Repair round", "The developer fixing findings and failed checks. At most two automatically, then you decide."],
            ["Verification", "An agent run that collects missing evidence, like a screenshot of the page, without changing code."],
            ["Tests before publishing", "The project's unit and end-to-end tests, run on the task branch right before committing. A failure stops publishing."],
            ["Change request", "New instructions for a finished task, before or after its pull request. It is planned, built and reviewed like a small task on the same branch."],
            ["Worktree", "A separate folder with the task's branch, next to your repository, so tasks do not touch your own checkout or each other."],
            ["Skills", "Short instructions for the agents, from the repository or generated from its code in Agents & models."],
          ].map(([term, text]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}

function RunDetail({
  run,
  project,
  snapshot,
  send,
  pending,
  onBack,
  onOpenMemory,
  error,
}: {
  error?: string;
  run: Run;
  project: Project;
  snapshot: Snapshot;
  onOpenMemory: () => void;
  send: Send;
  pending: boolean;
  onBack: () => void;
}) {
  const [tab, setTab] = useState(
    run.stage === "approval" ? "Plan" : "Overview",
  );
  const [feedback, setFeedback] = useState("");
  const revision = activeRevision(run);
  const [publish, setPublish] = useState(Boolean(revision));
  // Criteria the planner proposed itself are left out unless you tick them.
  const [includedProposed, setIncludedProposed] = useState<string[]>([]);
  const proposed =
    run.plan?.acceptanceCriteria.filter(isProposedCriterion) ?? [];
  const approvedPlan = run.plan
    ? planWithCriteria(run.plan, includedProposed)
    : undefined;
  useEffect(() => {
    // A change request updates an existing PR, so pushing is the expected default.
    if (revision) setPublish(true);
  }, [revision?.number]);
  const [evidence, setEvidence] = useState("");
  const [azureAccess, setAzureAccess] = useState("");
  const [recoveryImages, setRecoveryImages] = useState<ImageInput[]>([]);
  const [imageBusy, setImageBusy] = useState(false);
  const running = run.status === "running";
  const review = run.reviews.at(-1);
  // A stopped run at Verify or Review gets one "What to do next" panel.
  const recovering =
    run.status === "blocked" &&
    Boolean(review) &&
    ["reviewing", "verifying"].includes(run.stage);
  const hasCodeProblems = codeProblems(run).length > 0;
  const action =
    run.stage === "intake" || (run.stage === "planning" && !running) ? (
      <Button
        disabled={pending}
        onClick={() => void send({ type: "plan", runId: run.id })}
      >
        <Sparkles size={16} />
        Create plan
      </Button>
    ) : run.stage === "ready" ? (
      <Button
        disabled={pending || running}
        onClick={() => void send({ type: "publish", runId: run.id })}
      >
        <GitPullRequest size={16} />
        Commit & create PR
      </Button>
    ) : run.status === "blocked" && run.approval && run.stage !== "complete" ? (
      <Button
        disabled={pending}
        onClick={() =>
          run.reviewContentChanged
            ? void send({ type: "continue", runId: run.id })
            : run.reviews.length &&
                ["reviewing", "verifying"].includes(run.stage)
              ? document
                  .getElementById("what-next")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              : void send({ type: "continue", runId: run.id })
        }
      >
        {run.reviewContentChanged
          ? "Re-check and review"
          : run.reviews.length && ["reviewing", "verifying"].includes(run.stage)
            ? "What to do next"
            : run.stage === "publishing"
              ? "Retry publication"
              : "Continue workflow"}{" "}
        <ArrowRight size={16} />
      </Button>
    ) : null;
  return (
    <>
      <button className="back-link" onClick={onBack}>
        <ArrowLeft size={15} />
        Back to runs
      </button>
      <div className="page-heading run-heading">
        <div>
          <div className="eyebrow">
            {run.ticketKey || "TASK"} <span> / </span> {project.name}
          </div>
          <h1>{run.title}</h1>
          <div className="run-meta">
            <Status run={run} />
            <span>
              <GitBranch size={14} />
              {run.branch}
            </span>
            <span>Created {date(run.createdAt)}</span>
          </div>
        </div>
        <div className="button-row">
          {running && run.stage !== "publishing" && (
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => void send({ type: "interrupt", runId: run.id })}
            >
              <Square size={12} />
              Stop
            </Button>
          )}
          {action}
          <PullRequestPill run={run} send={send} pending={pending} />
          {run.prUrl && (
            <Button
              onClick={() =>
                void send({ type: "openExternal", url: run.prUrl! })
              }
            >
              <BrandLogo
                brand={
                  project.provider === "github" ? "github" : "azure-devops"
                }
                size={15}
                onDark={project.provider === "github"}
              />
              Open pull request <ArrowUpRight size={16} />
            </Button>
          )}
        </div>
      </div>
      {(run.autoApprove ?? project.allowAgentCommands) &&
        run.status === "running" && (
          <div className="notice auto-approve">
            <ShieldCheck size={16} />
            <span>
              Allowing everything{" "}
              {run.autoApprove ? "for this run" : "in this project"}: agent
              commands are accepted without asking.
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void send({ type: "stopAutoApprove", runId: run.id })
              }
            >
              Ask me again
            </Button>
          </div>
        )}
      <ChangeRequestBanner run={run} send={send} pending={pending} />
      <StageTracker run={run} />
      <StageBanner run={run} />
      <StageToast run={run} />
      <TaskLocation run={run} project={project} send={send} />
      <PullRequestDone
        run={run}
        project={project}
        send={send}
        pending={pending}
      />
      {run.error && !recovering && (
        <div className="error-banner">
          <div>
            <strong>This run needs attention</strong>
            <p>
              {run.error.startsWith("Two repair rounds completed") &&
              review &&
              run.checks.length > 0 &&
              run.checks.every((check) => check.passed) &&
              !review.findings.some((finding) => finding.severity !== "info")
                ? "Code checks passed, but verification evidence is missing. Use Complete missing verification below. The development repair limit does not prevent gathering evidence."
                : run.reviewContentChanged
                  ? "Almost done. Your repository's commit hooks (formatting, lint fixes or translation extraction) changed files while Workstream was committing. The changed version needs the checks and a short review before it is published. Nothing was pushed."
                  : run.error}
            </p>
            {run.reviewContentChanged && (
              <div className="button-row">
                <Button
                  disabled={pending}
                  onClick={() => void send({ type: "continue", runId: run.id })}
                >
                  Re-check and review <ArrowRight size={15} />
                </Button>
              </div>
            )}
            {run.stage === "publishing" && (
              <button
                className="text-button"
                onClick={() => void send({ type: "continue", runId: run.id })}
              >
                Retry publication
              </button>
            )}
          </div>
        </div>
      )}
      {run.status === "blocked" &&
        review &&
        ["reviewing", "verifying"].includes(run.stage) && (
          <section
            className="panel detail-section recovery-panel"
            id="what-next"
          >
            <h2>What to do next</h2>
            <RecoveryGuide run={run} send={send} pending={pending} />
            {!run.reviewContentChanged && (
              <>
                {!hasCodeProblems && <OpenItems run={run} />}
                {!hasCodeProblems &&
                  unresolvedItems(run).some(
                    (item) => item.kind !== "external",
                  ) && (
                    <div className="recovery-actions">
                      <h3>Give the agent what it needs</h3>
                      <SavedImages images={run.images ?? []} />
                      <ImagePicker
                        images={recoveryImages}
                        onChange={setRecoveryImages}
                        onBusy={setImageBusy}
                      >
                        <Field label="Additional context (optional)">
                          <Textarea
                            id="recovery-evidence"
                            value={evidence}
                            onChange={(event) =>
                              setEvidence(event.target.value)
                            }
                            placeholder="Leave blank for the first attempt. If retrying: tell the agent what is now available, e.g. the test server is running, or where existing browser results are saved. Do not enter passwords or tokens."
                            rows={4}
                          />
                        </Field>
                      </ImagePicker>
                      <p>
                        Attach the original missing reference or verification
                        screenshot. Images supplement the approved task; scope
                        changes need a new plan.
                      </p>
                      <div className="button-row">
                        <Button
                          id="complete-verification"
                          disabled={pending || imageBusy}
                          onClick={async () => {
                            if (recoveryImages.length) {
                              if (
                                !(await send({
                                  type: "attachEvidence",
                                  runId: run.id,
                                  images: recoveryImages,
                                }))
                              )
                                return;
                              setRecoveryImages([]);
                            }
                            if (
                              await send({
                                type: "completeVerification",
                                runId: run.id,
                                evidence,
                              })
                            )
                              setEvidence("");
                          }}
                        >
                          Collect the missing evidence
                        </Button>
                      </div>
                      <p>
                        The agent can start this worktree’s local server, use
                        available browser tools, and create temporary fixtures
                        for missing test data. Live and fixture results are
                        labelled separately. Product code and tests stay
                        unchanged. If a required check still cannot be
                        completed, it will report the specific missing input.
                        Repeating the same attempt without new inputs is
                        blocked.
                      </p>
                      <details>
                        <summary>
                          I already fixed the issues or collected evidence
                        </summary>
                        <p>
                          Use the optional context above to point to your
                          results. This runs the approved checks and an
                          independent review directly, using model tokens.
                        </p>
                        <Button
                          variant="outline"
                          disabled={
                            pending || imageBusy || recoveryImages.length > 0
                          }
                          onClick={async () => {
                            if (
                              await send({
                                type: "continue",
                                runId: run.id,
                                evidence,
                              })
                            )
                              setEvidence("");
                          }}
                        >
                          Re-run verification and review
                        </Button>
                      </details>
                    </div>
                  )}
                {!hasCodeProblems && (
                  <AcceptGaps run={run} send={send} pending={pending} compact />
                )}
                <details className="review-details">
                  <summary>Review and verification details</summary>
                  {run.verification && (
                    <div>
                      <h3>Latest verification results</h3>
                      <p>{run.verification.summary}</p>
                      {!!run.verification.limitations?.length && (
                        <div>
                          <h3>Verification limitations</h3>
                          <ul>
                            {run.verification.limitations.map((item, index) => (
                              <li key={index}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <ul>
                        {run.verification.evidence.map((item, index) => (
                          <li key={index}>
                            <strong>
                              {item.result === "passed"
                                ? "Passed"
                                : item.result === "failed"
                                  ? "Failed"
                                  : "Could not verify"}
                              : {item.check}
                            </strong>{" "}
                            {item.method && (
                              <span>
                                (
                                {
                                  {
                                    live_browser: "Live browser",
                                    fixture_browser:
                                      "Browser with local fixtures",
                                    automated_test: "Automated test",
                                    inspection: "Inspection",
                                  }[item.method]
                                }
                                ){" "}
                              </span>
                            )}
                            — {item.details}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <h3>Last independent review</h3>
                  <p>{review.summary}</p>
                  <p>
                    {run.repairCount}/2 automatic code repairs used. Collecting
                    evidence does not restart development or reset this limit.
                  </p>
                  <p className="path-label">Worktree: {run.worktree}</p>
                </details>
              </>
            )}
          </section>
        )}
      {running && (
        <RunActivity
          run={run}
          waitingForYou={
            snapshot.pendingApprovals.filter((item) => item.runId === run.id)
              .length
          }
        />
      )}
      <RunUsage
        run={run}
        prices={snapshot.settings.prices}
        defaults={{
          codex: snapshot.runtime.models.find((m) => m.isDefault)?.id,
          claude: snapshot.claude.models.find((m) => m.isDefault)?.id,
          copilot: snapshot.copilot.models.find((m) => m.isDefault)?.id,
        }}
      />
      {changeRequestAllowed(run) && (
        <RequestChanges
          run={run}
          project={project}
          send={send}
          pending={pending}
        />
      )}
      {run.prUrl &&
        run.worktree &&
        run.stage === "complete" &&
        !running &&
        run.prStatus?.state !== "completed" &&
        run.prStatus?.state !== "abandoned" && (
          <TryLocally
            run={run}
            project={project}
            pending={pending}
            send={send}
            error={error}
          />
        )}
      {run.costLimitHit && run.status !== "running" && (
        <section className="panel detail-section cost-limit">
          <h2>Cost limit reached</h2>
          <p>
            This task stopped at your cost limit of ${(snapshot.settings.costLimitUsd ?? 0).toFixed(2)} per task. Everything
            the agents did is kept. Allow another ${(snapshot.settings.costLimitUsd ?? 0).toFixed(2)} and continue, or leave it
            here.
          </p>
          <div className="button-row">
            <Button
              disabled={pending}
              onClick={async () => {
                if (await send({ type: "raiseCostLimit", runId: run.id })) await send({ type: "continue", runId: run.id });
              }}
            >
              Allow ${(snapshot.settings.costLimitUsd ?? 0).toFixed(2)} more and continue
            </Button>
          </div>
        </section>
      )}
      {run.testGate && <TestGatePanel run={run} send={send} pending={pending} />}
      {run.prUrl && run.stage === "complete" && !running && (
        <TaskE2e run={run} project={project} send={send} pending={pending} />
      )}
      {run.prUrl &&
        !revision &&
        run.ticketKey &&
        snapshot.connectorList.some(
          (c) => c.id === "atlassian" && (c.connected || c.signedIn),
        ) && (
          <JiraUpdate
            run={run}
            snapshot={snapshot}
            pending={pending}
            send={send}
          />
        )}
      {run.worktree &&
        !running &&
        !run.prUrl &&
        ["ready", "publishing"].includes(run.stage) && (
          <section className="panel detail-section">
            <h2>Publication readiness</h2>
            <p>
              Test files are never part of the pull request. They stay in the
              worktree for verification
              {run.localOnlyFiles?.length
                ? ` (${run.localOnlyFiles.length} here)`
                : ""}
              .
            </p>
            <div className="button-row">
              {project.provider !== "other" && (
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={async () => {
                    setAzureAccess("");
                    const next = await send({
                      type: "checkPublicationAccess",
                      runId: run.id,
                    });
                    const access = next?.projects.find(
                      (p) => p.id === project.id,
                    )?.access;
                    if (access) setAzureAccess(access.summary);
                  }}
                >
                  Check publication access
                </Button>
              )}
              {project.provider !== "other" && (
                <Button
                  variant="outline"
                  disabled={pending || running}
                  onClick={async () => {
                    setAzureAccess(
                      project.provider === "azure"
                        ? "Azure sign-in is opening. Pick the work account that belongs to the organization in the browser window…"
                        : "GitHub sign-in is opening. Enter the code shown under Connections on github.com…",
                    );
                    const next = await send(
                      project.provider === "azure"
                        ? { type: "loginAzure", runId: run.id }
                        : {
                            type: "signIn",
                            provider: "github",
                            projectId: project.id,
                          },
                    );
                    const access = next?.projects.find(
                      (p) => p.id === project.id,
                    )?.access;
                    setAzureAccess(access?.summary ?? "");
                  }}
                >
                  {project.access?.account ? "Switch account" : "Sign in"}
                </Button>
              )}
            </div>
            {azureAccess && <p role="status">{azureAccess}</p>}
            {project.provider === "other" ? (
              <p className="inline-error">
                This project has no publishing provider. Choose Azure DevOps or
                GitHub in Connections.
              </p>
            ) : (
              <>
                <div className="connection-row">
                  <ProviderMark provider={project.provider} size="sm" />
                  <span>
                    {project.access?.account
                      ? `Publishes as ${project.access.account}`
                      : "Account not checked yet"}
                  </span>
                </div>
                <AccessChips access={project.access} />
                <p className="muted-note">
                  401 means sign in (or the wrong tenant). 403 means the account
                  is known but lacks permission: switch account or ask an
                  administrator for Contribute and Contribute to pull requests.
                  Push uses the same signed-in account as the pull request.
                </p>
              </>
            )}
            <p>
              Access checks do not run an agent or consume model tokens.
              Publishing retries do not repeat verification unless the reviewed
              files have changed.
            </p>
          </section>
        )}
      {run.stage === "approval" && run.plan && (
        <section className="plan-approval">
          <span className="approval-icon">
            <ShieldCheck size={25} />
          </span>
          <div>
            <h2>
              {revision
                ? `Change plan ${revision.number} is ready`
                : "Your plan is ready"}
            </h2>
            <p>
              {revision
                ? "Review the planned changes and checks below. Approval lets the developer update the existing branch; the pull request gets a new commit only after checks and review pass."
                : "Review the plan and verification commands below. Approval starts development in a new worktree."}
            </p>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={publish}
                onChange={(e) => setPublish(e.target.checked)}
              />
              {revision
                ? "Push the new commit to the existing pull request after review passes"
                : "Include committing, pushing, and creating the PR after review passes"}
            </label>
            {proposed.length > 0 && (
              <div className="proposed-criteria">
                <strong>Extra criteria the planner added</strong>
                <p>
                  These were not asked for in the task. Each one becomes
                  something the developer must build and the reviewer must
                  check, so they are left out unless you tick them.
                </p>
                {proposed.map((criterion) => (
                  <label key={criterion} className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={includedProposed.includes(criterion)}
                      onChange={(e) =>
                        setIncludedProposed((current) =>
                          e.target.checked
                            ? [...current, criterion]
                            : current.filter((c) => c !== criterion),
                        )
                      }
                    />
                    {criterion.replace(/^\s*proposed\s*:?\s*/i, "")}
                  </label>
                ))}
              </div>
            )}
          </div>
          <Button
            disabled={
              pending || running || !approvedPlan?.acceptanceCriteria.length
            }
            title={
              approvedPlan?.acceptanceCriteria.length
                ? undefined
                : "Include at least one criterion"
            }
            onClick={() =>
              void send({
                type: "approve",
                runId: run.id,
                plan: approvedPlan!,
                publish,
              })
            }
          >
            Approve & develop <ArrowRight size={15} />
          </Button>
        </section>
      )}
      <div className="detail-tabs" role="tablist" aria-label="Run details">
        {["Overview", "Plan", "Changes", "Checks", "Review", "Activity"].map(
          (item) => (
            <button
              role="tab"
              aria-selected={tab === item}
              id={`tab-${item}`}
              aria-controls="run-panel"
              className={cn(tab === item && "selected")}
              key={item}
              onClick={() => setTab(item)}
            >
              {item}
              {item === "Changes" && run.files.some((f) => !isTestFile(f)) && (
                <span>{run.files.filter((f) => !isTestFile(f)).length}</span>
              )}
              {item === "Checks" && run.checks.length > 0 && (
                <span>{run.checks.length}</span>
              )}
            </button>
          ),
        )}
      </div>
      <div
        id="run-panel"
        role="tabpanel"
        aria-labelledby={`tab-${tab}`}
        className="detail-panel"
      >
        {tab === "Overview" && run.sessions.length > 0 && (
          <SessionInstructions run={run} snapshot={snapshot} />
        )}
        {tab === "Overview" && (
          <div className="detail-columns">
            <section className="panel detail-section">
              <h2>Task brief</h2>
              <SavedImages images={run.images ?? []} />
              <div className="prose">
                <ReactMarkdown>{run.description}</ReactMarkdown>
              </div>
              {run.plan && (
                <>
                  <h2>Acceptance criteria</h2>
                  <ul className="criteria">
                    {run.plan.acceptanceCriteria.map((criterion, i) => (
                      <li key={i}>
                        <Circle size={14} />
                        {criterion}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {run.development && (
                <>
                  <h2>Implementation</h2>
                  <p>{run.development.summary}</p>
                  {run.development.limitations.length > 0 && (
                    <div className="notice">
                      <span>
                        Limitations: {run.development.limitations.join("; ")}
                      </span>
                    </div>
                  )}
                </>
              )}
              <RunMemory run={run} onOpen={onOpenMemory} />
            </section>
            <aside className="panel context-panel">
              <h2>Run context</h2>
              <dl>
                <dt>Repository</dt>
                <dd>{project.name}</dd>
                {!!project.stack?.length && (
                  <>
                    <dt>Stack</dt>
                    <dd>
                      <TechStack ids={project.stack} limit={8} size={13} />
                    </dd>
                  </>
                )}
                <dt>Target branch</dt>
                <dd>
                  <TechIcon id="git" size={12} />
                  {run.targetBranch}
                </dd>
                <dt>Worktree</dt>
                <dd>{run.worktree ?? "Created after approval"}</dd>
                <dt>Base commit</dt>
                <dd>
                  {run.baseCommit?.slice(0, 12) ?? "Fetched after approval"}
                </dd>
                <dt>Repair rounds</dt>
                <dd>{run.repairCount} / 2</dd>
                <dt>Publication</dt>
                <dd>
                  {run.approval?.publish
                    ? "Included in approval"
                    : "Separate action"}
                </dd>
              </dl>
              <h3>Agent profiles</h3>
              {(["planner", "developer", "reviewer"] as Role[]).map((role) => (
                <div className="profile-line" key={role}>
                  <span>{roleNames[role]}</span>
                  <strong>
                    {run.profiles[role].model || "Runtime default"}
                  </strong>
                </div>
              ))}
            </aside>
          </div>
        )}
        {tab === "Plan" &&
          (run.plan ? (
            <section className="panel detail-section">
              <div className="section-title">
                <div>
                  <h2>
                    {revision
                      ? `Change plan ${revision.number}`
                      : "Implementation plan"}
                  </h2>
                </div>
                <Badge variant="secondary">
                  {run.approval ? "Approved" : "Awaiting approval"}
                </Badge>
              </div>
              {run.revisions?.length ? (
                <RevisionPlan run={run} />
              ) : (
                <>
                  <p className="plan-summary">{run.plan.summary}</p>
                  <div className="prose">
                    <ReactMarkdown>{run.plan.markdown}</ReactMarkdown>
                  </div>
                  <h3>Verification commands</h3>
                  {run.plan.checks.map((check, i) => (
                    <div className="planned-check" key={i}>
                      <CheckCheck size={16} />
                      <div>
                        <strong>{check.name}</strong>
                        <code>
                          {check.executable} {check.args.join(" ")}
                        </code>
                      </div>
                    </div>
                  ))}
                  {run.plan.risks.length > 0 && (
                    <>
                      <h3>Risks & open questions</h3>
                      <ul>
                        {run.plan.risks.map((risk, i) => (
                          <li key={i}>{risk}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </>
              )}
              {run.stage === "approval" && (
                <form
                  className="feedback-form"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    await send({ type: "plan", runId: run.id, feedback });
                  }}
                >
                  <Field label="Want to change the plan?">
                    <Textarea
                      value={feedback}
                      onChange={(e) => setFeedback(e.target.value)}
                      placeholder="Tell the planner what to adjust…"
                      rows={3}
                    />
                  </Field>
                  <Button
                    variant="outline"
                    disabled={pending || running || !feedback.trim()}
                  >
                    Revise plan
                  </Button>
                </form>
              )}
            </section>
          ) : (
            <section className="panel">
              <Empty
                icon={<BookOpen size={28} />}
                title="A clear plan comes first"
                action={action}
              >
                Start the planner to investigate the repository and turn this
                task into implementation steps.
              </Empty>
            </section>
          ))}
        {tab === "Changes" && (
          <section className="panel detail-section">
            <h2>Changes in the ticket worktree</h2>
            {run.files.length ? (
              <DiffReview
                diff={run.diff ?? ""}
                localOnly={run.localOnlyFiles ?? []}
                comments={run.comments ?? []}
                pending={pending}
                onAdd={(comment) =>
                  send({ type: "addComment", runId: run.id, ...comment })
                }
                onUpdate={(id, patch) =>
                  send({ type: "updateComment", runId: run.id, id, ...patch })
                }
                onDelete={(id) =>
                  send({ type: "deleteComment", runId: run.id, id })
                }
                onSend={() => send({ type: "sendComments", runId: run.id })}
                canSend={
                  !running &&
                  Boolean(run.approval) &&
                  [
                    "ready",
                    "verifying",
                    "reviewing",
                    "developing",
                    "complete",
                  ].includes(run.stage)
                }
                sendLabel={
                  run.stage === "complete" && run.prUrl
                    ? "Send as a change request"
                    : "Send to the developer"
                }
              />
            ) : (
              <p className="muted-note">
                The diff is captured during verification. No verified change
                snapshot is available yet.
              </p>
            )}
          </section>
        )}
        {tab === "Checks" && (
          <section className="panel detail-section">
            <h2>Verification evidence</h2>
            {run.checks.length ? (
              run.checks.map((check, i) => (
                <details className="check-result" key={i}>
                  <summary>
                    {check.passed ? (
                      <CircleCheck size={18} className="green" />
                    ) : (
                      <X size={18} className="red" />
                    )}
                    <strong>{check.name}</strong>
                    <Badge variant="outline">
                      {check.passed
                        ? "Passed"
                        : `Failed · exit ${check.exitCode}`}
                    </Badge>
                  </summary>
                  <code>
                    {check.executable} {check.args.join(" ")}
                  </code>
                  <pre>{check.output || "No output."}</pre>
                </details>
              ))
            ) : (
              <p className="muted-note">
                Approved checks will run after development. No checks have been
                marked as passed.
              </p>
            )}
          </section>
        )}
        {tab === "Review" && (
          <section className="panel detail-section">
            <h2>Independent review</h2>
            {review ? (
              <>
                <Badge
                  variant={review.verdict === "pass" ? "secondary" : "outline"}
                >
                  {review.verdict === "pass"
                    ? "Approved by reviewer"
                    : "Changes requested"}
                </Badge>
                <p>{review.summary}</p>
                {review.findings.map((finding, i) => (
                  <div className="finding" key={i}>
                    <Badge variant="outline">{finding.severity}</Badge>
                    <code>
                      {finding.file}:{finding.line}
                    </code>
                    <p>{finding.scenario}</p>
                    <div className="prose">
                      <ReactMarkdown>{finding.recommendation}</ReactMarkdown>
                    </div>
                  </div>
                ))}
                {review.acceptanceGaps.length > 0 && (
                  <>
                    <h3>Acceptance gaps</h3>
                    <ul>
                      {review.acceptanceGaps.map((gap, i) => (
                        <li key={i}>{gap}</li>
                      ))}
                    </ul>
                  </>
                )}
                <p className="muted-note">
                  {run.reviews.length} review pass(es) recorded. Reviewer
                  sessions are separate from developer sessions.
                </p>
              </>
            ) : (
              <p className="muted-note">
                A separate reviewer will inspect the full diff and check results
                after implementation.
              </p>
            )}
          </section>
        )}
        {tab === "Activity" && (
          <section className="panel detail-section">
            <h2>Run activity</h2>
            {run.activity.length ? (
              <StageTimeline run={run} />
            ) : (
              <p className="muted-note">
                Task created. Start planning when you’re ready.
              </p>
            )}
          </section>
        )}
      </div>
    </>
  );
}
