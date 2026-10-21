import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

const output = resolve("test-results");
await mkdir(output, { recursive: true });
const data = await mkdtemp(join(output, "improvements-"));
const repo = join(data, "fixture-project");
await mkdir(repo);
const git = (...args) =>
  execFileSync("git", args, {
    cwd: repo,
    windowsHide: true,
    encoding: "utf8",
  }).trim();
git("init", "-b", "develop");
git("config", "user.name", "Fixture");
git("config", "user.email", "fixture@example.invalid");
await writeFile(
  join(repo, "market.ts"),
  "const market = 'old';\nexport { market };\n",
);
git("add", ".");
git("commit", "-m", "Fixture base");
const base = git("rev-parse", "HEAD");
await writeFile(join(repo, "market.test.ts"), "// Local verification fixture\n");
await writeFile(
  join(repo, "market.ts"),
  "const market = 'new';\nexport { market };\n",
);
const plan = {
  summary: "Update market",
  markdown: "Use the selected market.",
  acceptanceCriteria: ["Correct country shown"],
  checks: [
    { name: "Fixture", executable: "node", args: ["-e", "process.exit(0)"] },
  ],
  specialization: "UI",
  risks: [],
};
const profile = { model: "", effort: "high" };
const profiles = { planner: profile, developer: profile, reviewer: profile };
const now = new Date().toISOString();
const state = {
  version: 1,
  theme: "dark",
  projects: [
    {
      id: "project",
      name: "Fixture project",
      path: repo,
      remote: "",
      provider: "other",
      targetBranch: "develop",
      branchPrefix: "feature",
      instructions: false,
      skills: [],
    },
  ],
  settings: { codexPath: "codex", profiles },
  runs: [
    {
      id: "blocked",
      projectId: "project",
      title: "Review a market change",
      ticketKey: "TEST-1",
      description: "Correct country shown.",
      stage: "reviewing",
      status: "blocked",
      createdAt: now,
      updatedAt: now,
      branch: "develop",
      targetBranch: "develop",
      worktree: repo,
      baseCommit: base,
      plan,
      approval: {
        at: now,
        planHash: createHash("sha256")
          .update(JSON.stringify(plan))
          .digest("hex"),
        publish: false,
      },
      development: {
        summary: "Updated market",
        files: ["market.ts"],
        criteriaCovered: [],
        limitations: [],
      },
      reviews: [
        {
          verdict: "changes_requested",
          summary: "Code passes, environment evidence missing.",
          findings: [],
          acceptanceGaps: [
            "CMS country endpoint returns 404. Obtain a working destination and retain browser verification.",
          ],
        },
      ],
      checks: [
        { ...plan.checks[0], passed: true, exitCode: 0, output: "Passed" },
      ],
      activity: [],
      sessions: [],
      repairCount: 2,
      files: ["market.ts"],
      diff: git("diff"),
      error: "Two repair rounds completed with unresolved checks or findings.",
      profiles,
    },
  ],
};
await writeFile(join(data, "state.json"), JSON.stringify(state));
const png = join(data, "reference.png");
await writeFile(
  png,
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=",
    "base64",
  ),
);
const app = await electron.launch({
  ...(process.env.WORKSTREAM_TEST_EXECUTABLE
    ? {
        executablePath: resolve(process.env.WORKSTREAM_TEST_EXECUTABLE),
        args: [],
      }
    : { args: ["."] }),
  env: { ...process.env, WORKSTREAM_DATA_DIR: data, WORKSTREAM_DEV_URL: "" },
});
const errors = [];
try {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await page
    .getByRole("heading", { name: "From task to pull request." })
    .waitFor();
  await page.getByText("v0.2.3 · local", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await page.getByRole("button", { name: "Edit project" }).click();
  await page
    .getByLabel("Project name", { exact: true })
    .fill("Renamed project");
  await page.getByRole("button", { name: "Save project settings" }).click();
  await page.getByRole("heading", { name: "Renamed project" }).waitFor();
  await page
    .getByRole("button", { name: "Remove project", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm removal" }).click();
  await page
    .getByRole("heading", { name: "Bring your first repository" })
    .waitFor();
  await page.getByLabel("Show removed projects").check();
  await page.getByRole("button", { name: "Restore project" }).click();
  await page
    .getByRole("button", { name: "Remove project", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page
    .getByLabel("Task title", { exact: true })
    .fill("Task with screenshot");
  await page
    .getByLabel("Requirements & acceptance criteria")
    .fill("Use the attached reference image.");
  await page.getByLabel("Attach reference images").setInputFiles(png);
  await page.getByRole("button", { name: "Remove image 1" }).waitFor();
  await page
    .getByLabel("Requirements & acceptance criteria")
    .evaluate((element) => {
      const bytes = Uint8Array.from(
        atob(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=",
        ),
        (character) => character.charCodeAt(0),
      );
      const clipboardData = new DataTransfer();
      clipboardData.items.add(
        new File([bytes], "pasted.png", { type: "image/png" }),
      );
      element.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
  await page.getByRole("button", { name: "Remove image 2" }).waitFor();
  await page.screenshot({
    path: join(output, "improvements-attachment.png"),
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  await page.getByRole("heading", { name: "Task with screenshot" }).waitFor();
  assert.equal(await page.locator(".image-grid img").count(), 2);
  const saved = JSON.parse(await readFile(join(data, "state.json"), "utf8"));
  assert.equal(saved.runs[0].images.length, 2);
  assert.equal(
    (await readFile(join(data, "attachments", saved.runs[0].images[0].id)))
      .length > 0,
    true,
  );
  await page.getByRole("button", { name: "Back to runs" }).click();
  await page.getByRole("button", { name: /Review a market change/ }).click();
  await page.getByRole("button", { name: "Keep new tests local" }).click();
  await page.getByText(/New test files stay local for verification and are excluded from the PR \(1 identified\)/).waitFor();
  await page
    .getByRole("heading", { name: "What needs to be resolved" })
    .waitFor();
  await page.getByRole("button", { name: "View recovery options" }).click();
  assert.equal(
    await page
      .locator("#complete-verification")
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await page
    .getByText("I already fixed the issues or collected evidence", {
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Re-run verification and review" })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "No new evidence" })
    .waitFor();
  await page.screenshot({
    path: join(output, "improvements-recovery.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("tab", { name: /Changes/ }).click();
  await page.getByText("Local only · excluded from PR", { exact: true }).first().waitFor();
  assert.equal(await page.locator(".diff-line-add").count(), 1);
  assert.equal(await page.locator(".diff-line-remove").count(), 1);
  await page.screenshot({
    path: join(output, "improvements-diff-dark.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await page.screenshot({
    path: join(output, "improvements-diff-light.png"),
    fullPage: true,
    animations: "disabled",
  });
  // Exercise event-driven UI without starting a model or changing the saved run.
  const snapshot = await page.evaluate(() => window.workstream.snapshot());
  const blocked = snapshot.runs.find((run) => run.id === "blocked");
  blocked.verification = {
    summary: "Targeted tests passed. Original screenshot still missing.",
    limitations: ["Live CMS data unavailable; local fixtures cover frontend behavior only."],
    evidence: [
      {
        check: "Selector tests",
        method: "fixture_browser",
        result: "passed",
        details: "5 tests passed; exit 0",
      },
      {
        check: "Original screenshot",
        method: "inspection",
        result: "unavailable",
        details: "Reference image is not attached",
      },
    ],
    needs: [
      {
        kind: "image",
        action:
          "Attach image-20261014-083857.png using Reference images below.",
      },
    ],
  };
  await app.evaluate(
    ({ BrowserWindow }, value) =>
      BrowserWindow.getAllWindows()[0].webContents.send(
        "workstream:changed",
        value,
      ),
    snapshot,
  );
  await page.getByRole("heading", { name: "Needed from you" }).waitFor();
  await page.getByText("Passed: Selector tests", { exact: true }).waitFor();
  await page.getByText("(Browser with local fixtures)", { exact: true }).waitFor();
  await page.getByRole("heading", { name: "Verification limitations" }).waitFor();
  await page.screenshot({
    path: join(output, "recovery-results-light.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "Recovery fits mobile",
  );
  await page.screenshot({
    path: join(output, "recovery-results-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1350, height: 940 });
  snapshot.runtime = {
    connected: true,
    authenticated: true,
    accountLabel: "Fixture",
    models: [],
    limits: [
      {
        id: "codex",
        name: "Codex",
        primary: {
          usedPercent: 75,
          windowDurationMins: 300,
          resetsAt: Math.floor(Date.now() / 1000) + 3600,
        },
        secondary: {
          usedPercent: 46,
          windowDurationMins: 10080,
          resetsAt: Math.floor(Date.now() / 1000) + 86400,
        },
      },
    ],
    limitsUpdatedAt: now,
  };
  const run = snapshot.runs.find((run) => run.id === "blocked");
  run.status = "running";
  run.error = undefined;
  run.sessions = [
    {
      role: "reviewer",
      threadId: "fixture",
      usage: {
        totalTokens: 12500,
        inputTokens: 10000,
        cachedInputTokens: 5000,
        outputTokens: 2500,
        reasoningOutputTokens: 1500,
      },
    },
  ];
  run.live = {
    text: "Inspecting the changed market selector",
    at: now,
    startedAt: now,
    steps: [
      { step: "Inspect changed files", status: "completed" },
      { step: "Check browser evidence", status: "inProgress" },
    ],
  };
  await app.evaluate(
    ({ BrowserWindow }, snapshot) =>
      BrowserWindow.getAllWindows()[0].webContents.send(
        "workstream:changed",
        snapshot,
      ),
    snapshot,
  );
  await page.getByRole("heading", { name: "Live activity" }).waitFor();
  await page.locator(".account-usage summary").click();
  await page.getByText("25% remaining").waitFor();
  await page.screenshot({
    path: join(output, "improvements-usage-live.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.locator(".account-usage summary").click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: join(output, "improvements-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "No horizontal overflow at 390px",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Images, project editing/removal/restoration, blocked retry guard, PR diff, simulated usage/live events, and narrow layout passed. No model inference used.",
  );
} finally {
  await app.close();
}
