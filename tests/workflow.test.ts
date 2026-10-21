import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { Store } from "../electron/store";
import { Workflow } from "../electron/workflow";
import { git } from "../electron/process";
import { initialState } from "../electron/store";
import type { Plan, Run } from "../shared/types";

const plan: Plan = {
  summary: "Add a file",
  markdown: "Create result.txt in the isolated checkout.",
  acceptanceCriteria: ["result.txt contains done"],
  checks: [
    {
      name: "Check result",
      executable: "node",
      args: [
        "-e",
        "if(require('fs').readFileSync('result.txt','utf8')!=='done')process.exit(1)",
      ],
    },
  ],
  specialization: "file update",
  risks: [],
};
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "workstream-flow-"));
  await git(directory, ["init", "-b", "develop"]);
  await git(directory, ["config", "user.name", "Workstream Test"]);
  await git(directory, ["config", "user.email", "test@example.invalid"]);
  await writeFile(join(directory, "base.txt"), "base");
  await git(directory, ["add", "base.txt"]);
  await git(directory, ["commit", "-m", "base"]);
  await git(directory, ["remote", "add", "origin", directory]);
  const store = new Store(
    await mkdtemp(join(tmpdir(), "workstream-flow-state-")),
  );
  const workflow = new Workflow(
    store,
    join(process.cwd(), "skills"),
    join(directory, "worktrees"),
    () => {},
    async () => {},
  );
  vi.spyOn(workflow.codex, "connect").mockResolvedValue();
  const thread = vi
    .spyOn(workflow.codex, "startThread")
    .mockImplementation(async () => randomUUID());
  await workflow.command({ type: "connectProject", path: directory });
  await workflow.command({
    type: "createRun",
    projectId: store.state.projects[0].id,
    title: "Add a result",
    ticketKey: "",
    description: "Add result.txt containing done.",
  });
  return { workflow, store, run: store.state.runs[0], thread, directory };
}
async function finished(run: Run) {
  await vi.waitFor(() => expect(run.status).not.toBe("running"), {
    timeout: 15000,
    interval: 20,
  });
}
describe("orchestration behavior", () => {
  it("requires approval and uses different read-only reviewer and writable developer sessions", async () => {
    const { workflow, run, thread, directory } = await fixture();
    vi.spyOn(workflow.codex, "run").mockImplementation(async () => {
      if (run.stage === "planning") return JSON.stringify(plan);
      if (run.stage === "developing") {
        await writeFile(join(run.worktree!, "result.txt"), "done");
        return JSON.stringify({
          summary: "Added result",
          files: ["result.txt"],
          criteriaCovered: plan.acceptanceCriteria,
          limitations: [],
        });
      }
      return JSON.stringify({
        verdict: "pass",
        summary: "Verified file and check",
        findings: [],
        acceptanceGaps: [],
      });
    });
    await expect(
      workflow.command({ type: "continue", runId: run.id }),
    ).rejects.toThrow("Approve");
    await workflow.command({ type: "plan", runId: run.id });
    await finished(run);
    expect(run.stage).toBe("approval");
    expect(run.worktree).toBeUndefined();
    await workflow.command({
      type: "approve",
      runId: run.id,
      plan: run.plan!,
      publish: false,
    });
    await finished(run);
    expect(run.error).toBeUndefined();
    expect(run.stage).toBe("ready");
    expect(run.checks[0].passed).toBe(true);
    expect(run.sessions.map((s) => s.role)).toEqual([
      "planner",
      "developer",
      "reviewer",
    ]);
    expect(new Set(run.sessions.map((s) => s.threadId)).size).toBe(3);
    expect(thread.mock.calls.map((call) => call[3])).toEqual([
      false,
      true,
      false,
    ]);
    expect(await git(directory, ["status", "--porcelain"])).not.toContain(
      "result.txt",
    );
    expect(run.commit).toBeUndefined();
    expect(run.prUrl).toBeUndefined();
    await writeFile(
      join(run.worktree!, "result.test.ts"),
      "local verification",
    );
    await git(run.worktree!, ["add", "result.test.ts"]);
    await workflow.command({ type: "keepTestsLocal", runId: run.id });
    expect(run.localOnlyFiles).toEqual(["result.test.ts"]);
    expect(await readFile(join(run.worktree!, "result.test.ts"), "utf8")).toBe(
      "local verification",
    );
    expect(await git(run.worktree!, ["diff", "--cached", "--name-only"])).toBe(
      "",
    );
    await workflow.command({ type: "publish", runId: run.id });
    await finished(run);
    expect(run.stage).toBe("reviewing");
    expect(run.reviewContentChanged).toBe(true);
    expect(run.reviewedHash).toBeUndefined();
    expect(run.reviews).toHaveLength(1);
    // "Re-verify changed files" must work without typing new evidence.
    await workflow.command({ type: "continue", runId: run.id });
    await finished(run);
    expect(run.reviews).toHaveLength(2);
    // Review passed again, so it went on to publishing (no provider in this test).
    expect(run.stage).toBe("publishing");
    workflow.close();
  }, 30_000);
  it("stops after two failed repair rounds and preserves the worktree", async () => {
    const { workflow, run } = await fixture();
    run.plan = plan;
    run.stage = "approval";
    vi.spyOn(workflow.codex, "run").mockImplementation(async () => {
      if (run.stage === "developing") {
        await writeFile(join(run.worktree!, "result.txt"), "done");
        return JSON.stringify({
          summary: "Changed",
          files: ["result.txt"],
          criteriaCovered: [],
          limitations: [],
        });
      }
      return JSON.stringify({
        verdict: "changes_requested",
        summary: "A concrete defect remains",
        findings: [
          {
            severity: "error",
            file: "result.txt",
            line: 1,
            scenario: "Wrong result",
            recommendation: "Fix result",
          },
        ],
        acceptanceGaps: ["Missing required evidence"],
      });
    });
    await workflow.command({
      type: "approve",
      runId: run.id,
      plan,
      publish: false,
    });
    await finished(run);
    expect(run.status).toBe("blocked");
    expect(run.repairCount).toBe(2);
    expect(run.reviews).toHaveLength(3);
    expect(run.error).toContain("Two repair");
    expect(run.worktree).toBeTruthy();
    workflow.close();
  }, 30_000);
  it("refuses publication before the reviewed state", async () => {
    const store = new Store(await mkdtemp(join(tmpdir(), "workstream-gate-")));
    const workflow = new Workflow(
      store,
      "",
      "",
      () => {},
      async () => {},
    );
    store.state.runs.push({
      id: "intake",
      stage: "intake",
      profiles: initialState().settings.profiles,
    } as Run);
    await expect(
      workflow.command({ type: "publish", runId: "intake" }),
    ).rejects.toThrow("Finish verification");
    workflow.close();
  });
  it("pauses evidence-only blockers and prevents unchanged review retries", async () => {
    const { workflow, run } = await fixture();
    run.plan = plan;
    run.stage = "approval";
    const agent = vi
      .spyOn(workflow.codex, "run")
      .mockImplementation(async () => {
        if (run.stage === "developing") {
          await writeFile(join(run.worktree!, "result.txt"), "done");
          return JSON.stringify({
            summary: "Implemented",
            files: ["result.txt"],
            criteriaCovered: [],
            limitations: [],
          });
        }
        return JSON.stringify({
          verdict: "changes_requested",
          summary: "Environment unavailable",
          findings: [],
          acceptanceGaps: ["Needs you: CMS endpoint returns 404"],
        });
      });
    await workflow.command({
      type: "approve",
      runId: run.id,
      plan,
      publish: false,
    });
    await finished(run);
    expect(run.status).toBe("blocked");
    expect(run.repairCount).toBe(0);
    expect(run.reviews).toHaveLength(1);
    await expect(
      workflow.command({ type: "continue", runId: run.id }),
    ).rejects.toThrow("No new evidence");
    expect(agent).toHaveBeenCalledTimes(2);
    await workflow.command({
      type: "continue",
      runId: run.id,
      evidence: "CMS restored; inspect coverage/results.json",
    });
    await finished(run);
    expect(run.reviews).toHaveLength(2);
    expect(run.repairCount).toBe(0);
    await expect(
      workflow.command({
        type: "continue",
        runId: run.id,
        evidence: "CMS restored; inspect coverage/results.json",
      }),
    ).rejects.toThrow("No new evidence");
    expect(run.memory).toContain("CMS endpoint returns 404");
    const interrupt = vi.spyOn(workflow.codex, "interrupt").mockResolvedValue();
    agent.mockImplementation(async (threadId) => {
      workflow.codex.emit("usage", threadId, {
        totalTokens: 750001,
        inputTokens: 750000,
        cachedInputTokens: 700000,
        outputTokens: 1,
        reasoningOutputTokens: 0,
      });
      return JSON.stringify({
        summary: "Large but allowed",
        limitations: [],
        evidence: [],
        needs: [],
      });
    });
    await workflow.command({ type: "completeVerification", runId: run.id });
    await finished(run);
    // No token or time budget: heavy usage never interrupts an agent.
    expect(run.error ?? "").not.toContain("budget");
    expect(interrupt).not.toHaveBeenCalled();
    workflow.close();
  }, 30_000);
  it("archives projects without deleting history and restores them on reconnect", async () => {
    const { workflow, store, run, directory } = await fixture();
    await workflow.command({
      type: "archiveProject",
      id: run.projectId,
      archived: true,
    });
    expect(store.state.runs).toHaveLength(1);
    await expect(
      workflow.command({
        type: "createRun",
        projectId: run.projectId,
        title: "New",
        ticketKey: "",
        description: "Task",
      }),
    ).rejects.toThrow("Restore");
    await workflow.command({ type: "connectProject", path: directory });
    expect(store.state.projects).toHaveLength(1);
    expect(store.state.projects[0].archived).toBe(false);
    workflow.close();
  });
  it.each([true, false])(
    "collects evidence automatically without another developer and preserves independent review (pass=%s)",
    async (reviewPasses) => {
      const { workflow, run, thread } = await fixture();
      run.plan = plan;
      run.stage = "approval";
      const agent = vi
        .spyOn(workflow.codex, "run")
        .mockImplementation(async () => {
          if (run.stage === "developing") {
            await writeFile(join(run.worktree!, "result.txt"), "done");
            return JSON.stringify({
              summary: "Implemented",
              files: ["result.txt"],
              criteriaCovered: [],
              limitations: [],
            });
          }
          if (run.stage === "verifying")
            return JSON.stringify({
              summary: "Missing test verified",
              limitations: [
                "CMS country not published; browser fixture verifies frontend behavior only",
              ],
              evidence: [
                {
                  check: "Extra regression test",
                  method: "automated_test",
                  result: "passed",
                  details: "node extra-test.js exited 0: 5 passed",
                },
                {
                  check: "Country navigation",
                  method: "fixture_browser",
                  result: "passed",
                  details:
                    "Real app exercised with contract-based country fixtures",
                },
              ],
              needs: [],
            });
          return JSON.stringify({
            verdict:
              run.verification && reviewPasses ? "pass" : "changes_requested",
            summary: "Review",
            findings:
              run.verification && !reviewPasses
                ? [
                    {
                      severity: "error",
                      file: "result.txt",
                      line: 1,
                      scenario: "Independent reviewer found a defect",
                      recommendation: "Fix manually",
                    },
                  ]
                : [],
            acceptanceGaps: run.verification
              ? []
              : ["Missing regression evidence"],
          });
        });
      // Evidence the agent can collect is gathered automatically once after the
      // review, without a click and without another developer round.
      run.repairCount = reviewPasses ? 2 : 0;
      await workflow.command({
        type: "approve",
        runId: run.id,
        plan,
        publish: false,
      });
      await finished(run);
      if (reviewPasses) {
        expect(run.error).toBeUndefined();
        expect(run.stage).toBe("ready");
      } else {
        expect(run.status).toBe("blocked");
        expect(run.error).toContain("No development was restarted");
        expect(run.reviewedHash).toBeUndefined();
      }
      expect(run.repairCount).toBe(reviewPasses ? 2 : 0);
      expect(run.sessions.filter((s) => s.role === "developer")).toHaveLength(
        1,
      );
      expect(
        run.sessions.filter((s) => s.purpose === "verification"),
      ).toHaveLength(1);
      expect(thread.mock.calls.at(-2)?.[3]).toBe(true);
      expect(thread.mock.calls.at(-1)?.[3]).toBe(false);
      expect(agent.mock.calls.at(-1)?.[1]).toContain("5 passed");
      expect(agent.mock.calls.at(-1)?.[1]).toContain("frontend behavior only");
      expect(agent.mock.calls.at(-1)?.[1]).toContain("fixture_browser");
      expect(run.reviews).toHaveLength(2);
      workflow.close();
    },
    30_000,
  );
  it("pauses on specific unavailable evidence, prevents repeated attempts and sends newly attached images", async () => {
    const { workflow, run, store } = await fixture();
    run.plan = plan;
    run.stage = "approval";
    const agent = vi
      .spyOn(workflow.codex, "run")
      .mockImplementation(async () => {
        if (run.stage === "developing") {
          await writeFile(join(run.worktree!, "result.txt"), "done");
          return JSON.stringify({
            summary: "Implemented",
            files: ["result.txt"],
            criteriaCovered: [],
            limitations: [],
          });
        }
        if (run.stage === "verifying")
          return JSON.stringify({
            summary: "Browser unavailable",
            limitations: [],
            evidence: [
              {
                check: "Browser",
                method: "live_browser",
                result: "unavailable",
                details: "No browser connection",
              },
            ],
            needs: [
              {
                kind: "environment",
                action: "Start the local test server and provide its URL.",
              },
            ],
          });
        return JSON.stringify({
          verdict: "changes_requested",
          summary: "Missing evidence",
          findings: [],
          acceptanceGaps: ["Needs you: Browser required"],
        });
      });
    await workflow.command({
      type: "approve",
      runId: run.id,
      plan,
      publish: false,
    });
    await finished(run);
    await workflow.command({ type: "completeVerification", runId: run.id });
    await finished(run);
    expect(run.status).toBe("blocked");
    expect(run.reviews).toHaveLength(1);
    expect(run.repairCount).toBe(0);
    expect(run.verification?.needs[0].action).toContain("test server");
    await expect(
      workflow.command({ type: "completeVerification", runId: run.id }),
    ).rejects.toThrow("already attempted");
    await workflow.command({
      type: "attachEvidence",
      runId: run.id,
      images: [
        {
          name: "original.png",
          dataUrl:
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=",
        },
      ],
    });
    await workflow.command({ type: "completeVerification", runId: run.id });
    await finished(run);
    expect(agent.mock.calls.at(-1)?.[4]).toEqual([
      store.attachments.path(run.images![0].id),
    ]);
    expect(run.reviews).toHaveLength(1);
    // Even a verifier reporting success cannot pass along modified product code.
    expect(agent.mock.calls.at(-1)?.[1]).toContain(
      '"summary":"Browser unavailable"',
    );
    agent.mockImplementation(async () => {
      await writeFile(join(run.worktree!, "result.txt"), "unexpected edit");
      return JSON.stringify({
        summary: "Claimed pass",
        limitations: [],
        evidence: [
          {
            check: "Test",
            method: "automated_test",
            result: "passed",
            details: "Claimed result",
          },
        ],
        needs: [],
      });
    });
    await workflow.command({
      type: "completeVerification",
      runId: run.id,
      evidence: "Test server now available at localhost",
    });
    await finished(run);
    expect(run.error).toContain("Files changed during verification");
    expect(run.reviews).toHaveLength(1);
    expect(run.reviewedHash).toBeUndefined();
    workflow.close();
  }, 30_000);
  it("replaces cumulative session usage rather than double-counting events", async () => {
    const { workflow, run } = await fixture();
    run.sessions.push({ role: "planner", threadId: "usage-test" });
    const usage = {
      totalTokens: 120,
      inputTokens: 100,
      cachedInputTokens: 20,
      outputTokens: 20,
      reasoningOutputTokens: 10,
    };
    workflow.codex.emit("usage", "usage-test", usage);
    workflow.codex.emit("usage", "usage-test", usage);
    expect(run.sessions[0].usage?.totalTokens).toBe(120);
    workflow.close();
  });
  it("persists reference images and passes their managed paths to the planner", async () => {
    const { workflow, store } = await fixture();
    const image =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=";
    await workflow.command({
      type: "createRun",
      projectId: store.state.projects[0].id,
      title: "Image task",
      ticketKey: "",
      description: "Inspect reference",
      images: [{ name: "reference.png", dataUrl: image }],
    });
    const run = store.state.runs[0];
    const agent = vi
      .spyOn(workflow.codex, "run")
      .mockResolvedValue(JSON.stringify(plan));
    await workflow.command({ type: "plan", runId: run.id });
    await finished(run);
    expect(agent.mock.calls[0][4]).toEqual([
      store.attachments.path(run.images![0].id),
    ]);
    expect(store.attachments.read(run.images![0])).toBe(image);
    workflow.close();
  });
  it("scopes bulk approvals to the run and honors session decision availability", async () => {
    const { workflow, run } = await fixture();
    run.sessions.push({ role: "developer", threadId: "approval-thread" });
    const respond = vi
      .spyOn(workflow.codex, "respond")
      .mockImplementation(() => {});
    for (const id of [1, 2])
      workflow.codex.emit("approval", {
        id,
        method: "item/commandExecution/requestApproval",
        params: {
          threadId: "approval-thread",
          availableDecisions: ["accept", "decline"],
        },
      });
    await expect(
      workflow.command({
        type: "agentApproval",
        id: "1",
        accept: true,
        scope: "session",
      }),
    ).rejects.toThrow("not available");
    await workflow.command({
      type: "agentApproval",
      id: "1",
      accept: true,
      scope: "pending",
    });
    expect(respond.mock.calls).toEqual([
      [1, true, false],
      [2, true, false],
    ]);
    expect(workflow.snapshot().pendingApprovals).toHaveLength(0);
    workflow.codex.emit("approval", {
      id: 3,
      method: "item/fileChange/requestApproval",
      params: { threadId: "approval-thread" },
    });
    await workflow.command({
      type: "agentApproval",
      id: "3",
      accept: true,
      scope: "session",
    });
    expect(respond).toHaveBeenLastCalledWith(3, true, true);
    workflow.close();
  });
  it("allow everything for this run accepts pending and later requests without asking", async () => {
    const { workflow, run } = await fixture();
    run.sessions.push({ role: "developer", threadId: "auto-thread" });
    const respond = vi.spyOn(workflow.codex, "respond").mockImplementation(() => {});
    const ask = (id: number, command: string) =>
      workflow.codex.emit("approval", {
        id,
        method: "item/commandExecution/requestApproval",
        params: { threadId: "auto-thread", command, availableDecisions: ["accept", "acceptForSession", "decline"] },
      });
    ask(1, "npm run lint");
    expect(workflow.snapshot().pendingApprovals[0]).toMatchObject({ tool: "Command", command: "npm run lint" });
    await workflow.command({ type: "agentApproval", id: "1", accept: true, scope: "run" });
    expect(run.autoApprove).toBe(true);
    ask(2, "node verify-ui.mjs consent");
    ask(3, "npx vitest run");
    expect(workflow.snapshot().pendingApprovals).toHaveLength(0);
    expect(respond.mock.calls).toEqual([
      [1, true, true],
      [2, true, true],
      [3, true, true],
    ]);
    expect(run.activity.some((a) => a.text.includes("Auto-allowed Command: npx vitest run"))).toBe(true);
    await workflow.command({ type: "stopAutoApprove", runId: run.id });
    ask(4, "rm -rf something");
    expect(workflow.snapshot().pendingApprovals).toHaveLength(1);
    workflow.close();
  });
});
describe("agent engine per role", () => {
  it("runs a role on Claude when its profile selects Claude and records the engine", async () => {
    const { workflow, run } = await fixture();
    run.profiles.planner = { engine: "claude", model: "claude-test-1", effort: "high" };
    vi.spyOn(workflow.claude, "connect").mockResolvedValue();
    workflow.claude.runtime.models = [
      { id: "claude-test-1", name: "Claude", description: "", isDefault: true, efforts: ["high"], defaultEffort: "high" },
    ];
    const claudeThread = vi.spyOn(workflow.claude, "startThread").mockResolvedValue("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
    const claudeRun = vi.spyOn(workflow.claude, "run").mockResolvedValue(JSON.stringify(plan));
    const codexRun = vi.spyOn(workflow.codex, "run");
    await workflow.command({ type: "plan", runId: run.id });
    await finished(run);
    expect(run.stage).toBe("approval");
    expect(claudeThread).toHaveBeenCalledWith(expect.any(String), expect.anything(), expect.any(String), false, [], expect.any(String));
    expect(claudeRun).toHaveBeenCalledOnce();
    expect(codexRun).not.toHaveBeenCalled();
    expect(run.sessions[0]).toMatchObject({ engine: "claude", model: "claude-test-1", role: "planner" });
  });
});
describe("agent instructions", () => {
  it("passes the role's repository skill and notes to the agent and records them", async () => {
    const { workflow, run, store, thread } = await fixture();
    const project = store.state.projects[0];
    const { mkdir, writeFile: write } = await import("node:fs/promises");
    await mkdir(join(project.path, ".agents/skills/jira-ticket-plan"), { recursive: true });
    await write(join(project.path, ".agents/skills/jira-ticket-plan/SKILL.md"), "---\nname: jira-ticket-plan\ndescription: plan\n---\nPLAN-SKILL-BODY");
    await workflow.command({ type: "refreshSkills", projectId: project.id });
    await workflow.command({
      type: "updateAgentSetup",
      projectId: project.id,
      setup: {
        planner: { skills: [".agents/skills/jira-ticket-plan"], notes: "Mention Storybook." },
        developer: { skills: [], notes: "" },
        reviewer: { skills: [], notes: "" },
      },
    });
    vi.spyOn(workflow.codex, "run").mockResolvedValue(JSON.stringify(plan));
    await workflow.command({ type: "plan", runId: run.id });
    await finished(run);
    const instructions = String(thread.mock.calls[0][2]);
    expect(instructions).toContain("PLAN-SKILL-BODY");
    expect(instructions).toContain("Mention Storybook.");
    expect(instructions.indexOf("Do not commit, push")).toBeLessThan(instructions.indexOf("PLAN-SKILL-BODY"));
    expect(run.sessions[0].instructions?.skills[0].path).toBe(".agents/skills/jira-ticket-plan");
    await expect(
      workflow.command({
        type: "updateAgentSetup",
        projectId: project.id,
        setup: { planner: { skills: ["../secret"], notes: "" }, developer: { skills: [], notes: "" }, reviewer: { skills: [], notes: "" } },
      }),
    ).rejects.toThrow("Unknown repository skill");
  });
});

describe("project memory", () => {
  it("gives agents related memories from earlier runs and your notes", async () => {
    const { workflow, store, run } = await fixture();
    expect(workflow.memory).toBeDefined();
    run.development = { summary: "Added a dealer search box", files: ["src/Dealer.tsx"], criteriaCovered: [], limitations: [] };
    run.plan = plan;
    run.title = "Dealer search";
    run.ticketKey = "DPP-10";
    workflow.memory!.recordRun(run);
    await workflow.command({ type: "memoryAdd", projectId: run.projectId, title: "Team rule", body: "Use SmartLink for links" });
    await workflow.command({ type: "createRun", projectId: run.projectId, title: "Dealer search on mobile", ticketKey: "DPP-11", description: "Make dealer search work on mobile." });
    const next = store.state.runs.find((r) => r.ticketKey === "DPP-11")!;
    const agent = vi.spyOn(workflow.codex, "run").mockResolvedValue(JSON.stringify(plan));
    await workflow.command({ type: "plan", runId: next.id });
    await finished(next);
    const prompt = String(agent.mock.calls[0][1]);
    expect(prompt).toContain("Added a dealer search box");
    expect(prompt).toContain("Use SmartLink for links");
    expect(next.memoryUsed?.map((m) => m.kind)).toEqual(expect.arrayContaining(["note", "outcome"]));
    await workflow.command({ type: "memoryList", projectId: run.projectId, query: "dealer" });
    expect(workflow.snapshot().memoryView?.items.length).toBeGreaterThan(0);
    workflow.close();
  });
});
describe("accepting items outside the code", () => {
  async function blockedByContentGap(findings: unknown[] = []) {
    const { workflow, run } = await fixture();
    vi.spyOn(workflow.codex, "run").mockImplementation(async () => {
      if (run.stage === "planning") return JSON.stringify(plan);
      if (run.stage === "developing") {
        await writeFile(join(run.worktree!, "result.txt"), "done");
        return JSON.stringify({ summary: "Added", files: ["result.txt"], criteriaCovered: [], limitations: [] });
      }
      return JSON.stringify({
        verdict: "changes_requested",
        summary: "Code fine; Swedish texts missing in CMS",
        findings,
        acceptanceGaps: ["Outside the code: Market-approved Swedish explanations are not published in the CMS"],
      });
    });
    await workflow.command({ type: "plan", runId: run.id });
    await finished(run);
    await workflow.command({ type: "approve", runId: run.id, plan: run.plan!, publish: false });
    await finished(run);
    return { workflow, run };
  }
  it("lets you accept content gaps, moves to ready and lists them for the PR", async () => {
    const { workflow, run } = await blockedByContentGap();
    expect(run.status).toBe("blocked");
    expect(run.stage).toBe("reviewing");
    await expect(
      workflow.command({ type: "acceptGaps", runId: run.id, items: ["something else"], reason: "Handled by the market team" }),
    ).rejects.toThrow("Accept every remaining item");
    await workflow.command({
      type: "acceptGaps",
      runId: run.id,
      items: ["Outside the code: Market-approved Swedish explanations are not published in the CMS"],
      reason: "Swedish texts are added by the market team in the CMS",
    });
    expect(run.stage).toBe("ready");
    expect(run.status).toBe("idle");
    expect(run.reviewedHash).toBeDefined();
    expect(run.acceptedGaps?.[0].reason).toContain("market team");
    const { reviewCleared } = await import("../electron/guards");
    expect(reviewCleared(run)).toBe(true);
    // A new review invalidates the acceptance.
    run.reviews.push({ ...run.reviews.at(-1)! });
    expect(reviewCleared(run)).toBe(false);
    workflow.close();
  });
  it("refuses when the review found code problems", async () => {
    const { workflow, run } = await blockedByContentGap([
      { severity: "warning", file: "result.txt", line: 1, scenario: "Wrong text", recommendation: "Fix it" },
    ]);
    await expect(
      workflow.command({
        type: "acceptGaps",
        runId: run.id,
        items: ["Outside the code: Market-approved Swedish explanations are not published in the CMS"],
        reason: "Swedish texts are added by the market team in the CMS",
      }),
    ).rejects.toThrow("code problems");
    workflow.close();
  });
});

describe("line comments in the Changes tab", () => {
  it("sends your comments to the developer, then reruns checks and the independent review", async () => {
    const { workflow, run } = await fixture();
    const prompts: string[] = [];
    vi.spyOn(workflow.codex, "run").mockImplementation(async (_thread, prompt) => {
      prompts.push(String(prompt));
      if (run.stage === "planning") return JSON.stringify(plan);
      if (run.stage === "developing") {
        await writeFile(join(run.worktree!, "result.txt"), "done");
        return JSON.stringify({ summary: "Handled", files: ["result.txt"], criteriaCovered: [], limitations: [] });
      }
      return JSON.stringify({ verdict: "pass", summary: "OK", findings: [], acceptanceGaps: [] });
    });
    await workflow.command({ type: "plan", runId: run.id });
    await finished(run);
    await workflow.command({ type: "approve", runId: run.id, plan: run.plan!, publish: false });
    await finished(run);
    expect(run.stage).toBe("ready");
    await expect(workflow.command({ type: "sendComments", runId: run.id })).rejects.toThrow("at least one comment");
    await workflow.command({ type: "addComment", runId: run.id, file: "result.txt", line: 1, side: "new", code: "done", text: "Write it in capitals" });
    const id = run.comments![0].id;
    await workflow.command({ type: "updateComment", runId: run.id, id, text: "Write DONE in capitals" });
    await workflow.command({ type: "sendComments", runId: run.id });
    await finished(run);
    expect(run.error).toBeUndefined();
    expect(run.comments![0].status).toBe("sent");
    const developerPrompt = prompts.find((p) => p.includes("left these line comments"))!;
    expect(developerPrompt).toContain("Write DONE in capitals");
    expect(developerPrompt).toContain('"file":"result.txt"');
    // The independent review ran again and sees the comments; no automatic repair was used.
    expect(run.reviews).toHaveLength(2);
    expect(prompts.at(-1)).toContain("reviewComments");
    expect(run.repairCount).toBe(0);
    expect(run.stage).toBe("ready");
    await expect(
      workflow.command({ type: "updateComment", runId: run.id, id, text: "changed" }),
    ).rejects.toThrow("already sent");
    await workflow.command({ type: "updateComment", runId: run.id, id, status: "resolved" });
    expect(run.comments![0].status).toBe("resolved");
    workflow.close();
  }, 30_000);
});

describe("Figma links", () => {
  it("tells agents to read Figma links from the task with their Figma tools", async () => {
    const { workflow, run, thread } = await fixture();
    run.description = "Match the design: https://www.figma.com/design/AbC123/Dealers?node-id=1-2 thanks";
    vi.spyOn(workflow.codex, "run").mockResolvedValue(JSON.stringify(plan));
    await workflow.command({ type: "plan", runId: run.id });
    await finished(run);
    const instructions = String(thread.mock.calls[0][2]);
    expect(instructions).toContain("https://www.figma.com/design/AbC123/Dealers?node-id=1-2");
    expect(instructions).toContain("get_design_context");
    expect(instructions).toContain("Never change anything in Figma");
    workflow.close();
  });
});

describe("the same flow on every engine", () => {
  it.each(["codex", "claude", "copilot"] as const)(
    "collects evidence automatically, routes outside-the-code items to you and accepts them (%s)",
    async (engineName) => {
      const { workflow, run } = await fixture();
      const engine = workflow[engineName];
      vi.spyOn(engine, "connect").mockResolvedValue();
      vi.spyOn(engine, "startThread").mockImplementation(async () => randomUUID());
      engine.runtime.authenticated = true;
      for (const role of ["planner", "developer", "reviewer"] as const)
        run.profiles[role] = { ...run.profiles[role], engine: engineName, model: "" };
      run.plan = plan;
      run.stage = "approval";
      const calls = vi.spyOn(engine, "run").mockImplementation(async () => {
        if (run.stage === "developing") {
          await writeFile(join(run.worktree!, "result.txt"), "done");
          return JSON.stringify({ summary: "Added", files: ["result.txt"], criteriaCovered: [], limitations: [] });
        }
        if (run.stage === "verifying")
          return JSON.stringify({
            summary: "Zoom checked",
            limitations: [],
            evidence: [{ check: "200% zoom", method: "live_browser", result: "passed", details: "Readable" }],
            needs: [{ kind: "external", action: "Legal approves the wording" }],
          });
        return JSON.stringify({
          verdict: "changes_requested",
          summary: "Code fine",
          findings: [],
          acceptanceGaps: run.verification
            ? ["Outside the code: Legal approves the wording"]
            : ["Evidence: 200% zoom screenshot", "Outside the code: Legal approves the wording"],
        });
      });
      await workflow.command({ type: "approve", runId: run.id, plan, publish: false });
      await finished(run);
      // One automatic evidence round on this engine, then only the outside item is left.
      expect(run.sessions.filter((s) => s.purpose === "verification")).toHaveLength(1);
      expect(run.sessions.every((s) => s.engine === engineName)).toBe(true);
      expect(run.reviews).toHaveLength(2);
      expect(run.status).toBe("blocked");
      expect(run.error).toContain("needs you or is outside the code");
      // The second reviewer was told what changed since the first review.
      expect(calls.mock.calls.at(-1)?.[1]).toContain("changesSinceLastReview");
      await workflow.command({
        type: "acceptGaps",
        runId: run.id,
        items: ["Outside the code: Legal approves the wording"],
        reason: "Legal signs off before release",
      });
      expect(run.stage).toBe("ready");
      workflow.close();
    },
    30_000,
  );
});
