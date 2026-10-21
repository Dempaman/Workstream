import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as processes from "../electron/process";
import {
  azurePermissions,
  azureSession,
  encodeRefSegments,
} from "../electron/azure";
import { githubRepository } from "../electron/github";
import { gitAuthEnv, providerForRemote, tokenClaims } from "../electron/hosting";
import { publish, checkPublicationAccess } from "../electron/publish";
import { planHash } from "../electron/guards";
import { inspectChanges } from "../electron/repository";
import type { Plan, Project, Run } from "../shared/types";

const jwt = (claims: Record<string, unknown>) =>
  `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.y`;
const tenant = "11111111-2222-4333-8444-555555555555";

function mockCli(token: string) {
  const actual = processes.execute;
  return vi
    .spyOn(processes, "execute")
    .mockImplementation(async (program, args, cwd, options) => {
      if (program === "powershell.exe" || program === "az")
        return {
          code: 0,
          output: "",
          stdout: JSON.stringify({ accessToken: token }),
          stderr: "",
        };
      if (program === "gh")
        return { code: 0, output: "", stdout: `${token}\n`, stderr: "" };
      return actual(program, args, cwd, options);
    });
}
afterEach(() => vi.restoreAllMocks());

describe("hosting helpers", () => {
  it("encodes branch folders the way Azure DevOps security tokens expect", () => {
    expect(encodeRefSegments("main")).toBe("6d00610069006e00");
    expect(encodeRefSegments("feature/x")).toBe(
      "6600650061007400750072006500/7800",
    );
  });
  it("passes push credentials through environment config only for HTTPS remotes", () => {
    const env = gitAuthEnv("https://dev.azure.com/o/p/_git/r", "Authorization: Bearer t");
    expect(env).toMatchObject({
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "credential.helper",
      GIT_CONFIG_VALUE_0: "",
      GIT_CONFIG_KEY_1: "http.extraHeader",
      GIT_CONFIG_VALUE_1: "Authorization: Bearer t",
    });
    expect(gitAuthEnv("git@ssh.dev.azure.com:v3/o/p/r", "x")).toEqual({});
  });
  it("detects providers and parses GitHub remotes", () => {
    expect(providerForRemote("https://github.com/acme/shop.git")).toBe("github");
    expect(providerForRemote("https://dev.azure.com/o/p/_git/r")).toBe("azure");
    expect(githubRepository("git@github.com:acme/shop.git")).toEqual({
      owner: "acme",
      repository: "shop",
    });
    expect(() => githubRepository("https://example.com/a/b")).toThrow();
  });
  it("reads display claims without trusting them for authorization", () => {
    expect(tokenClaims(jwt({ upn: "dev@example.com" })).upn).toBe("dev@example.com");
    expect(tokenClaims("not-a-token")).toEqual({});
  });
});

describe("Azure access", () => {
  const project = {
    path: process.cwd(),
    remote: "https://dev.azure.com/org/proj/_git/repo",
    provider: "azure",
    branchPrefix: "feature",
  } as Project;

  it("pins the token to the organization tenant and names the account on 403", async () => {
    const exec = mockCli(jwt({ upn: "dennis@example.com", tid: tenant }));
    const fetch = vi.fn(async () =>
      new Response("", {
        status: 403,
        headers: { "x-vss-resourcetenant": tenant },
      }),
    );
    const target = { ...project };
    await expect(checkPublicationAccess(target, fetch)).rejects.toThrow(
      /denied repository access \(403\) for dennis@example\.com.*Stakeholder/s,
    );
    expect(target.azureTenantId).toBe(tenant);
    const tokenArgs = exec.mock.calls.find(([p]) => p === "az" || p === "powershell.exe")!;
    if (tokenArgs[0] === "az") expect(tokenArgs[1]).toContain(tenant);
    expect(target.access?.ok ?? false).toBe(false);
  });

  it("reports missing push permission before anything is pushed", async () => {
    mockCli(jwt({ upn: "dennis@example.com", tid: tenant }));
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("permissionevaluationbatch")) {
        const body = JSON.parse(String(init?.body)) as {
          evaluations: { token: string; permissions: number }[];
        };
        expect(body.evaluations[2].token).toBe(
          "repoV2/p-1/r-1/refs/heads/6600650061007400750072006500",
        );
        return Response.json({
          evaluations: [{ value: false }, { value: true }, { value: true }],
        });
      }
      if (url.includes("/_apis/git/repositories/repo"))
        return Response.json({ id: "r-1", project: { id: "p-1" } });
      return new Response("", { status: 401 });
    });
    const target = { ...project, azureTenantId: tenant };
    const access = await azurePermissions(target, await azureSession(target, fetch));
    expect(access).toMatchObject({
      read: true,
      push: false,
      pullRequest: true,
      createBranch: true,
      ok: false,
      account: "dennis@example.com",
    });
    expect(access.summary).toContain("cannot push");
  });
});

describe("GitHub publication", () => {
  it("creates a PR and pushes with the GitHub CLI account", async () => {
    const directory = await mkdtemp(join(tmpdir(), "workstream-github-"));
    const actualGit = processes.git;
    await actualGit(directory, ["init", "-b", "codex/change"]);
    await actualGit(directory, ["config", "user.name", "Test"]);
    await actualGit(directory, ["config", "user.email", "test@example.invalid"]);
    await writeFile(join(directory, "app.txt"), "base");
    await actualGit(directory, ["add", "."]);
    await actualGit(directory, ["commit", "-m", "base"]);
    const baseCommit = await actualGit(directory, ["rev-parse", "HEAD"]);
    const remote = "https://github.com/acme/shop";
    await actualGit(directory, ["remote", "add", "origin", remote]);
    await writeFile(join(directory, "app.txt"), "changed");
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
      branch: "codex/change",
      targetBranch: "main",
      title: "Change",
      ticketKey: "DPP-1",
      plan,
      approval: { at: "now", planHash: planHash(plan), publish: true },
      reviews: [{ verdict: "pass", summary: "Pass", findings: [], acceptanceGaps: [] }],
      checks: [{ ...plan.checks[0], passed: true }],
    } as unknown as Run;
    run.reviewedHash = (await inspectChanges(run)).hash;
    mockCli("gho_fixture");
    const pushEnv: Record<string, string>[] = [];
    vi.spyOn(processes, "git").mockImplementation(async (cwd, args, options) => {
      if (args[0] === "push") {
        pushEnv.push(options?.env ?? {});
        return "";
      }
      if (args[0] === "ls-remote")
        return `${await actualGit(cwd, ["rev-parse", "HEAD"])}\trefs/heads/codex/change`;
      return actualGit(cwd, args, options);
    });
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/user")) return Response.json({ login: "dennis" });
      if (url.endsWith("/repos/acme/shop"))
        return Response.json({ permissions: { pull: true, push: true } });
      if (url.includes("/pulls?")) return Response.json([]);
      if (url.endsWith("/pulls") && init?.method === "POST")
        return Response.json({ number: 7, html_url: "https://github.com/acme/shop/pull/7" });
      return new Response("", { status: 404 });
    });
    const project = { path: directory, remote, provider: "github", branchPrefix: "codex" } as Project;
    await expect(publish(project, run, () => {}, fetch)).resolves.toBe(
      "https://github.com/acme/shop/pull/7",
    );
    expect(project.access?.account).toBe("dennis");
    expect(pushEnv[0].GIT_CONFIG_VALUE_1).toBe(
      `Authorization: Basic ${Buffer.from("x-access-token:gho_fixture").toString("base64")}`,
    );
    const created = fetch.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse(String(created[1]!.body))).toMatchObject({
      head: "codex/change",
      base: "main",
      title: "DPP-1: Change",
    });
  });
});
