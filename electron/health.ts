import { access, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Engine, HealthItem, Project, ProviderAccount, Runtime, Settings } from "../shared/types";
import { execute, git } from "./process";
import { repoConfig } from "./e2e";

const version = (text: string) => text.match(/(\d+)\.(\d+)(?:\.(\d+))?/)?.slice(1, 4).map((n) => Number(n ?? 0)) ?? [];
const atLeast = (have: number[], want: number[]) => {
  for (let i = 0; i < want.length; i++) {
    if ((have[i] ?? 0) > want[i]) return true;
    if ((have[i] ?? 0) < want[i]) return false;
  }
  return true;
};

async function tool(program: string, args: string[]) {
  try {
    const result = await execute(program, args, process.cwd(), { timeout: 20_000 });
    return result.code === 0 ? result.output.trim() : undefined;
  } catch {
    return undefined;
  }
}

async function browserInstalled(kind: "msedge" | "chrome") {
  if (process.platform !== "win32") return undefined;
  const roots = [process.env["ProgramFiles(x86)"], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean) as string[];
  const rel = kind === "msedge" ? ["Microsoft", "Edge", "Application", "msedge.exe"] : ["Google", "Chrome", "Application", "chrome.exe"];
  for (const root of roots) {
    try {
      await access(join(root, ...rel));
      return true;
    } catch {
      /* next */
    }
  }
  return false;
}

/**
 * One pass over everything Workstream depends on, each with a plain status and
 * what to do about it. Only reads: nothing is installed, signed in or changed.
 */
export async function healthCheck(input: {
  settings: Settings;
  projects: Project[];
  runtimes: Record<Engine, Runtime & { hasKey?: boolean }>;
  connections: Partial<Record<"azure" | "github", ProviderAccount>>;
  connectorsEnabled: number;
  connectorsConnected: number;
  dataDir: string;
}): Promise<HealthItem[]> {
  const items: HealthItem[] = [];
  const add = (item: HealthItem) => items.push(item);

  // Tools on this computer
  const nodeOut = await tool("node", ["--version"]);
  add(
    !nodeOut
      ? { id: "node", group: "This computer", label: "Node.js", status: "fail", detail: "Not found on PATH.", fix: "Install Node.js 22 or newer from nodejs.org, then restart Workstream." }
      : atLeast(version(nodeOut), [22])
        ? { id: "node", group: "This computer", label: "Node.js", status: "ok", detail: nodeOut }
        : { id: "node", group: "This computer", label: "Node.js", status: "warn", detail: `${nodeOut}: older than 22.`, fix: "Update Node.js to version 22 or newer." },
  );
  const gitOut = await tool("git", ["--version"]);
  add(
    !gitOut
      ? { id: "git", group: "This computer", label: "Git", status: "fail", detail: "Not found on PATH.", fix: "Install Git for Windows." }
      : atLeast(version(gitOut), [2, 36])
        ? { id: "git", group: "This computer", label: "Git", status: "ok", detail: gitOut.replace(/^git version /, "") }
        : {
            id: "git",
            group: "This computer",
            label: "Git",
            status: "warn",
            detail: `${gitOut}: older than 2.36, so the repository's commit hook cannot run before review.`,
            fix: "Update Git for Windows to 2.36 or newer.",
          },
  );
  for (const kind of ["msedge", "chrome"] as const) {
    const found = await browserInstalled(kind);
    if (found === undefined) continue;
    add({
      id: `browser-${kind}`,
      group: "This computer",
      label: kind === "msedge" ? "Microsoft Edge (for end-to-end tests)" : "Google Chrome (for end-to-end tests)",
      status: found ? "ok" : kind === "msedge" ? "warn" : "skip",
      detail: found ? "Installed." : "Not found.",
      ...(found || kind === "chrome" ? {} : { fix: "End-to-end tests use Edge by default. Choose Chrome in Tests > Options if Edge is missing." }),
    });
  }
  try {
    await stat(input.dataDir);
    add({ id: "data", group: "This computer", label: "Workstream data folder", status: "ok", detail: input.dataDir });
  } catch {
    add({ id: "data", group: "This computer", label: "Workstream data folder", status: "fail", detail: `${input.dataDir} is missing.`, fix: "Restart Workstream." });
  }

  // Agents
  const used = new Set(Object.values(input.settings.profiles).map((p) => p.engine ?? "codex"));
  const engineLabel: Record<Engine, string> = { codex: "Codex", claude: "Claude", copilot: "GitHub Copilot" };
  for (const engine of ["codex", "claude", "copilot"] as Engine[]) {
    const runtime = input.runtimes[engine];
    const inUse = used.has(engine);
    const ready = runtime.authenticated && (runtime.connected || engine !== "codex");
    add({
      id: `engine-${engine}`,
      group: "Agents",
      label: engineLabel[engine],
      status: ready ? "ok" : inUse ? "fail" : "skip",
      detail: ready
        ? `${runtime.accountLabel || "Signed in"} · ${runtime.models.length} models${inUse ? "" : " · not used by any role"}`
        : runtime.error || (inUse ? "Not connected or not signed in." : "Not used by any role."),
      ...(ready || !inUse ? {} : { fix: `Open Agents & models and connect ${engineLabel[engine]}.` }),
    });
  }

  // Git providers
  const providers = new Set(input.projects.filter((p) => !p.archived).map((p) => p.provider));
  for (const provider of ["azure", "github"] as const) {
    if (!providers.has(provider)) continue;
    const account = input.connections[provider];
    const name = provider === "azure" ? "Azure DevOps (az)" : "GitHub (gh)";
    add(
      !account || !account.cliInstalled
        ? { id: `provider-${provider}`, group: "Publishing", label: name, status: "fail", detail: "The CLI was not found.", fix: provider === "azure" ? "Install the Azure CLI, then open Connections." : "Install the GitHub CLI, then open Connections." }
        : account.signedIn
          ? { id: `provider-${provider}`, group: "Publishing", label: name, status: "ok", detail: `Signed in as ${account.account ?? account.displayName ?? "your account"}.` }
          : { id: `provider-${provider}`, group: "Publishing", label: name, status: "fail", detail: account.error ?? "Not signed in.", fix: "Open Connections > Git providers and sign in." },
    );
  }

  // Projects
  for (const project of input.projects.filter((p) => !p.archived)) {
    const group = `Project: ${project.name}`;
    try {
      await access(project.path);
    } catch {
      add({ id: `project-${project.id}-path`, group, label: "Repository folder", status: "fail", detail: `${project.path} is missing.`, fix: "Reconnect the project in Projects." });
      continue;
    }
    const target = await git(project.path, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${project.targetBranch}`]).catch(() => "");
    add(
      target
        ? { id: `project-${project.id}-target`, group, label: `Target branch ${project.targetBranch}`, status: "ok", detail: `origin/${project.targetBranch} exists.` }
        : { id: `project-${project.id}-target`, group, label: `Target branch ${project.targetBranch}`, status: "warn", detail: `origin/${project.targetBranch} was not found locally.`, fix: "Fetch the repository, or fix the target branch in Projects." },
    );
    const skills = (project.skillInfo ?? []).filter((s) => !s.workflow).length;
    add({
      id: `project-${project.id}-skills`,
      group,
      label: "Agent skills",
      status: skills ? "ok" : "warn",
      detail: skills ? `${skills} skills.` : "No skills yet: agents only follow AGENTS.md and Workstream's rules.",
      ...(skills ? {} : { fix: "Agents & models > Generate skills." }),
    });
    const config = await repoConfig(project.path).catch(() => undefined);
    if (config) {
      const pw = await access(join(project.path, "node_modules", "playwright", "cli.js")).then(() => true, () => false);
      add({
        id: `project-${project.id}-e2e`,
        group,
        label: "End-to-end tests",
        status: pw ? (project.e2eAccount && !(project.e2eAccount.username && project.e2eAccount.password) ? "warn" : "ok") : "fail",
        detail: pw
          ? project.e2eAccount && !(project.e2eAccount.username && project.e2eAccount.password)
            ? `${config} found, but the test account is missing in .env.local.`
            : `${config} found.`
          : `${config} found, but Playwright is not installed.`,
        ...(pw ? (project.e2eAccount && !(project.e2eAccount.username && project.e2eAccount.password) ? { fix: "Add E2E_USERNAME and E2E_PASSWORD to .env.local." } : {}) : { fix: "Run npm install in the repository." }),
      });
    }
  }

  // Connectors
  if (input.connectorsEnabled)
    add({
      id: "connectors",
      group: "Connectors",
      label: "Connectors offered to agents",
      status: input.connectorsConnected >= input.connectorsEnabled ? "ok" : "warn",
      detail: `${input.connectorsConnected} of ${input.connectorsEnabled} connected.`,
      ...(input.connectorsConnected >= input.connectorsEnabled ? {} : { fix: "Open Connections > Connectors and reconnect the ones that are offline." }),
    });
  return items;
}
