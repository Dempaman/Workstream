import type { AgentSetup, Project, SkillInfo } from "./types";

/**
 * Suggests which repository skills each Workstream role should follow, from
 * their names. Workflow/orchestration skills are never suggested: Workstream
 * itself runs the plan, develop, review and publish flow they describe.
 */
export function suggestSetup(skills: SkillInfo[]): AgentSetup {
  const pick = (pattern: RegExp) =>
    skills.filter((s) => !s.workflow && pattern.test(`${s.name} ${s.path}`)).map((s) => s.path);
  return {
    planner: { skills: pick(/plan/i), notes: "" },
    developer: { skills: pick(/develop|implement|coder|engineer|builder/i), notes: "" },
    reviewer: { skills: pick(/review/i), notes: "" },
  };
}
export const effectiveSetup = (project: Project): AgentSetup =>
  project.agentSetup ?? suggestSetup(project.skillInfo ?? []);
