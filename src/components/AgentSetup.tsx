import { ExternalLink, FileText, Lock, RefreshCw, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { effectiveSetup } from "../../shared/agents";
import {
  engineNames,
  type AgentSetup,
  type Command,
  type Project,
  type Role,
  type Run,
  type Snapshot,
} from "../../shared/types";

type Send = (command: Command) => Promise<Snapshot | null>;

/** Project picker and status shown above the three agent cards. */
export function AgentSetupHeader({
  projects,
  project,
  saved,
  onProject,
  send,
  pending,
}: {
  projects: Project[];
  project?: Project;
  saved: boolean;
  onProject: (id: string) => void;
  send: Send;
  pending: boolean;
}) {
  if (!project) return null;
  const skills = project.skillInfo ?? [];
  return (
    <section className="panel agent-setup-head">
      <div>
        <h2>What the agents follow</h2>
        <p>
          Each agent gets Workstream's fixed rules first, then your notes, then
          the repository skills you tick. Both Codex and Claude also read the
          repository's AGENTS.md on their own
          {project.instructions ? " (found in this project)" : ""}.
        </p>
      </div>
      <div className="agent-setup-controls">
        <label>
          Project
          <select value={project.id} onChange={(e) => onProject(e.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <span className={cn("setup-state", saved ? "saved" : "suggested")}>
          {saved ? "Saved setup" : "Suggested from skill names"}
        </span>
        <span className="muted-note">{skills.length} repository skills</span>
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => void send({ type: "refreshSkills", projectId: project.id })}
        >
          <RefreshCw size={13} /> Re-read skills
        </Button>
      </div>
    </section>
  );
}

/** The instruction layers for one role, inside its agent card. */
export function RoleInstructions({
  role,
  rules,
  project,
  setup,
  onChange,
  send,
}: {
  role: Role;
  rules: string;
  project?: Project;
  setup?: AgentSetup;
  onChange: (next: AgentSetup) => void;
  send: Send;
}) {
  const skills = project?.skillInfo ?? [];
  const mine = setup?.[role];
  const update = (patch: Partial<AgentSetup[Role]>) =>
    setup && onChange({ ...setup, [role]: { ...setup[role], ...patch } });
  return (
    <div className="role-instructions">
      <details className="layer locked">
        <summary>
          <Lock size={13} /> 1. Workstream rules <small>always on</small>
        </summary>
        <pre>{rules}</pre>
      </details>
      {project && mine && (
        <>
          <div className="layer">
            <div className="layer-title">
              <StickyNote size={13} /> 2. Your notes for {project.name}
            </div>
            <textarea
              rows={3}
              maxLength={8000}
              value={mine.notes}
              placeholder={
                role === "planner"
                  ? "For example: always list translation keys in the plan"
                  : role === "developer"
                    ? "For example: add Storybook stories for new blocks"
                    : "For example: be strict about accessibility"
              }
              onChange={(e) => update({ notes: e.target.value })}
            />
          </div>
          <div className="layer">
            <div className="layer-title">
              <FileText size={13} /> 3. Repository skills
            </div>
            {skills.length ? (
              <ul className="skill-list">
                {skills.map((skill) => (
                  <li key={skill.path} className={cn(skill.workflow && "workflow")}>
                    <label>
                      <input
                        type="checkbox"
                        disabled={skill.workflow}
                        checked={mine.skills.includes(skill.path)}
                        onChange={(e) =>
                          update({
                            skills: e.target.checked
                              ? [...mine.skills, skill.path]
                              : mine.skills.filter((p) => p !== skill.path),
                          })
                        }
                      />
                      <span>
                        <strong>{skill.name}</strong>
                        <small>
                          {skill.workflow
                            ? "Workflow skill: Workstream runs this flow itself, so it is not given to a single agent."
                            : skill.description}
                        </small>
                      </span>
                    </label>
                    <button
                      type="button"
                      className="icon-link"
                      aria-label={`Open ${skill.name} in your editor`}
                      title="Open SKILL.md"
                      onClick={() =>
                        void send({ type: "openSkill", projectId: project.id, path: skill.path })
                      }
                    >
                      <ExternalLink size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted-note">
                No skills found in .agents/skills, .codex/skills or .claude/skills.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export const initialSetup = (project?: Project) =>
  project ? effectiveSetup(project) : undefined;

/** Per run: exactly what each agent session was told. */
export function SessionInstructions({ run, snapshot }: { run: Run; snapshot: Snapshot }) {
  const sessions = run.sessions.filter((s) => s.instructions);
  const project = snapshot.projects.find((p) => p.id === run.projectId);
  const name = (path: string) =>
    project?.skillInfo?.find((s) => s.path === path)?.name ?? path.split("/").pop();
  return (
    <section className="panel detail-section session-instructions">
      <h2>What each agent was told</h2>
      {sessions.length ? (
        <ul>
          {sessions.map((s, i) => (
            <li key={s.threadId}>
              <div className="session-head">
                <strong>
                  {i + 1}. {s.role[0].toUpperCase() + s.role.slice(1)}
                </strong>
                <span>
                  {engineNames[s.engine ?? "codex"]}
                  {s.model ? ` · ${s.model}` : ""}
                </span>
                {s.instructions!.skills.map((skill) => (
                  <span key={skill.path} className="skill-chip" title={`${skill.path} (version ${skill.hash})`}>
                    {name(skill.path)}
                  </span>
                ))}
                {s.instructions!.notes && <span className="skill-chip notes">Your notes</span>}
                {!s.instructions!.skills.length && !s.instructions!.notes && (
                  <span className="muted-note">Workstream rules and AGENTS.md only</span>
                )}
              </div>
              <details>
                <summary>Show full instructions</summary>
                <pre>{s.instructions!.text}</pre>
              </details>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted-note">
          Recorded for agent sessions started from version 0.2.14 on.
        </p>
      )}
    </section>
  );
}
