import { mkdtemp, writeFile, readFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import * as processes from "../electron/process";
import { publish, checkPublicationAccess } from "../electron/publish";
import { git } from "../electron/process";
import { planHash } from "../electron/guards";
import { inspectChanges } from "../electron/repository";
import { initialState } from "../electron/store";
import type { Plan, Project, Run } from "../shared/types";

describe("publication content gate", () => {
  it("keeps new tests local while committing production files and preserves them across publication retries", async () => {
    const directory = await mkdtemp(join(tmpdir(), "workstream-local-tests-"));
    const actualGit = processes.git;
    const actualExecute = processes.execute;
    await actualGit(directory, ["init", "-b", "feature/test"]);
    await actualGit(directory, ["config", "user.name", "Test"]);
    await actualGit(directory, [
      "config",
      "user.email",
      "test@example.invalid",
    ]);
    await writeFile(join(directory, "app.txt"), "base");
    await actualGit(directory, ["add", "."]);
    await actualGit(directory, ["commit", "-m", "base"]);
    const baseCommit = await actualGit(directory, ["rev-parse", "HEAD"]);
    const remote = "https://dev.azure.com/fixture/project/_git/repo";
    await actualGit(directory, ["remote", "add", "origin", remote]);
    await writeFile(join(directory, "app.txt"), "changed");
    await writeFile(join(directory, "app.test.ts"), "keep local");
    const plan: Plan = {
      summary: "Change",
      markdown: "Change",
      acceptanceCriteria: ["Change"],
      checks: [{ name: "Check", executable: "node", args: ["--version"] }],
      specialization: "general",
      risks: [],
    };
    const run = {
      worktree: directory,
      baseCommit,
      branch: "feature/test",
      targetBranch: "develop",
      title: "Change",
      ticketKey: "",
      plan,
      approval: { at: "now", planHash: planHash(plan), publish: true },
      reviews: [
        { verdict: "pass", summary: "Pass", findings: [], acceptanceGaps: [] },
      ],
      checks: [{ ...plan.checks[0], passed: true }],
      keepNewTestsLocal: true,
    } as unknown as Run;
    run.reviewedHash = (await inspectChanges(run)).hash;
    const gitSpy = vi
      .spyOn(processes, "git")
      .mockImplementation(async (cwd, args, options) => {
        if (args[0] === "push") return "";
        if (args[0] === "ls-remote")
          return `${await actualGit(cwd, ["rev-parse", "HEAD"])}\trefs/heads/feature/test`;
        return actualGit(cwd, args, options);
      });
    const execSpy = vi
      .spyOn(processes, "execute")
      .mockImplementation(async (program, args, cwd, options) => {
        if (program === "powershell.exe" || program === "az")
          return {
            code: 0,
            output: "",
            stdout: JSON.stringify({ accessToken: "fixture-only" }),
            stderr: "",
          };
        return actualExecute(program, args, cwd, options);
      });
    const network = vi.fn(
      async (url: string, init?: RequestInit) =>
        new Response(
          JSON.stringify(
            init?.method === "POST" ? { pullRequestId: 123 } : { value: [] },
          ),
          {
            status: url.startsWith("https://dev.azure.com/fixture/")
              ? 200
              : 404,
          },
        ),
    );
    try {
      const project = { path: directory, remote } as Project;
      await expect(checkPublicationAccess(project, async () => new Response("", { status: 401 }))).rejects.toThrow("rejected the login (401)");
      await expect(checkPublicationAccess(project, async () => new Response("", { status: 403 }))).rejects.toThrow("denied repository access (403)");
      await expect(publish(project, run, () => {}, network)).resolves.toContain(
        "/pullrequest/123",
      );
      expect(await actualGit(directory, ["show", "HEAD:app.txt"])).toBe(
        "changed",
      );
      expect(
        await actualGit(directory, [
          "ls-tree",
          "--name-only",
          "HEAD",
          "--",
          "app.test.ts",
        ]),
      ).toBe("");
      expect(await readFile(join(directory, "app.test.ts"), "utf8")).toBe(
        "keep local",
      );
      expect(run.localOnlyFiles).toEqual(["app.test.ts"]);
      expect(network.mock.calls[0][1]?.headers).toMatchObject({ "X-TFS-FedAuthRedirect": "Suppress" });
      expect((await inspectChanges(run)).hash).toBe(run.reviewedHash);
      await expect(publish(project, run, () => {}, network)).resolves.toContain(
        "/pullrequest/123",
      );
    } finally {
      gitSpy.mockRestore();
      execSpy.mockRestore();
    }
  });
  it("never commits test files, including changes to tests already in the repository", async () => {
    const directory = await mkdtemp(join(tmpdir(), "workstream-no-tests-"));
    const actualGit = processes.git;
    const actualExecute = processes.execute;
    await actualGit(directory, ["init", "-b", "feature/test"]);
    await actualGit(directory, ["config", "user.name", "Test"]);
    await actualGit(directory, ["config", "user.email", "test@example.invalid"]);
    await writeFile(join(directory, "app.txt"), "base");
    await writeFile(join(directory, "app.test.ts"), "existing test");
    await actualGit(directory, ["add", "."]);
    await actualGit(directory, ["commit", "-m", "base"]);
    const baseCommit = await actualGit(directory, ["rev-parse", "HEAD"]);
    const remote = "https://dev.azure.com/fixture/project/_git/repo";
    await actualGit(directory, ["remote", "add", "origin", remote]);
    await writeFile(join(directory, "app.txt"), "changed");
    await writeFile(join(directory, "app.test.ts"), "agent edited the existing test");
    await writeFile(join(directory, "new.spec.tsx"), "agent added a test");
    const plan: Plan = {
      summary: "Change",
      markdown: "Change",
      acceptanceCriteria: ["Change"],
      checks: [{ name: "Check", executable: "node", args: ["--version"] }],
      specialization: "general",
      risks: [],
    };
    const run = {
      worktree: directory,
      baseCommit,
      branch: "feature/test",
      targetBranch: "develop",
      title: "Change",
      ticketKey: "",
      plan,
      approval: { at: "now", planHash: planHash(plan), publish: true },
      reviews: [{ verdict: "pass", summary: "Pass", findings: [], acceptanceGaps: [] }],
      checks: [{ ...plan.checks[0], passed: true }],
    } as unknown as Run;
    run.reviewedHash = (await inspectChanges(run)).hash;
    const gitSpy = vi.spyOn(processes, "git").mockImplementation(async (cwd, args, options) => {
      if (args[0] === "push") return "";
      if (args[0] === "ls-remote")
        return `${await actualGit(cwd, ["rev-parse", "HEAD"])}\trefs/heads/feature/test`;
      return actualGit(cwd, args, options);
    });
    const execSpy = vi.spyOn(processes, "execute").mockImplementation(async (program, args, cwd, options) => {
      if (program === "powershell.exe" || program === "az")
        return { code: 0, output: "", stdout: JSON.stringify({ accessToken: "fixture-only" }), stderr: "" };
      return actualExecute(program, args, cwd, options);
    });
    const network = vi.fn(async (url: string, init?: RequestInit) =>
      new Response(JSON.stringify(init?.method === "POST" ? { pullRequestId: 5 } : { value: [] }), {
        status: url.startsWith("https://dev.azure.com/fixture/") ? 200 : 404,
      }),
    );
    try {
      const project = { path: directory, remote } as Project;
      await expect(publish(project, run, () => {}, network)).resolves.toContain("/pullrequest/5");
      expect(await actualGit(directory, ["show", "HEAD:app.txt"])).toBe("changed");
      expect(await actualGit(directory, ["show", "HEAD:app.test.ts"])).toBe("existing test");
      expect(await actualGit(directory, ["ls-tree", "--name-only", "HEAD", "--", "new.spec.tsx"])).toBe("");
      expect(run.localOnlyFiles).toEqual(["app.test.ts", "new.spec.tsx"]);
      // Both edits are still in the worktree for verification.
      expect(await readFile(join(directory, "app.test.ts"), "utf8")).toBe("agent edited the existing test");
      await expect(publish(project, run, () => {}, network)).resolves.toContain("/pullrequest/5");
    } finally {
      gitSpy.mockRestore();
      execSpy.mockRestore();
    }
  });

  it("publishes a change request that deletes a file, and the retry after a commit still works", async () => {
    const directory = await mkdtemp(join(tmpdir(), "workstream-revision-publish-"));
    const actualGit = processes.git;
    const actualExecute = processes.execute;
    await actualGit(directory, ["init", "-b", "feature/test"]);
    await actualGit(directory, ["config", "user.name", "Test"]);
    await actualGit(directory, ["config", "user.email", "test@example.invalid"]);
    await writeFile(join(directory, "app.txt"), "base");
    await actualGit(directory, ["add", "."]);
    await actualGit(directory, ["commit", "-m", "base"]);
    const baseCommit = await actualGit(directory, ["rev-parse", "HEAD"]);
    // First version of the PR added extra.txt.
    await writeFile(join(directory, "extra.txt"), "card");
    await actualGit(directory, ["add", "."]);
    await actualGit(directory, ["commit", "-m", "first version"]);
    const fromCommit = await actualGit(directory, ["rev-parse", "HEAD"]);
    const remote = "https://dev.azure.com/fixture/project/_git/repo";
    await actualGit(directory, ["remote", "add", "origin", remote]);
    // The change request removes extra.txt again (back to the base) and changes app.txt.
    await rm(join(directory, "extra.txt"));
    await writeFile(join(directory, "app.txt"), "changed");
    // Claude Code's own permission file must never end up in the PR or block it.
    await mkdir(join(directory, ".claude"));
    await writeFile(join(directory, ".claude", "settings.local.json"), "{}");
    const plan: Plan = {
      summary: "Change",
      markdown: "Change",
      acceptanceCriteria: ["Change"],
      checks: [{ name: "Check", executable: "node", args: ["--version"] }],
      specialization: "general",
      risks: [],
    };
    const run = {
      worktree: directory,
      baseCommit,
      branch: "feature/test",
      targetBranch: "develop",
      title: "Change",
      ticketKey: "",
      plan,
      approval: { at: "now", planHash: planHash(plan), publish: true },
      reviews: [{ verdict: "pass", summary: "Pass", findings: [], acceptanceGaps: [] }],
      checks: [{ ...plan.checks[0], passed: true }],
      keepNewTestsLocal: true,
      revisions: [{ number: 1, request: "Remove the card", requestedAt: "now", fromCommit, startHash: "x" }],
    } as unknown as Run;
    const changes = await inspectChanges(run);
    expect(changes.files).toEqual(["app.txt", "extra.txt"]);
    run.reviewedHash = changes.hash;
    const gitSpy = vi.spyOn(processes, "git").mockImplementation(async (cwd, args, options) => {
      if (args[0] === "push") return "";
      if (args[0] === "ls-remote")
        return `${await actualGit(cwd, ["rev-parse", "HEAD"])}\trefs/heads/feature/test`;
      return actualGit(cwd, args, options);
    });
    const execSpy = vi.spyOn(processes, "execute").mockImplementation(async (program, args, cwd, options) => {
      if (program === "powershell.exe" || program === "az")
        return { code: 0, output: "", stdout: JSON.stringify({ accessToken: "fixture-only" }), stderr: "" };
      return actualExecute(program, args, cwd, options);
    });
    const network = vi.fn(async (url: string, init?: RequestInit) =>
      new Response(
        JSON.stringify(
          init?.method === "PATCH"
            ? { pullRequestId: 7 }
            : url.includes("/pullrequests?")
              ? { value: [{ pullRequestId: 7, status: "active" }] }
              : { value: [] },
        ),
        { status: url.startsWith("https://dev.azure.com/fixture/") ? 200 : 404 },
      ),
    );
    try {
      const project = { path: directory, remote } as Project;
      await expect(publish(project, run, () => {}, network)).resolves.toContain("/pullrequest/7");
      expect(await actualGit(directory, ["ls-tree", "--name-only", "HEAD"])).toBe("app.txt");
      expect(await actualGit(directory, ["rev-parse", "HEAD^"])).toBe(fromCommit);
      // Retry (for example after a failed push): nothing to commit, same commit is pushed.
      const commit = run.commit;
      await expect(publish(project, run, () => {}, network)).resolves.toContain("/pullrequest/7");
      expect(run.commit).toBe(commit);
    } finally {
      gitSpy.mockRestore();
      execSpy.mockRestore();
    }
  });

  it("stops before authentication or push when content changed after review", async () => {
    const directory = await mkdtemp(join(tmpdir(), "workstream-publish-"));
    await git(directory, ["init", "-b", "develop"]);
    await git(directory, ["config", "user.name", "Test"]);
    await git(directory, ["config", "user.email", "test@example.invalid"]);
    await writeFile(join(directory, "file.txt"), "base");
    await git(directory, ["add", "file.txt"]);
    await git(directory, ["commit", "-m", "base"]);
    const baseCommit = await git(directory, ["rev-parse", "HEAD"]);
    const plan: Plan = {
      summary: "Change a file",
      markdown: "Change it.",
      acceptanceCriteria: ["Changed"],
      checks: [{ name: "Check", executable: "node", args: ["--version"] }],
      specialization: "general",
      risks: [],
    };
    const run: Run = {
      id: "reviewed-run",
      projectId: "project",
      title: "Change a file",
      ticketKey: "",
      description: "Change a file",
      stage: "ready",
      status: "idle",
      createdAt: "now",
      updatedAt: "now",
      branch: "develop",
      targetBranch: "develop",
      activity: [],
      sessions: [],
      files: ["file.txt"],
      repairCount: 0,
      profiles: initialState().settings.profiles,
      plan,
      approval: { at: "now", planHash: planHash(plan), publish: true },
      worktree: directory,
      baseCommit,
      reviews: [
        { verdict: "pass", summary: "Pass", findings: [], acceptanceGaps: [] },
      ],
      checks: [{ ...plan.checks[0], passed: true, exitCode: 0, output: "" }],
    };
    await writeFile(join(directory, "file.txt"), "reviewed");
    run.reviewedHash = (await inspectChanges(run)).hash;
    await writeFile(join(directory, "file.txt"), "unreviewed");
    await expect(
      publish({ path: directory } as Project, run, () => {}),
    ).rejects.toThrow("Files changed after review");
    expect(await git(directory, ["rev-parse", "HEAD"])).toBe(baseCommit);
  });
  it("requires publication authorization even with implementation approval", async () => {
    const plan: Plan = {
      summary: "Change a file",
      markdown: "Change it.",
      acceptanceCriteria: ["Changed"],
      checks: [{ name: "Check", executable: "node", args: ["--version"] }],
      specialization: "general",
      risks: [],
    };
    const run = {
      plan,
      approval: { at: "now", planHash: planHash(plan), publish: false },
    } as Run;
    await expect(publish({} as Project, run, () => {})).rejects.toThrow(
      "Publication was not included",
    );
  });
});
