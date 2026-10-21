import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Project, Role, SkillInfo } from "../shared/types";
import { hash, scopedPath } from "./guards";
import { effectiveSetup, suggestSetup } from "../shared/agents";

export { effectiveSetup, suggestSetup };

export const roles: Role[] = ["planner", "developer", "reviewer"];
const skillFolders = [".agents/skills", ".codex/skills", ".claude/skills"];
/** Skills kept only in Workstream (not in the repository) are listed under this prefix. */
export const appSkillPrefix = "workstream/";

/** Where a skill's SKILL.md lives: the repository, or Workstream's own folder for the project. */
export function skillFile(repo: string, path: string, appDir?: string) {
  if (path.startsWith(appSkillPrefix)) {
    const name = path.slice(appSkillPrefix.length);
    if (!appDir || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) throw new Error(`Unknown Workstream skill: ${path}`);
    return join(appDir, name, "SKILL.md");
  }
  scopedPath(repo, `${path}/SKILL.md`);
  return join(repo, path, "SKILL.md");
}

export function frontmatter(text: string) {
  const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
  const fields: Record<string, string> = {};
  for (const line of match?.[1].split(/\r?\n/) ?? []) {
    const field = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (field) fields[field[1].toLowerCase()] = field[2].replace(/^["']|["']$/g, "").trim();
  }
  return { fields, body: match ? text.slice(match[0].length) : text };
}

/**
 * Lists the repository's own agent skills, plus skills kept only in Workstream
 * for this project (appDir), with their names and descriptions.
 */
export async function readSkills(repo: string, appDir?: string): Promise<SkillInfo[]> {
  const skills: SkillInfo[] = [];
  const folders = skillFolders.map((folder) => ({ folder, root: join(repo, folder), prefix: `${folder}/` }));
  if (appDir) folders.push({ folder: "workstream", root: appDir, prefix: appSkillPrefix });
  for (const { root, prefix } of folders) {
    for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory()) continue;
      const path = `${prefix}${entry.name}`;
      const text = await readFile(join(root, entry.name, "SKILL.md"), "utf8").catch(() => "");
      if (!text) continue;
      const { fields } = frontmatter(text);
      skills.push({
        path,
        name: fields.name || entry.name,
        description: (fields.description ?? "").slice(0, 600),
        workflow: /orchestrat|workflow|pipeline/i.test(`${entry.name} ${fields.name ?? ""}`),
        ...(fields["generated-by"] === "workstream" ? { generated: true } : {}),
        ...(prefix === appSkillPrefix ? { location: "workstream" as const } : {}),
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
export async function roleAddendum(project: Project, role: Role, appDir?: string) {
  const setup = effectiveSetup(project)[role];
  const parts: string[] = [];
  const sources: { path: string; hash: string }[] = [];
  parts.push(
    "ORDER OF AUTHORITY: 1) the Workstream rules above (safety, read-only stages, no commits/pushes/PRs, structured output), 2) the approved plan, 3) the user's notes, 4) repository skills. When a repository skill describes its own workflow steps (asking for plan approval, creating branches or worktrees, committing, pushing, opening PRs, spawning subagents, updating Jira), skip those steps: Workstream performs them. Apply the skill's technical guidance, checklists and conventions.",
  );
  if (setup.notes.trim())
    parts.push(`USER NOTES FOR THE ${role.toUpperCase()} (from Workstream settings for this project)\n${setup.notes.trim()}`);
  for (const path of setup.skills) {
    const text = await readFile(skillFile(project.path, path, appDir), "utf8").catch(() => "");
    if (!text) continue;
    const body = frontmatter(text).body.trim().slice(0, 30_000);
    sources.push({ path, hash: hash(text).slice(0, 12) });
    parts.push(`${path.startsWith(appSkillPrefix) ? "PROJECT SKILL (kept in Workstream)" : "REPOSITORY SKILL"} ${path}/SKILL.md\n${body}`);
  }
  return { text: parts.join("\n\n"), sources, notes: Boolean(setup.notes.trim()) };
}
