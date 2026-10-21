import { _electron as electron } from "playwright";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";

const output = resolve("test-results");
await mkdir(output, { recursive: true });
const data = await mkdtemp(join(output, "smoke-"));
const repository = join(data, "sample-project");
await mkdir(repository);
execFileSync("git", ["init", "-b", "develop"], {
  cwd: repository,
  windowsHide: true,
});
await writeFile(
  join(repository, "AGENTS.md"),
  "# Sample project\nPreserve the approved scope.\n",
);
const packagedExecutable = process.env.WORKSTREAM_TEST_EXECUTABLE;
const app = await electron.launch({
  ...(packagedExecutable
    ? { executablePath: resolve(packagedExecutable), args: [] }
    : { args: ["."] }),
  env: { ...process.env, WORKSTREAM_DATA_DIR: data, WORKSTREAM_DEV_URL: "" },
});
const page = await app.firstWindow();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page
    .getByRole("heading", { name: "From task to pull request." })
    .waitFor();
  await page.screenshot({
    path: join(output, "overview-desktop.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Connect a repository", exact: false })
    .first()
    .click();
  await page.getByPlaceholder("C:\\Source\\your-project").fill(repository);
  await page
    .getByRole("button", { name: "Connect repository", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await page.getByRole("heading", { name: "sample-project" }).waitFor();
  await page.screenshot({
    path: join(output, "projects-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page
    .getByLabel("Task title", { exact: true })
    .fill("Verify task intake and saved progress");
  await page
    .getByLabel("Requirements & acceptance criteria")
    .fill(
      "Smoke-test fixture. Verify the task appears in the application and persists after restart. Do not run an agent.",
    );
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  await page
    .getByRole("heading", { name: "Verify task intake and saved progress" })
    .waitFor();
  await page.getByRole("tab", { name: "Plan", exact: true }).click();
  await page
    .getByRole("heading", { name: "A clear plan comes first" })
    .waitFor();
  await page.screenshot({
    path: join(output, "task-desktop.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Agents & models", exact: true })
    .click();
  await page.getByRole("heading", { name: "Meet your team" }).waitFor();
  await page
    .getByRole("button", { name: "Connect Codex", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Refresh connection", exact: true })
    .waitFor({ timeout: 75000 })
    .catch(async (error) => {
      console.log(
        "Runtime UI error:",
        await page.locator(".error-banner").allTextContents(),
      );
      throw error;
    });
  await page.waitForFunction(
    async () => {
      const { runtime } = await window.workstream.snapshot();
      return Boolean(runtime.limitsUpdatedAt || runtime.limitsError);
    },
    undefined,
    { timeout: 65000 },
  );
  const runtime = await page.evaluate(async () => {
    const state = await window.workstream.command({ type: "refreshUsage" });
    return {
      connected: state.runtime.connected,
      authenticated: state.runtime.authenticated,
      modelCount: state.runtime.models.length,
      usageBucketCount: state.runtime.limits?.length ?? 0,
      usageUpdatedAt: state.runtime.limitsUpdatedAt,
      usageError: state.runtime.limitsError,
      error: state.runtime.error,
    };
  });
  await page.screenshot({
    path: join(output, "agents-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: join(output, "overview-mobile.png"),
    fullPage: true,
  });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  assert.equal(
    overflow,
    false,
    "The narrow viewport must not overflow horizontally",
  );
  const state = await page.evaluate(() => window.workstream.snapshot());
  assert.equal(state.projects.length, 1);
  assert.equal(state.runs.length, 1);
  assert.equal(state.runs[0].stage, "intake");
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        ui: "passed",
        runtime,
        screenshots: output,
        persistedState: join(data, "state.json"),
      },
      null,
      2,
    ),
  );
} finally {
  await app.close();
}
