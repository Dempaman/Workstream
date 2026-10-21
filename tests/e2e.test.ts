import { describe, expect, it } from "vitest";
import { assertLocal, cleanRecording, containsSecret, journeyFile, parseReport, remoteNavigations, runnableCopy } from "../electron/e2e";

const recording = `import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('http://localhost:3000/sv/');
  await page.getByRole('button', { name: 'Logga in' }).click();
  await page.getByLabel('E-post').fill('buyer@example.invalid');
  await page.getByLabel('Lösenord').fill('S3cret.pass!');
  await page.goto('http://localhost:3000/sv/klader/arbetsklader/trojor/t-shirt-funktionsmaterial/');
});
`;

describe("end-to-end journeys", () => {
  it("only accepts localhost", () => {
    expect(assertLocal("http://localhost:3000/sv/").pathname).toBe("/sv/");
    expect(() => assertLocal("http://127.0.0.1:3000")).not.toThrow();
    for (const url of ["https://inte.delaval.com/sv/", "https://www.delaval.com", "http://localhost.evil.com", "file:///c:/x", "nonsense"])
      expect(() => assertLocal(url)).toThrow();
  });

  it("moves the account out of the recording into environment variables", () => {
    const code = cleanRecording(recording, { username: "buyer@example.invalid", password: "S3cret.pass!" });
    expect(code).toContain(".fill(process.env.WORKSTREAM_E2E_USERNAME)");
    expect(code).toContain(".fill(process.env.WORKSTREAM_E2E_PASSWORD)");
    expect(containsSecret(code, "S3cret.pass!")).toBe(false);
    expect(containsSecret(recording, "S3cret.pass!")).toBe(true);
  });

  it("refuses journeys that open other sites", () => {
    expect(remoteNavigations(recording)).toEqual([]);
    expect(remoteNavigations(`await page.goto('https://www.delaval.com/sv/'); await page.goto('/sv/cart')`)).toEqual(["https://www.delaval.com/sv/"]);
  });

  it("points the test at the project's own Playwright", () => {
    const copy = runnableCopy(recording, "/repo");
    expect(copy).toContain('from "file:///repo/node_modules/playwright/test.mjs"');
    expect(copy).not.toContain("@playwright/test");
  });

  it("reads Playwright's report and hides the password", () => {
    const report = {
      suites: [{ suites: [{ specs: [{ tests: [{ results: [{
        status: "failed",
        duration: 4200,
        error: { message: "\u001b[31mError:\u001b[39m locator.fill('S3cret.pass!') timed out\nCall log:\n- waiting" },
        attachments: [
          { name: "screenshot", path: "/r/shot.png", contentType: "image/png" },
          { name: "trace", path: "/r/trace.zip", contentType: "application/zip" },
          { name: "video", path: "/r/video.webm", contentType: "video/webm" },
        ],
      }] }] }] }] }],
    };
    const result = parseReport(report, "2026-10-21T10:00:00Z", (t) => t.split("S3cret.pass!").join("********"));
    expect(result).toMatchObject({ status: "failed", durationMs: 4200, screenshot: "/r/shot.png", trace: "/r/trace.zip", video: "/r/video.webm" });
    expect(result.error).toBe("Error: locator.fill('********') timed out\nCall log:\n- waiting");
    expect(parseReport({ suites: [], errors: [{ message: "SyntaxError" }] }, "x", (t) => t)).toMatchObject({ status: "error", error: "SyntaxError" });
  });

  it("keeps journey files inside Workstream's folder", () => {
    expect(journeyFile("/data/e2e/p", "0b6f9c2e-1111-4222-8333-444455556666")).toMatch(/journeys[\\/]0b6f9c2e-1111-4222-8333-444455556666\.spec\.mjs$/);
    expect(() => journeyFile("/data", "../../x")).toThrow();
  });
});

import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../electron/store";
import { Workflow } from "../electron/workflow";
import { memoryVault } from "../electron/connectors";
import { git } from "../electron/process";

describe("E2E settings in Workstream", () => {
  async function setup(reachable: boolean) {
    const repo = await mkdtemp(join(tmpdir(), "workstream-e2e-repo-"));
    await git(repo, ["init", "-b", "develop"]);
    const store = new Store(await mkdtemp(join(tmpdir(), "workstream-e2e-state-")));
    const vault = memoryVault();
    const fetcher = (async () => {
      if (!reachable) throw new Error("ECONNREFUSED");
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;
    const workflow = new Workflow(store, join(process.cwd(), "skills"), join(repo, "worktrees"), () => {}, async () => {}, fetcher, vault);
    await workflow.command({ type: "connectProject", path: repo });
    return { workflow, store, vault, project: store.state.projects[0] };
  }

  it("keeps the password out of state.json and only accepts localhost", async () => {
    const { workflow, store, vault, project } = await setup(true);
    await expect(
      workflow.command({ type: "e2eSettings", projectId: project.id, baseUrl: "https://inte.delaval.com/sv/", browser: "msedge", headed: true }),
    ).rejects.toThrow(/only run against localhost/);
    await workflow.command({ type: "e2eSettings", projectId: project.id, baseUrl: "http://localhost:3000/sv/", browser: "msedge", headed: true, username: "buyer@example.invalid", password: "S3cret.pass!" });
    expect(project.e2e).toMatchObject({ baseUrl: "http://localhost:3000/sv/", username: "buyer@example.invalid", hasPassword: true });
    expect(vault.get(`e2e-password:${project.id}`)).toBe("S3cret.pass!");
    store.save();
    expect(await readFile(join(store.directory, "state.json"), "utf8")).not.toContain("S3cret.pass!");
    await workflow.command({ type: "e2eSettings", projectId: project.id, baseUrl: "http://localhost:3000/sv/", browser: "chrome", headed: false });
    expect(project.e2e?.hasPassword).toBe(true);
    await workflow.command({ type: "e2eSettings", projectId: project.id, baseUrl: "http://localhost:3000/sv/", browser: "chrome", headed: false, password: null });
    expect(project.e2e?.hasPassword).toBe(false);
  });

  it("says when the site is not running instead of starting a test", async () => {
    const { workflow, project } = await setup(false);
    await workflow.command({ type: "e2eSettings", projectId: project.id, baseUrl: "http://localhost:3000/sv/", browser: "msedge", headed: true });
    project.journeys = [{ id: "0b6f9c2e-1111-4222-8333-444455556666", name: "Checkout", createdAt: "x", updatedAt: "x" }];
    await expect(workflow.command({ type: "e2eRun", projectId: project.id })).rejects.toThrow(/Nothing answers at http:\/\/localhost:3000\/sv\//);
    expect(project.e2e?.reachable).toBe(false);
    expect(project.e2eActivity).toBeUndefined();
  });
});
