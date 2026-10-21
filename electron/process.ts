import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

export function executable(name: string) {
  if (name.includes("/") || name.includes("\\")) return name;
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    for (const suffix of process.platform === "win32"
      ? [".exe", ".cmd", ""]
      : [""]) {
      const candidate = join(directory.replace(/^"|"$/g, ""), name + suffix);
      try {
        accessSync(candidate, constants.F_OK);
        return candidate;
      } catch {
        /* next path */
      }
    }
  }
  return name;
}

export function execute(
  program: string,
  args: string[],
  cwd: string,
  options: {
    signal?: AbortSignal;
    timeout?: number;
    input?: string;
    windowsHide?: boolean;
    /** Extra environment for this process only. Used for short-lived Git auth config; never logged. */
    env?: Record<string, string>;
    /** Streams combined output while the process runs (for interactive sign-in codes). */
    onOutput?: (text: string) => void;
    /** Keeps stdin open and hands over a writer (for pasting a sign-in code). */
    onStdin?: (writer: { write(text: string): void; end(): void }) => void;
  } = {},
): Promise<{ code: number; output: string; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let file = executable(program);
    let parameters = args;
    // npm/npx batch launchers cannot be passed to execFile on Windows. Run their JS entrypoint through Node.
    if (process.platform === "win32" && /^(npm|npx)$/.test(program)) {
      const cli = join(
        file,
        "..",
        "node_modules",
        "npm",
        "bin",
        `${program}-cli.js`,
      );
      file = executable("node");
      parameters = [cli, ...args];
    }
    if (/\.cmd$/i.test(file)) {
      reject(new Error(`A native executable is required for ${program}.`));
      return;
    }
    const child = spawn(file, parameters, {
      cwd,
      windowsHide: options.windowsHide ?? true,
      shell: false,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...options.env },
      signal: options.signal,
    });
    let output = "";
    let stdout = "";
    let stderr = "";
    const append = (data: Buffer) => {
      output = (output + data.toString()).slice(-2_000_000);
      options.onOutput?.(data.toString());
    };
    child.stdout.on("data", (data: Buffer) => {
      stdout = (stdout + data.toString()).slice(-2_000_000);
      append(data);
    });
    child.stderr.on("data", (data: Buffer) => {
      stderr = (stderr + data.toString()).slice(-2_000_000);
      append(data);
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(
        new Error(`${program} timed out. Check the process before retrying.`),
      );
    }, options.timeout ?? 120_000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, output, stdout, stderr });
    });
    if (options.onStdin)
      options.onStdin({
        write: (text) => {
          if (!child.stdin.destroyed) child.stdin.write(text);
        },
        end: () => child.stdin.end(),
      });
    else if (options.input) child.stdin.end(options.input);
    else child.stdin.end();
  });
}
export async function git(
  cwd: string,
  args: string[],
  options?: {
    input?: string;
    signal?: AbortSignal;
    env?: Record<string, string>;
  },
) {
  const result = await execute("git", args, cwd, options);
  if (result.code !== 0)
    throw new Error(result.output || `Git failed: ${args[0]}`);
  return result.stdout.trim();
}
