import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { skillKinds, type GeneratedSkill, type Project, type SkillKind } from "../shared/types";
import { appSkillPrefix, frontmatter, skillFile } from "./agentsetup";

/** Workstream's own folder for a project's skills (kept outside the repository). */
export const appSkillDir = (dataDir: string, projectId: string) =>
  join(dataDir, "skills", projectId.replace(/[^A-Za-z0-9_-]/g, "_"));

/** What the read-only generator agent must return. */
export const skillDraftSchema = z.object({
  summary: z.string().max(3000),
  filesRead: z.array(z.string().max(400)).max(80),
  skills: z
    .array(
      z.object({
        kind: z.enum(skillKinds),
        description: z.string().max(600),
        body: z.string().max(40000),
      }),
    )
    .max(3),
});

export const skillSlug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "project";

export const skillName = (project: Pick<Project, "name">, kind: SkillKind) => `${skillSlug(project.name)}-${kind}`;

/** Instructions for the read-only agent that studies the repository. */
export const generatorInstructions = `You study a software repository and write short, project-specific skills (SKILL.md bodies) for three AI coding agents: a developer, a tester and a reviewer. This session is read-only. Never edit, create or delete files, never run installs, builds, tests or dev servers, and never request write access or network access. Use your file reading and search tools. Do not commit, push, publish or contact external services. Do not delegate to other agents. Return the required structured output.`;

export function generatorPrompt(project: Project, existing: { path: string; name: string; description: string }[]) {
  return `Study the repository in the current folder and write three skills that make AI agents produce code which fits THIS project.

HOW TO STUDY IT (read only)
1. Read package.json (scripts, dependencies), the lockfile type, tsconfig/jsconfig, lint and format config (ESLint, Prettier, Stylelint), test config (Jest, Vitest, Playwright, Cypress, Karma, Storybook), and any AGENTS.md, CLAUDE.md, CONTRIBUTING, README or docs folder.
2. Map the folder structure: where features, components, hooks, services/API clients, state, styles, translations, types and tests live.
3. Open 6 to 12 representative, recently changed source files of different kinds (for example a component, a hook, an API/service module, a store/slice, a style file) and 3 to 6 existing tests. Recent history is a good guide when you can read it (git log may be declined: then pick files by structure).
4. Note concrete conventions you saw repeated in at least two places or enforced by config: naming, file layout, import style and aliases, component patterns, styling approach and theme usage, data fetching and error handling, i18n, accessibility, typing rules, test structure, mocking approach and test data.

WRITE THREE SKILLS (kind, description, body)
- develop: how to implement changes here. Where new code goes, which existing helpers/components/patterns to reuse (name them with paths), styling and theming rules, typing rules, i18n, error handling, and a "Do not" list (for example: no new dependencies, do not edit generated files, do not touch unrelated files). Stress the smallest change that fits the existing patterns.
- testing: how this project tests. Exact commands from package.json for lint, type check, unit tests (and how to run one file), e2e if any. Where tests live, naming, structure, mocking and test-data patterns, with a short example shaped like the real tests. Only realistic inputs: no tests for impossible states. Note that Workstream keeps test files out of the pull request (they stay local for verification).
- review: a checklist of the mistakes most likely in THIS codebase, each with what to look for and why it matters here, ordered by impact. Include project-specific rules from config and docs. Keep generic advice out.

RULES FOR THE TEXT
- Be specific to this repository: name real folders, files, helpers and scripts. Leave out general knowledge any senior developer has (what React or TypeScript is, generic clean-code advice).
- Only state what you saw. When something is a pattern you inferred from few files, say "usually". Never invent scripts, paths or libraries.
- Each body is Markdown with short headings and bullet points, 40 to 160 lines. No YAML frontmatter (Workstream adds it).
- description: one or two sentences saying when an agent should use the skill, naming the project and main technologies.
- Never include secrets, tokens, passwords, internal hostnames from .env files, or personal data.
- Do not describe delivery steps (branches, commits, pushes, pull requests, ticket updates): Workstream performs them.
- The skills are given in addition to AGENTS.md, so do not repeat AGENTS.md: refer to it.
${existing.length ? `\nTHE PROJECT ALREADY HAS THESE SKILLS (do not duplicate them; fill the gaps around them)\n${existing.map((s) => `- ${s.path}: ${s.name}: ${s.description.slice(0, 200)}`).join("\n")}\n` : ""}
CONTEXT
${JSON.stringify({ project: project.name, targetBranch: project.targetBranch, detectedStack: project.stack ?? [] })}

Return summary (2 to 5 sentences on what you studied and the key conventions), filesRead (repository-relative paths) and the three skills.`;
}

/** The full SKILL.md text, with frontmatter that marks it as generated. */
export function renderSkill(skill: Pick<GeneratedSkill, "name" | "description" | "body">, now = new Date()) {
  const description = skill.description.replace(/\s+/g, " ").replace(/"/g, "'").trim();
  return `---\nname: ${skill.name}\ndescription: "${description}"\ngenerated-by: workstream\ngenerated-at: ${now.toISOString()}\n---\n\n${skill.body.trim()}\n`;
}

/** Where a generated skill is saved, as the path Workstream lists it under. */
export const generatedPath = (location: "repository" | "workstream", name: string) =>
  location === "workstream" ? `${appSkillPrefix}${name}` : `.agents/skills/${name}`;

/**
 * Writes the skills. A SKILL.md that already exists is only replaced when
 * Workstream generated it earlier: hand-written skills are never overwritten.
 */
export async function saveSkills(
  repo: string,
  appDir: string,
  location: "repository" | "workstream",
  skills: Pick<GeneratedSkill, "name" | "description" | "body">[],
) {
  const targets = skills.map((skill) => ({ skill, path: generatedPath(location, skill.name) }));
  for (const { path } of targets) {
    const file = skillFile(repo, path, appDir);
    const current = await readFile(file, "utf8").catch(() => undefined);
    if (current !== undefined && frontmatter(current).fields["generated-by"] !== "workstream")
      throw new Error(`${path}/SKILL.md already exists and was not generated by Workstream. Choose another name or remove it yourself.`);
  }
  const now = new Date();
  for (const { skill, path } of targets) {
    const file = skillFile(repo, path, appDir);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(`${file}.tmp`, renderSkill(skill, now), "utf8");
    await rename(`${file}.tmp`, file);
  }
  return targets.map((target) => target.path);
}
