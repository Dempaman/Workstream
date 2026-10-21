import { readdirSync, statSync } from "node:fs";
import { posix, win32 } from "node:path";

/** Helper programs the Codex app ships next to codex.exe; commands fail without them. */
export const codexHelpers = ["codex-command-runner.exe", "codex-code-mode-host.exe"];

type Fs = {
  list: (dir: string) => string[];
  mtime: (file: string) => number | undefined;
};
const realFs: Fs = {
  list: (dir) => {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  },
  mtime: (file) => {
    try {
      return statSync(file).mtimeMs;
    } catch {
      return undefined;
    }
  },
};

/** Which helper programs are missing next to a codex.exe from the Codex app (empty when complete or not the app's copy). */
export function missingHelpers(path: string, fs: Fs = realFs) {
  if (!isAppCopy(path)) return [];
  const present = new Set(fs.list(pathFor(path).dirname(path)).map((name) => name.toLowerCase()));
  return codexHelpers.filter((helper) => !present.has(helper));
}

/** Windows-style paths keep backslashes even when tests run elsewhere. */
const pathFor = (path: string) => (path.includes("\\") ? win32 : posix);
const isAppCopy = (path: string) =>
  /[\\/]OpenAI[\\/]Codex[\\/]bin[\\/][^\\/]+[\\/]codex(?:\.exe)?$/i.test(path);

/**
 * The Codex app keeps codex.exe in a versioned folder (…\OpenAI\Codex\bin\<hash>\)
 * and moves to a new folder when it updates, which can leave the old folder with
 * codex.exe but without its helper programs. When the configured path is such a
 * copy, use the newest folder that has codex.exe and its command runner.
 * Any other path (a PATH command, npm install, your own build) is used as is.
 */
export function resolveCodexPath(configured: string, fs: Fs = realFs) {
  if (!isAppCopy(configured)) return { path: configured, switched: false };
  const p = pathFor(configured);
  const bin = p.dirname(p.dirname(configured));
  const exe = p.basename(configured);
  const candidates = fs
    .list(bin)
    .map((folder) => p.join(bin, folder, exe))
    .map((path) => ({ path, mtime: fs.mtime(path), missing: missingHelpers(path, fs) }))
    .filter((c) => c.mtime !== undefined && !c.missing.includes("codex-command-runner.exe"))
    .sort((a, b) => b.mtime! - a.mtime! || a.missing.length - b.missing.length);
  const best = candidates[0];
  if (!best || best.path === configured) return { path: configured, switched: false };
  return { path: best.path, switched: true };
}
