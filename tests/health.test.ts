import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { healthCheck } from "../electron/health";
import { git } from "../electron/process";
import type { Project, Runtime } from "../shared/types";

const runtime = (ok: boolean): Runtime => ({ connected: ok, authenticated: ok, accountLabel: ok ? "me@example.invalid" : "", models: ok ? [{ id: "m", name: "M", description: "", isDefault: true, efforts: [], defaultEffort: "" }] : [] });

describe("health check", () => {
  it("reports tools, engines in use, sign-ins and project basics with fixes", async () => {
    const repo = await mkdtemp(join(tmpdir(), "workstream-health-"));
    await git(repo, ["init", "-b", "develop"]);
    const items = await healthCheck({
      settings: { codexPath: "", profiles: { planner: { engine: "codex", model: "", effort: "" }, developer: { engine: "claude", model: "", effort: "" }, reviewer: { engine: "codex", model: "", effort: "" } } },
      projects: [{ id: "p", name: "Shop", path: repo, provider: "github", targetBranch: "develop", skillInfo: [] } as unknown as Project],
      runtimes: { codex: runtime(true), claude: runtime(false), copilot: runtime(false) },
      connections: { github: { provider: "github", cliInstalled: true, signedIn: false, error: "Not signed in." } },
      connectorsEnabled: 0,
      connectorsConnected: 0,
      dataDir: repo,
    });
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(byId.git.status).toMatch(/ok|warn/);
    expect(byId["engine-codex"].status).toBe("ok");
    expect(byId["engine-claude"]).toMatchObject({ status: "fail", fix: expect.stringContaining("connect Claude") });
    expect(byId["engine-copilot"].status).toBe("skip");
    expect(byId["provider-github"]).toMatchObject({ status: "fail", fix: "Open Connections > Git providers and sign in." });
    expect(byId["project-p-target"].status).toBe("warn");
    expect(byId["project-p-skills"]).toMatchObject({ status: "warn", fix: "Agents & models > Generate skills." });
  }, 60_000);
});
