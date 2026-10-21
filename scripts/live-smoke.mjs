import { _electron as electron } from "playwright";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";

const output = resolve("test-results");
await mkdir(output, { recursive: true });
const directory = await mkdtemp(join(output, "live-"));
const repository = join(directory, "repository");
const data = join(directory, "app-data");
await mkdir(repository);
await mkdir(data);
const git = (args) =>
  execFileSync("git", args, {
    cwd: repository,
    windowsHide: true,
    stdio: "pipe",
  });
git(["init", "-b", "develop"]);
git(["config", "user.name", "Workstream Test"]);
git(["config", "user.email", "test@example.invalid"]);
await writeFile(
  join(repository, "package.json"),
  JSON.stringify({
    name: "workstream-live-fixture",
    private: true,
    scripts: { test: "node --test" },
  }),
);
await writeFile(
  join(repository, "result.test.cjs"),
  "const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');test('result contains exactly done',()=>assert.equal(fs.readFileSync('result.txt','utf8'),'done'));\n",
);
await writeFile(
  join(repository, "AGENTS.md"),
  "# Fixture guidance\nUse the existing test with node --test. No dependencies need installation. Preserve the test. No UI or visual checks are relevant.\n",
);
git(["add", "."]);
git(["commit", "-m", "Test fixture"]);
git(["remote", "add", "origin", repository]);
const app = await electron.launch({
  args: ["."],
  env: { ...process.env, WORKSTREAM_DATA_DIR: data, WORKSTREAM_DEV_URL: "" },
});
const page = await app.firstWindow();
await page
  .getByRole("heading", { name: "From task to pull request." })
  .waitFor();
let runId;
const command = (input) =>
  page.evaluate((input) => window.workstream.command(input), input);
async function waitForStage() {
  const started = Date.now();
  let previous = "";
  while (Date.now() - started < 360000) {
    const state = await page.evaluate(() => window.workstream.snapshot());
    const run = state.runs.find((run) => run.id === runId);
    if (previous !== run.stage + run.status) {
      console.log(`Live workflow: ${run.stage} / ${run.status}`);
      previous = run.stage + run.status;
    }
    for (const approval of state.pendingApprovals) {
      const details = JSON.parse(approval.details);
      const exactTest =
        details.commandActions?.length === 1 &&
        details.commandActions[0].command === "node --test";
      const correctWorktree =
        run.worktree &&
        resolve(details.cwd) === resolve(run.worktree) &&
        resolve(run.worktree).startsWith(resolve(data) + "\\");
      if (
        process.env.WORKSTREAM_TEST_ALLOW_NODE_TEST === "1" &&
        approval.method === "item/commandExecution/requestApproval" &&
        exactTest &&
        correctWorktree
      ) {
        console.log(
          "Allowing the explicitly authorized node --test command in the test worktree.",
        );
        await command({ type: "agentApproval", id: approval.id, accept: true });
      } else
        throw new Error(
          `Live test needs a runtime permission decision: ${JSON.stringify(state.pendingApprovals)}`,
        );
    }
    if (run.status !== "running") return run;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Live workflow timed out; its saved worktree is preserved.");
}
try {
  await command({ type: "connectAgent" });
  const projectState = await command({
    type: "connectProject",
    path: repository,
  });
  const created = await command({
    type: "createRun",
    projectId: projectState.projects[0].id,
    title: "Create the required result file",
    ticketKey: "",
    description:
      "Create result.txt containing exactly the four characters done, with no trailing newline. The existing result.test.cjs test defines the requirement and must remain unchanged. Run node --test. Do not install dependencies. This is a small local integration test; no UI or visual verification is involved.",
  });
  runId = created.runs[0].id;
  await command({ type: "plan", runId });
  const planned = await waitForStage();
  assert.equal(planned.stage, "approval", planned.error);
  assert.equal(planned.status, "idle", planned.error);
  console.log("Live planner produced a valid plan.");
  // The fixture and exact requirements are owned by this test; publication is explicitly excluded.
  await command({ type: "approve", runId, plan: planned.plan, publish: false });
  const delivered = await waitForStage();
  assert.equal(delivered.stage, "ready", delivered.error);
  assert.equal(delivered.status, "idle", delivered.error);
  assert.equal(
    delivered.checks.every((check) => check.passed),
    true,
  );
  assert.equal(delivered.reviews.at(-1).verdict, "pass");
  assert.equal(delivered.prUrl, undefined);
  assert.equal(delivered.commit, undefined);
  await page
    .getByRole("button", { name: /Create the required result file/ })
    .click();
  await page.screenshot({
    path: join(output, "live-run-desktop.png"),
    fullPage: true,
  });
  console.log(
    JSON.stringify(
      {
        liveWorkflow: "passed",
        stages: delivered.sessions.map((session) => session.role),
        checks: delivered.checks.map((check) => ({
          name: check.name,
          passed: check.passed,
        })),
        review: delivered.reviews.at(-1).verdict,
        publication: "not requested",
        data,
      },
      null,
      2,
    ),
  );
} finally {
  if (runId) {
    const state = await page.evaluate(() => window.workstream.snapshot());
    if (state.runs.find((run) => run.id === runId)?.status === "running") {
      await command({ type: "interrupt", runId });
      await waitForStage().catch(() => {});
    }
  }
  await app.close();
}
