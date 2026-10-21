import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { readSkills, roleAddendum, suggestSetup } from "../electron/agentsetup";
import type { Project } from "../shared/types";

async function repo() {
  const dir = await mkdtemp(join(tmpdir(), "ws-skills-"));
  const skill = async (name: string, description: string, body: string) => {
    await mkdir(join(dir, ".agents/skills", name), { recursive: true });
    await writeFile(join(dir, ".agents/skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}`);
  };
  await skill("jira-ticket-plan", "Turn a pasted Jira ticket into a plan.", "# Jira ticket planning\nInspect the repo.");
  await skill("frontend-pr-reviewer", "review react and typescript frontend changes", "# Frontend PR Reviewer\nCheck TanStack Query keys.");
  await skill("orchestrator", "Coordinate a DeLaval Jira ticket to a PR.", "# Orchestrator\nSpawn subagents.");
  return dir;
}

describe("repository skills for Workstream roles", () => {
  it("reads names and descriptions and suggests a mapping without the orchestrator", async () => {
    const dir = await repo();
    const skills = await readSkills(dir);
    expect(skills.map((s) => s.name).sort()).toEqual(["frontend-pr-reviewer", "jira-ticket-plan", "orchestrator"]);
    expect(skills.find((s) => s.name === "orchestrator")?.workflow).toBe(true);
    expect(suggestSetup(skills)).toEqual({
      planner: { skills: [".agents/skills/jira-ticket-plan"], notes: "" },
      developer: { skills: [], notes: "" },
      reviewer: { skills: [".agents/skills/frontend-pr-reviewer"], notes: "" },
    });
  });

  it("builds instructions with the order of authority, notes and the skill body", async () => {
    const dir = await repo();
    const project = {
      path: dir,
      skillInfo: await readSkills(dir),
      agentSetup: {
        planner: { skills: [], notes: "" },
        developer: { skills: [], notes: "Use the existing MUI theme." },
        reviewer: { skills: [".agents/skills/frontend-pr-reviewer"], notes: "" },
      },
    } as unknown as Project;
    const reviewer = await roleAddendum(project, "reviewer");
    expect(reviewer.text).toContain("ORDER OF AUTHORITY");
    expect(reviewer.text).toContain("Check TanStack Query keys.");
    expect(reviewer.text).not.toContain("description: review react");
    expect(reviewer.sources).toEqual([{ path: ".agents/skills/frontend-pr-reviewer", hash: expect.any(String) }]);
    const developer = await roleAddendum(project, "developer");
    expect(developer.text).toContain("Use the existing MUI theme.");
    expect(developer.notes).toBe(true);
    expect(developer.sources).toEqual([]);
  });

  it("refuses skill paths outside the repository", async () => {
    const dir = await repo();
    const project = {
      path: dir,
      agentSetup: { planner: { skills: ["../../etc"], notes: "" }, developer: { skills: [], notes: "" }, reviewer: { skills: [], notes: "" } },
    } as unknown as Project;
    await expect(roleAddendum(project, "planner")).rejects.toThrow();
  });
});
