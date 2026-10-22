import { access, mkdir, readFile, readdir } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import type { UnitFile, UnitResult } from "../shared/types";
import { execute } from "./process";

const node = process.execPath;
const nodeEnv = { ELECTRON_RUN_AS_NODE: "1" };
const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/** The project's unit test runner: Vitest or Jest, from its own node_modules. */
export async function unitRunner(repo: string) {
  const candidates = [
    { id: "vitest" as const, cli: join(repo, "node_modules", "vitest", "vitest.mjs") },
    { id: "jest" as const, cli: join(repo, "node_modules", "jest", "bin", "jest.js") },
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate.cli);
      return candidate;
    } catch {
      /* next */
    }
  }
  return undefined;
}

const skip = new Set(["node_modules", ".git", "build", "dist", "coverage", "storybook-static", "test-results", "playwright-report", ".worktrees", "e2e"]);
/** Unit test files in the repository (*.test.* and *.spec.* outside e2e folders), repository-relative. */
export async function listUnitFiles(repo: string) {
  const files: string[] = [];
  const walk = async (dir: string, rel: string, depth: number) => {
    if (depth > 10) return;
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (skip.has(entry.name) || entry.name.startsWith(".")) continue;
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(join(dir, entry.name), path, depth + 1);
      else if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) files.push(path);
    }
  };
  await walk(repo, "", 0);
  return files.sort();
}

interface JsonReport {
  testResults?: {
    name: string;
    status?: string;
    message?: string;
    startTime?: number;
    endTime?: number;
    assertionResults?: { fullName?: string; title?: string; status: string; failureMessages?: string[] }[];
  }[];
}

/** Reads the Jest-style JSON report Vitest and Jest both write. */
export function parseUnitReport(report: JsonReport, repo: string, startedAt: string): UnitFile[] {
  return (report.testResults ?? []).map((file) => {
    const rel = (isAbsolute(file.name) ? relative(repo, file.name) : file.name).replace(/\\/g, "/");
    const tests = file.assertionResults ?? [];
    const count = (status: string) => tests.filter((t) => t.status === status).length;
    const failed = count("failed");
    const failures = tests
      .filter((t) => t.status === "failed")
      .slice(0, 10)
      .map((t) => ({ title: t.fullName || t.title || "test", message: (t.failureMessages ?? []).join("\n").replace(ansi, "").split("\n").slice(0, 8).join("\n").slice(0, 1200) }));
    if (!tests.length && file.message) failures.push({ title: "File could not run", message: file.message.replace(ansi, "").slice(0, 1200) });
    const result: UnitResult = {
      status: failed || (!tests.length && file.message) ? "failed" : tests.length && count("passed") === 0 ? "skipped" : "passed",
      startedAt,
      durationMs: file.startTime && file.endTime ? file.endTime - file.startTime : 0,
      passed: count("passed"),
      failed,
      skipped: tests.length - count("passed") - failed,
      failures,
    };
    return { file: rel, result };
  });
}

/** Runs the unit tests (all, or the given repository-relative files) and returns per-file results. */
export async function runUnitTests(options: { repo: string; dir: string; files?: string[]; signal?: AbortSignal; onOutput?: (line: string) => void }) {
  const { repo } = options;
  const runner = await unitRunner(repo);
  if (!runner) throw new Error("No Vitest or Jest found in this repository's node_modules. Run npm install first.");
  for (const file of options.files ?? [])
    if (!/^[\w@./ -]+$/.test(file) || file.includes("..")) throw new Error("Unknown test file.");
  const startedAt = new Date().toISOString();
  const runDir = join(options.dir, "unit-runs", startedAt.replace(/[:.]/g, "-"));
  await mkdir(runDir, { recursive: true });
  const reportFile = join(runDir, "report.json");
  const args =
    runner.id === "vitest"
      ? [runner.cli, "run", "--reporter=json", "--reporter=default", `--outputFile.json=${reportFile}`, ...(options.files ?? [])]
      : [runner.cli, "--json", `--outputFile=${reportFile}`, ...(options.files ?? [])];
  const result = await execute(node, args, repo, {
    signal: options.signal,
    timeout: 30 * 60_000,
    env: { ...nodeEnv, CI: "1", FORCE_COLOR: "0" },
    onOutput: (text) => {
      for (const line of text.split(/\r?\n/).map((l) => l.replace(ansi, "").trim()).filter(Boolean)) options.onOutput?.(line.slice(0, 300));
    },
  }).catch((error: unknown) => {
    if (options.signal?.aborted) throw new Error("Stopped.");
    throw error;
  });
  const report = await readFile(reportFile, "utf8").then((text) => JSON.parse(text) as JsonReport, () => undefined);
  if (!report) throw new Error(result.output.replace(ansi, "").slice(-1500) || `${runner.id} did not start.`);
  return { runner: runner.id, startedAt, files: parseUnitReport(report, repo, startedAt) };
}
