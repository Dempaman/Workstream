import { spawn } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Picks the project's dev script and package manager from package.json and the lockfile. */
export async function detectDevCommand(repo: string) {
  const pkg = JSON.parse(await readFile(join(repo, "package.json"), "utf8").catch(() => "{}")) as {
    scripts?: Record<string, string>;
  };
  const script = ["dev", "start", "serve"].find((name) => pkg.scripts?.[name]);
  if (!script)
    throw new Error("No dev, start or serve script was found in package.json. Start the site yourself.");
  const has = (file: string) => access(join(repo, file)).then(() => true, () => false);
  const manager = (await has("pnpm-lock.yaml")) ? "pnpm" : (await has("yarn.lock")) ? "yarn" : "npm";
  return { manager, script };
}

export const localUrlPattern =
  /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d{2,5})?(?:\/[^\s'"]*)?/i;
const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, "g");

/** Finds the first local URL a dev server printed. */
export function findLocalUrl(log: string) {
  const match = log.replace(ansi, "").match(localUrlPattern)?.[0];
  return match?.replace("0.0.0.0", "localhost").replace(/[.,)]+$/, "");
}

const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;

/**
 * Opens a visible PowerShell window in the repository running the dev script,
 * mirrored to a log file so Workstream can spot the local URL. You stop the
 * server by closing the window. The script name comes from package.json and is
 * validated; paths are quoted for PowerShell.
 */
export async function launchDevServer(repo: string, logFile: string, command: { manager: string; script: string }) {
  if (process.platform !== "win32")
    throw new Error("Starting the dev server from Workstream is available on Windows.");
  if (!/^[A-Za-z0-9:_-]+$/.test(command.script) || !/^(npm|pnpm|yarn)$/.test(command.manager))
    throw new Error("Unexpected dev command.");
  await writeFile(logFile, "");
  const script = [
    `$Host.UI.RawUI.WindowTitle = ${quote(`Workstream dev server: ${command.manager} run ${command.script}`)}`,
    `Set-Location -LiteralPath ${quote(repo)}`,
    // .cmd launchers avoid PowerShell execution-policy blocks on npm.ps1.
    `& ${command.manager}.cmd run ${command.script} 2>&1 | Tee-Object -FilePath ${quote(logFile)}`,
  ].join("; ");
  const child = spawn(
    "powershell.exe",
    ["-NoExit", "-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
    { cwd: repo, detached: true, stdio: "ignore", windowsHide: false, shell: false },
  );
  child.unref();
}

/** Watches the log for up to three minutes and reports the local URL once. */
export function watchForUrl(logFile: string, onUrl: (url: string) => void, timeoutMs = 3 * 60_000) {
  const started = Date.now();
  const timer = setInterval(() => {
    void readFile(logFile, "utf8")
      .then((log) => {
        const url = findLocalUrl(log);
        if (url) {
          clearInterval(timer);
          onUrl(url);
        } else if (Date.now() - started > timeoutMs) clearInterval(timer);
      })
      .catch(() => {
        if (Date.now() - started > timeoutMs) clearInterval(timer);
      });
  }, 1000);
  return () => clearInterval(timer);
}
