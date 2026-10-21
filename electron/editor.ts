import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { execute } from "./process";

const exists = (path: string) => access(path).then(() => true, () => false);

/**
 * Finds VS Code's Code.exe on Windows: the per-user and machine-wide install
 * folders first, then the `code` command on PATH (its bin folder sits next to
 * Code.exe). Returns undefined when VS Code is not installed.
 */
export async function findVsCode(env: NodeJS.ProcessEnv = process.env) {
  const candidates = [
    env.LOCALAPPDATA && join(env.LOCALAPPDATA, "Programs", "Microsoft VS Code", "Code.exe"),
    env.ProgramFiles && join(env.ProgramFiles, "Microsoft VS Code", "Code.exe"),
    env["ProgramFiles(x86)"] && join(env["ProgramFiles(x86)"], "Microsoft VS Code", "Code.exe"),
  ].filter((path): path is string => Boolean(path));
  for (const path of candidates) if (await exists(path)) return path;
  const where = await execute("where.exe", ["code.cmd"], process.cwd(), { timeout: 10_000 }).catch(() => null);
  const cmd = where?.code === 0 ? where.stdout.split(/\r?\n/).find(Boolean)?.trim() : undefined;
  if (cmd) {
    const exe = join(dirname(dirname(cmd)), "Code.exe");
    if (await exists(exe)) return exe;
  }
  return undefined;
}

/**
 * Opens a folder in VS Code as its own process. Workstream's own Electron
 * variables are removed so VS Code does not start in Node mode.
 */
export async function openInVsCode(folder: string, openUrl: (url: string) => Promise<void>) {
  if (process.platform !== "win32") {
    // VS Code registers vscode:// on every platform; good enough outside Windows.
    await openUrl(`vscode://file/${encodeURI(folder.replace(/\\/g, "/"))}`);
    return "url" as const;
  }
  const exe = await findVsCode();
  if (!exe) {
    await openUrl(`vscode://file/${encodeURI(folder.replace(/\\/g, "/"))}`);
    return "url" as const;
  }
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^(ELECTRON_|VSCODE_)/i.test(key)),
  );
  const child = spawn(exe, ["--new-window", folder], {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
    shell: false,
    env,
  });
  child.unref();
  return "exe" as const;
}
