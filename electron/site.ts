import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { executable } from "./process";
import { detectDevCommand } from "./devserver";
import { probeSite } from "./e2e";

export interface SiteState {
  status: "starting" | "running" | "stopped" | "failed";
  startedAt: string;
  command: string;
  /** Last lines the dev server printed. */
  log: string[];
  error?: string;
}

const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, "g");

/**
 * Dev servers Workstream started itself, one per project. They run hidden in
 * the background (no terminal window), their output is kept for the Tests page,
 * and Stop (or quitting Workstream) ends the whole process tree.
 */
export class Sites {
  private children = new Map<string, ChildProcess>();
  readonly states = new Map<string, SiteState>();
  constructor(private onChange: () => void) {}

  async start(projectId: string, repo: string, url: string) {
    if (this.children.has(projectId)) return;
    const dev = await detectDevCommand(repo);
    if (!/^[A-Za-z0-9:_-]+$/.test(dev.script)) throw new Error("Unexpected dev command.");
    let program = executable(dev.manager);
    let args = ["run", dev.script];
    // npm, pnpm and yarn are .cmd launchers on Windows; run npm's JS entrypoint through Node instead.
    if (process.platform === "win32" && dev.manager === "npm") {
      args = [join(program, "..", "node_modules", "npm", "bin", "npm-cli.js"), ...args];
      program = executable("node");
    } else if (process.platform === "win32") {
      throw new Error(`Starting ${dev.manager} from Workstream is not supported yet. Run ${dev.manager} run ${dev.script} yourself.`);
    }
    const state: SiteState = { status: "starting", startedAt: new Date().toISOString(), command: `${dev.manager} run ${dev.script}`, log: [] };
    this.states.set(projectId, state);
    // Its own process group elsewhere, so Stop can end the dev server and its children together.
    const child = spawn(program, args, { cwd: repo, windowsHide: true, shell: false, detached: process.platform !== "win32", env: { ...process.env, BROWSER: "none", FORCE_COLOR: "0" } });
    this.children.set(projectId, child);
    const append = (data: Buffer) => {
      const lines = data.toString().replace(ansi, "").split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
      state.log = [...state.log, ...lines].slice(-200);
      this.onChange();
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.on("error", (error) => {
      Object.assign(state, { status: "failed", error: error.message });
      this.children.delete(projectId);
      this.onChange();
    });
    child.on("exit", (code) => {
      this.children.delete(projectId);
      if (state.status !== "stopped")
        Object.assign(state, { status: "failed", error: `${state.command} stopped (exit code ${code ?? "unknown"}). See the log.` });
      this.onChange();
    });
    this.onChange();
    // Wait until the site answers (Vite usually needs a few seconds).
    const deadline = Date.now() + 3 * 60_000;
    while (Date.now() < deadline && this.children.get(projectId) === child) {
      if (await probeSite(url, 2000).catch(() => false)) {
        state.status = "running";
        this.onChange();
        return;
      }
      await new Promise((done) => setTimeout(done, 1500));
    }
    if (this.children.get(projectId) === child) {
      Object.assign(state, { status: "failed", error: `Nothing answered at ${url} within 3 minutes. See the log.` });
      this.stop(projectId);
    }
  }

  /** Ends the dev server and everything it started (Vite, esbuild). */
  stop(projectId: string) {
    const child = this.children.get(projectId);
    const state = this.states.get(projectId);
    if (state && state.status !== "failed") state.status = "stopped";
    this.children.delete(projectId);
    if (child?.pid) {
      if (process.platform === "win32")
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore", shell: false }).on("error", () => child.kill());
      else {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          child.kill();
        }
      }
    }
    this.onChange();
  }

  stopAll() {
    for (const id of [...this.children.keys()]) this.stop(id);
  }

  running(projectId: string) {
    return this.children.has(projectId);
  }
}
