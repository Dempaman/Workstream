import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FolderGit2,
  HardDrive,
  LoaderCircle,
  RotateCcw,
  Sparkles,
  Square,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { effectiveSetup } from "../../shared/agents";
import { formatUsd, sessionCost } from "../../shared/pricing";
import {
  engineNames,
  skillKindRoles,
  type Command,
  type GeneratedSkill,
  type Project,
  type Role,
  type SkillKind,
  type Snapshot,
} from "../../shared/types";

type Send = (command: Command) => Promise<Snapshot | null>;
type Editable = GeneratedSkill & { include: boolean; roles: Role[] };

const kindLabel: Record<SkillKind, string> = {
  develop: "Developer",
  testing: "Testing",
  review: "Reviewer",
};
const kindHint: Record<SkillKind, string> = {
  develop: "Where code goes, which patterns and helpers to reuse, what not to touch.",
  testing: "The project's test tools, commands and the shape of its tests.",
  review: "The mistakes most likely in this codebase, ordered by impact.",
};
const roleLabel: Record<Role, string> = { planner: "Planner", developer: "Developer", reviewer: "Reviewer" };

function useElapsed(since?: string, running = false) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  if (!since) return "";
  const seconds = Math.max(0, Math.round((now - Date.parse(since)) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** "Generate project skills": drafts develop, testing and review skills from the repository. */
export function SkillGenerator({
  project,
  snapshot,
  send,
  pending,
}: {
  project: Project;
  snapshot: Snapshot;
  send: Send;
  pending: boolean;
}) {
  const draft = project.skillDraft;
  const planner = snapshot.settings.profiles.planner;
  const engine = draft?.engine ?? planner.engine ?? "codex";
  const elapsed = useElapsed(draft?.startedAt, draft?.status === "working");
  const [edits, setEdits] = useState<Editable[]>([]);
  const [location, setLocation] = useState<"repository" | "workstream">("repository");
  const draftKey = draft?.status === "ready" ? `${project.id}:${draft.finishedAt}` : "";
  // Reset the editor only when a new draft arrives.
  const [loadedKey, setLoadedKey] = useState("");
  if (draftKey !== loadedKey) {
    setLoadedKey(draftKey);
    setEdits(
      draft?.status === "ready"
        ? draft.skills.map((skill) => ({ ...skill, include: true, roles: skillKindRoles[skill.kind] }))
        : [],
    );
  }

  const skills = project.skillInfo ?? [];
  const generated = skills.filter((s) => s.generated);
  const setup = effectiveSetup(project);
  const missing = (["planner", "developer", "reviewer"] as Role[]).filter(
    (role) => !setup[role].skills.some((path) => skills.some((s) => s.path === path && !s.workflow)),
  );
  const cost = draft?.usage
    ? sessionCost(
        { role: "planner", threadId: draft.threadId ?? "", engine: draft.engine, model: draft.model, usage: draft.usage },
        snapshot.settings.prices ?? {},
      )
    : undefined;
  const pathFor = (name: string) => (location === "workstream" ? `workstream/${name}` : `.agents/skills/${name}`);
  const clash = (name: string) => skills.find((s) => s.path === pathFor(name));
  const chosen = edits.filter((e) => e.include);
  const blocked = chosen.some((e) => {
    const existing = clash(e.name);
    return (existing && !existing.generated) || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(e.name) || e.description.trim().length < 10 || e.body.trim().length < 50;
  });
  const update = (i: number, patch: Partial<Editable>) =>
    setEdits((list) => list.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  const start = () => void send({ type: "generateSkills", projectId: project.id });

  return (
    <section className="panel skill-generator">
      <div className="skill-generator-head">
        <div>
          <h2>
            <Sparkles size={16} /> Project skills
          </h2>
          <p>
            Workstream lets an agent read {project.name} and write a developer, a testing and a
            reviewer skill from its own code: where things go, which patterns to reuse, how it is
            tested and what to check in review. You read and edit them before anything is saved.
          </p>
        </div>
        {(!draft || draft.status === "failed") && (
          <div className="skill-generator-start">
            <Button disabled={pending} onClick={start}>
              <Sparkles size={14} /> {generated.length ? "Regenerate skills" : "Generate skills"}
            </Button>
            <small>
              Uses the planner's engine: {engineNames[engine]}
              {planner.model ? ` · ${planner.model}` : ""}. Read-only, usually a few minutes.
            </small>
          </div>
        )}
      </div>

      {!draft && (
        <div className="skill-generator-status">
          {generated.length ? (
            <p>
              <CheckCircle2 size={14} className="ok" /> Generated skills in use:{" "}
              {generated.map((s) => (
                <span key={s.path} className="skill-chip" title={s.path}>
                  {s.name}
                </span>
              ))}
            </p>
          ) : missing.length ? (
            <p>
              <AlertTriangle size={14} className="warn" /> No skill yet for:{" "}
              {missing.map((role) => roleLabel[role]).join(", ")}. Generating fills these gaps.
            </p>
          ) : (
            <p className="muted-note">
              Every role already has a skill. Generated skills are added next to them, never instead.
            </p>
          )}
        </div>
      )}

      {draft?.status === "working" && (
        <div className="repo-progress" role="status" aria-live="polite">
          <div className="repo-progress-bar indeterminate" aria-hidden>
            <span />
          </div>
          <ol>
            <li className={draft.threadId ? "done" : "current"}>
              {draft.threadId ? <CheckCircle2 size={14} /> : <LoaderCircle size={14} className="spin" />}{" "}
              Start {engineNames[draft.engine]}
              {draft.model ? ` · ${draft.model}` : ""}
            </li>
            {draft.threadId && (
              <li className="current">
                <LoaderCircle size={14} className="spin" /> Reading the repository and writing the skills
              </li>
            )}
          </ol>
          {draft.activity.length > 0 && (
            <ul className="skill-activity">
              {draft.activity.map((line, i) => (
                <li key={`${i}-${line}`}>{line}</li>
              ))}
            </ul>
          )}
          <div className="skill-generator-meta">
            <span>{elapsed}</span>
            {cost && cost.source !== "none" && <span>{formatUsd(cost.usd)} so far</span>}
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => void send({ type: "cancelSkillGeneration", projectId: project.id })}
            >
              <Square size={12} /> Stop
            </Button>
          </div>
        </div>
      )}

      {draft?.status === "failed" && (
        <div className="skill-generator-error">
          <AlertTriangle size={15} />
          <span>{draft.error ?? "Generating the skills failed."}</span>
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => void send({ type: "discardSkillDraft", projectId: project.id })}
          >
            Dismiss
          </Button>
        </div>
      )}

      {draft?.status === "ready" && (
        <div className="skill-draft">
          <div className="skill-draft-summary">
            <CheckCircle2 size={15} className="ok" />
            <div>
              <strong>Drafts ready. Read them, change what is wrong, then save.</strong>
              {draft.summary && <p>{draft.summary}</p>}
              <small>
                {engineNames[draft.engine]}
                {draft.model ? ` · ${draft.model}` : ""}
                {cost && cost.source !== "none" ? ` · ${formatUsd(cost.usd)}` : ""}
                {draft.filesRead?.length ? ` · ${draft.filesRead.length} files read` : ""}
              </small>
              {!!draft.filesRead?.length && (
                <details>
                  <summary>Files it read</summary>
                  <ul className="skill-files">
                    {draft.filesRead.map((file) => (
                      <li key={file}>{file}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          </div>

          {edits.map((e, i) => {
            const existing = clash(e.name);
            return (
              <article key={e.kind} className={cn("skill-card", `kind-${e.kind}`, !e.include && "off")}>
                <header>
                  <label className="skill-include">
                    <input type="checkbox" checked={e.include} onChange={(ev) => update(i, { include: ev.target.checked })} />
                    <span className="skill-kind">{kindLabel[e.kind]}</span>
                  </label>
                  <small>{kindHint[e.kind]}</small>
                </header>
                {e.include && (
                  <>
                    <div className="skill-fields">
                      <label>
                        Name
                        <input
                          value={e.name}
                          maxLength={64}
                          onChange={(ev) => update(i, { name: ev.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })}
                        />
                      </label>
                      <div className="skill-roles">
                        Given to
                        <div>
                          {(["planner", "developer", "reviewer"] as Role[]).map((role) => (
                            <button
                              key={role}
                              type="button"
                              className={cn("role-toggle", e.roles.includes(role) && "on")}
                              aria-pressed={e.roles.includes(role)}
                              onClick={() =>
                                update(i, {
                                  roles: e.roles.includes(role) ? e.roles.filter((r) => r !== role) : [...e.roles, role],
                                })
                              }
                            >
                              {roleLabel[role]}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    {existing && (
                      <p className={cn("skill-clash", !existing.generated && "bad")}>
                        <AlertTriangle size={13} />
                        {existing.generated
                          ? `Replaces the earlier generated ${existing.path}.`
                          : `${existing.path} already exists and was written by hand. Pick another name.`}
                      </p>
                    )}
                    <label className="skill-text">
                      When to use it
                      <textarea rows={2} maxLength={600} value={e.description} onChange={(ev) => update(i, { description: ev.target.value })} />
                    </label>
                    <label className="skill-text">
                      Instructions
                      <textarea
                        rows={14}
                        maxLength={40000}
                        spellCheck={false}
                        value={e.body}
                        onChange={(ev) => update(i, { body: ev.target.value })}
                      />
                      <small>{e.body.split("\n").length} lines</small>
                    </label>
                  </>
                )}
              </article>
            );
          })}

          <fieldset className="skill-location">
            <legend>Save to</legend>
            <label className={cn(location === "repository" && "on")}>
              <input type="radio" name="skill-location" checked={location === "repository"} onChange={() => setLocation("repository")} />
              <FolderGit2 size={16} />
              <span>
                <strong>The repository</strong>
                <small>
                  .agents/skills in {project.name}. Codex, Claude and Copilot read it, and you can commit it to share
                  with your team. It stays an uncommitted change until you do.
                </small>
              </span>
            </label>
            <label className={cn(location === "workstream" && "on")}>
              <input type="radio" name="skill-location" checked={location === "workstream"} onChange={() => setLocation("workstream")} />
              <HardDrive size={16} />
              <span>
                <strong>Only in Workstream</strong>
                <small>Nothing is added to the repository. Only agents started from Workstream get the skills.</small>
              </span>
            </label>
          </fieldset>

          <div className="skill-draft-actions">
            <Button
              disabled={pending || !chosen.length || blocked}
              onClick={() =>
                void send({
                  type: "saveGeneratedSkills",
                  projectId: project.id,
                  location,
                  skills: chosen.map(({ kind, name, description, body, roles }) => ({ kind, name, description, body, roles })),
                })
              }
            >
              <CheckCircle2 size={14} /> Save {chosen.length} {chosen.length === 1 ? "skill" : "skills"}
            </Button>
            <Button variant="outline" disabled={pending} onClick={start}>
              <RotateCcw size={14} /> Generate again
            </Button>
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => void send({ type: "discardSkillDraft", projectId: project.id })}
            >
              <Trash2 size={14} /> Discard
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
