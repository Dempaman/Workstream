// Read-only repository access check. No model calls, Git push, or PR creation.
import { _electron as electron } from "playwright";
import { readFile, mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
const source = process.env.WORKSTREAM_DIAGNOSTIC_STATE;
if (!source)
  throw new Error(
    "Set WORKSTREAM_DIAGNOSTIC_STATE to the state file to inspect.",
  );
const original = JSON.parse(await readFile(source, "utf8"));
const project = original.projects.find(
  (p) => p.provider === "azure" && !p.archived,
);
if (!project) throw new Error("No connected Azure project.");
await mkdir(resolve("test-results"), { recursive: true });
const data = await mkdtemp(resolve("test-results/azure-access-"));
const state = {
  version: 1,
  theme: "dark",
  settings: original.settings,
  projects: [project],
  runs: [
    {
      id: "access-check",
      projectId: project.id,
      title: "Read-only Azure access check",
      ticketKey: "",
      description: "Read-only access",
      stage: "intake",
      status: "idle",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      branch: "",
      targetBranch: project.targetBranch,
      reviews: [],
      checks: [],
      activity: [],
      sessions: [],
      files: [],
      repairCount: 0,
      profiles: original.settings.profiles,
    },
  ],
};
await writeFile(join(data, "state.json"), JSON.stringify(state));
const app = await electron.launch({
  args: ["."],
  env: { ...process.env, WORKSTREAM_DATA_DIR: data, WORKSTREAM_DEV_URL: "" },
});
try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => Boolean(window.workstream));
  const result = await page.evaluate(async () => {
    try {
      await window.workstream.command({
        type: "checkPublicationAccess",
        runId: "access-check",
      });
      return "Azure login and repository read access passed. No push or PR mutation attempted.";
    } catch (error) {
      return error.message;
    }
  });
  console.log(result);
  if (result.includes("network request failed"))
    console.log(
      await app.evaluate(async ({ net }) => {
        try {
          const response = await net.fetch("https://dev.azure.com", {
            redirect: "manual",
          });
          return `Azure host network status: ${response.status}`;
        } catch (error) {
          return `Azure host diagnostic: ${String(error)}; ${String(error.cause ?? "")}`;
        }
      }),
    );
} finally {
  await app.close();
}
