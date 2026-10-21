import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { Store } from "../electron/store";
import { Workflow } from "../electron/workflow";
import { git } from "../electron/process";
import { readSkills, roleAddendum } from "../electron/agentsetup";
import { appSkillDir, renderSkill, saveSkills, skillName } from "../electron/skillgen";

const body = (title: string) => `# ${title}\n\n- Components live in src/components and use the shared theme.\n- Reuse src/lib/api.ts for requests.`;
const draft = {
  summary: "Read package.json, tsconfig and six components.",
  filesRead: ["package.json", "src/components/Card.tsx"],
  skills: [
    { kind: "develop", description: "Use when changing the Shop frontend (React, TypeScript).", body: body("Developing in Shop") },
    { kind: "testing", description: "Use when writing or running Shop tests (Vitest).", body: body("Testing in Shop") },
    { kind: "review", description: "Use when reviewing Shop changes.", body: body("Reviewing Shop") },
  ],
};

async function setup(engineName: "codex" | "claude" | "copilot" = "codex") {
  const directory = await mkdtemp(join(tmpdir(), "workstream-skills-"));
  await git(directory, ["init", "-b", "develop"]);
  await writeFile(join(directory, "package.json"), JSON.stringify({ name: "shop", dependencies: { react: "19" } }));
  const store = new Store(await mkdtemp(join(tmpdir(), "workstream-skills-state-")));
  const workflow = new Workflow(store, join(process.cwd(), "skills"), join(directory, "worktrees"), () => {}, async () => {});
  const engine = workflow[engineName];
  vi.spyOn(engine, "connect").mockResolvedValue();
  engine.runtime.authenticated = true;
  const thread = vi.spyOn(engine, "startThread").mockImplementation(async () => randomUUID());
  store.state.settings.profiles.planner = { ...store.state.settings.profiles.planner, engine: engineName, model: "" };
  await workflow.command({ type: "connectProject", path: directory });
  const project = store.state.projects[0];
  project.name = "Shop";
  return { workflow, store, project, engine, thread, directory };
}
const ready = async (project: { skillDraft?: { status: string } }) =>
  vi.waitFor(() => expect(project.skillDraft?.status).not.toBe("working"), { timeout: 5000, interval: 10 });

describe("generate project skills", () => {
  it.each(["codex", "claude", "copilot"] as const)("drafts skills read-only and saves them to the repository (%s)", async (engineName) => {
    const { workflow, project, engine, thread, directory } = await setup(engineName);
    const run = vi.spyOn(engine, "run").mockResolvedValue(JSON.stringify(draft));
    await workflow.command({ type: "generateSkills", projectId: project.id });
    await ready(project);
    // One read-only session in the repository folder, with no connectors.
    expect(thread).toHaveBeenCalledTimes(1);
    expect(thread.mock.calls[0][0]).toBe(directory);
    expect(thread.mock.calls[0][3]).toBe(false);
    expect(thread.mock.calls[0][4]).toEqual([]);
    expect(String(run.mock.calls[0][1])).toContain("Study the repository");
    expect(project.skillDraft?.status).toBe("ready");
    expect(project.skillDraft?.engine).toBe(engineName);
    expect(project.skillDraft?.skills.map((s) => s.name)).toEqual(["shop-develop", "shop-testing", "shop-review"]);
    // Nothing is written before you save.
    expect(await readSkills(directory)).toEqual([]);

    await workflow.command({
      type: "saveGeneratedSkills",
      projectId: project.id,
      location: "repository",
      skills: project.skillDraft!.skills.map((s) => ({
        ...s,
        roles: s.kind === "develop" ? ["planner", "developer"] : s.kind === "testing" ? ["developer", "reviewer"] : ["reviewer"],
      })),
    });
    const text = await readFile(join(directory, ".agents/skills/shop-develop/SKILL.md"), "utf8");
    expect(text).toMatch(/^---\nname: shop-develop\ndescription: "Use when changing the Shop frontend/);
    expect(text).toContain("generated-by: workstream");
    expect(project.skillDraft).toBeUndefined();
    expect(project.skillInfo?.every((s) => s.generated)).toBe(true);
    expect(project.agentSetup?.planner.skills).toEqual([".agents/skills/shop-develop"]);
    expect(project.agentSetup?.developer.skills).toEqual([".agents/skills/shop-develop", ".agents/skills/shop-testing"]);
    expect(project.agentSetup?.reviewer.skills).toEqual([".agents/skills/shop-testing", ".agents/skills/shop-review"]);
    const developer = await roleAddendum(project, "developer");
    expect(developer.text).toContain("Developing in Shop");
    expect(developer.text).toContain("Testing in Shop");
    expect(developer.text).not.toContain("Reviewing Shop");
  });

  it("keeps skills only in Workstream when asked, and agents still get them", async () => {
    const { workflow, store, project, engine, directory } = await setup();
    vi.spyOn(engine, "run").mockResolvedValue(JSON.stringify(draft));
    await workflow.command({ type: "generateSkills", projectId: project.id });
    await ready(project);
    await workflow.command({
      type: "saveGeneratedSkills",
      projectId: project.id,
      location: "workstream",
      skills: [{ ...project.skillDraft!.skills[2], roles: ["reviewer"] }],
    });
    expect(await readSkills(directory)).toEqual([]);
    const appDir = appSkillDir(store.directory, project.id);
    expect(project.skillInfo).toEqual([expect.objectContaining({ path: "workstream/shop-review", location: "workstream", generated: true })]);
    expect(project.agentSetup?.reviewer.skills).toEqual(["workstream/shop-review"]);
    const reviewer = await roleAddendum(project, "reviewer", appDir);
    expect(reviewer.text).toContain("PROJECT SKILL (kept in Workstream) workstream/shop-review");
    expect(reviewer.text).toContain("Reviewing Shop");
  });

  it("never overwrites a hand-written skill but replaces its own earlier version", async () => {
    const repo = await mkdtemp(join(tmpdir(), "workstream-skills-own-"));
    const app = await mkdtemp(join(tmpdir(), "workstream-skills-app-"));
    await mkdir(join(repo, ".agents/skills/shop-review"), { recursive: true });
    await writeFile(join(repo, ".agents/skills/shop-review/SKILL.md"), "---\nname: shop-review\n---\nMine");
    const skill = { name: "shop-review", description: "Use when reviewing Shop.", body: body("Reviewing Shop") };
    await expect(saveSkills(repo, app, "repository", [skill])).rejects.toThrow(/not generated by Workstream/);
    expect(await readFile(join(repo, ".agents/skills/shop-review/SKILL.md"), "utf8")).toContain("Mine");
    await saveSkills(repo, app, "repository", [{ ...skill, name: "shop-testing" }]);
    await saveSkills(repo, app, "repository", [{ ...skill, name: "shop-testing", body: body("Second version") }]);
    expect(await readFile(join(repo, ".agents/skills/shop-testing/SKILL.md"), "utf8")).toContain("Second version");
  });

  it("reports a broken answer and can be stopped", async () => {
    const { workflow, project, engine } = await setup();
    vi.spyOn(engine, "run").mockResolvedValueOnce("not json");
    await workflow.command({ type: "generateSkills", projectId: project.id });
    await ready(project);
    expect(project.skillDraft).toMatchObject({ status: "failed", error: "The agent did not return valid skills. Try again." });

    let finish: (text: string) => void = () => {};
    vi.spyOn(engine, "run").mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const interrupt = vi.spyOn(engine, "interrupt").mockResolvedValue();
    await workflow.command({ type: "generateSkills", projectId: project.id });
    await vi.waitFor(() => expect(project.skillDraft?.threadId).toBeTruthy());
    await workflow.command({ type: "cancelSkillGeneration", projectId: project.id });
    expect(interrupt).toHaveBeenCalled();
    finish(JSON.stringify(draft));
    await new Promise((resolve) => setTimeout(resolve, 20));
    // A late answer after Stop is ignored.
    expect(project.skillDraft).toMatchObject({ status: "failed", error: "Stopped.", skills: [] });
    await workflow.command({ type: "discardSkillDraft", projectId: project.id });
    expect(project.skillDraft).toBeUndefined();
  });

  it("names skills after the project and marks them as generated", () => {
    expect(skillName({ name: "DeLaval Ecommerce Frontend" }, "develop")).toBe("delaval-ecommerce-frontend-develop");
    const text = renderSkill({ name: "x-review", description: 'Say "hi"\nnow', body: "Body" }, new Date("2026-10-21T00:00:00Z"));
    expect(text).toBe('---\nname: x-review\ndescription: "Say \'hi\' now"\ngenerated-by: workstream\ngenerated-at: 2026-10-21T00:00:00.000Z\n---\n\nBody\n');
  });
});
