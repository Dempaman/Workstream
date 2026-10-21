import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Project, Role, SkillInfo } from "../shared/types";
import { hash, scopedPath } from "./guards";
import { effectiveSetup, suggestSetup } from "../shared/agents";

export { effectiveSetup, suggestSetup };

export const roles: Role[] = ["planner", "developer", "reviewer"];
const skillFolders = [".agents/skills", ".codex/skills", ".claude/skills"];

function frontmatter(text: string) {
  const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
  const fields: Record<string, string> = {};
  for (const line of match?.[1].split(/\r?\n/) ?? []) {
    const field = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (field) fields[field[1].toLowerCase()] = field[2].replace(/^["']|["']$/g, "").trim();
  }
  return { fields, body: match ? text.slice(match[0].length) : text };
}

/** Lists the repository's own agent skills with their names and descriptions. */
export async function readSkills(repo: string): Promise<SkillInfo[]> {
  const skills: SkillInfo[] = [];
  for (const folder of skillFolders) {
    for (const entry of await readdir(join(repo, folder), { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory()) continue;
      const path = `${folder}/${entry.name}`;
      const text = await readFile(join(repo, path, "SKILL.md"), "utf8").catch(() => "");
      if (!text) continue;
      const { fields } = frontmatter(text);
      skills.push({
        path,
        name: fields.name || entry.name,
        description: (fields.description ?? "").slice(0, 600),
        workflow: /orchestrat|workflow|pipeline/i.test(`${entry.name} ${fields.name ?? ""}`),
      });
    }
  }
  return skills;
}

/**
 * Builds the role's extra instructions: your notes and the chosen repository
 * skills, read fresh from the repository at the start of each session.
 * Workstream's own rules always come first and win any conflict.
 */
export async function roleAddendum(project: Project, role: Role) {
  const setup = effectiveSetup(project)[role];
  const parts: string[] = [];
  const sources: { path: string; hash: string }[] = [];
  parts.push(
    "ORDER OF AUTHORITY: 1) the Workstream rules above (safety, read-only stages, no commits/pushes/PRs, structured output), 2) the approved plan, 3) the user's notes, 4) repository skills. When a repository skill describes its own workflow steps (asking for plan approval, creating branches or worktrees, committing, pushing, opening PRs, spawning subagents, updating Jira), skip those steps: Workstream performs them. Apply the skill's technical guidance, checklists and conventions.",
  );
  if (setup.notes.trim())
    parts.push(`USER NOTES FOR THE ${role.toUpperCase()} (from Workstream settings for this project)\n${setup.notes.trim()}`);
  for (const path of setup.skills) {
    scopedPath(project.path, `${path}/SKILL.md`);
    const text = await readFile(join(project.path, path, "SKILL.md"), "utf8").catch(() => "");
    if (!text) continue;
    const body = frontmatter(text).body.trim().slice(0, 30_000);
    sources.push({ path, hash: hash(text).slice(0, 12) });
    parts.push(`REPOSITORY SKILL ${path}/SKILL.md\n${body}`);
  }
  return { text: parts.join("\n\n"), sources, notes: Boolean(setup.notes.trim()) };
}
