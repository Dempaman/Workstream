import { access, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { E2eResult, E2eSettings, RepoTest } from "../shared/types";
import { execute } from "./process";

/** Environment variable names the recorded test reads the account from. */
export const userVar = "WORKSTREAM_E2E_USERNAME";
export const passwordVar = "WORKSTREAM_E2E_PASSWORD";

/** Workstream's own folder for a project's journeys (outside the repository). */
export const e2eDir = (dataDir: string, projectId: string) =>
  join(dataDir, "e2e", projectId.replace(/[^A-Za-z0-9_-]/g, "_"));
export const journeyFile = (dir: string, id: string) => {
  if (!/^[A-Za-z0-9-]{6,64}$/.test(id)) throw new Error("Unknown journey.");
  return join(dir, "journeys", `${id}.spec.mjs`);
};

/**
 * Journeys may only run against this computer. On this setup localhost is the
 * dev server, which is wired to the test backend, so a test can never reach a
 * live site.
 */
export function assertLocal(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Enter a full address, such as http://localhost:3000/sv/.");
  }
  if (!/^https?:$/.test(parsed.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname))
    throw new Error("End-to-end tests only run against localhost, which is connected to the test environment.");
  return parsed;
}

/** Every page.goto in a journey must stay on localhost. */
export function remoteNavigations(code: string) {
  const urls = [...code.matchAll(/\.goto\(\s*(['"`])(.*?)\1/g)].map((m) => m[2]);
  return urls.filter((url) => {
    try {
      assertLocal(url);
      return false;
    } catch {
      return !url.startsWith("/");
    }
  });
}

const literal = (value: string) => new RegExp(`(['"\`])${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\1`, "g");

/**
 * Cleans a Playwright recording: the typed user name and password become
 * environment variables so the account never sits in the file.
 */
export function cleanRecording(code: string, account: { username?: string; password?: string }) {
  let next = code.replace(/\r\n/g, "\n");
  if (account.password) next = next.replace(literal(account.password), `process.env.${passwordVar}`);
  if (account.username) next = next.replace(literal(account.username), `process.env.${userVar}`);
  return next;
}

/** True when the recording still has the password in it (it should never be saved like that). */
export const containsSecret = (code: string, password?: string) => Boolean(password && code.includes(password));

/** Runs Node scripts with Workstream's own runtime, so a separate Node install is not required. */
const node = process.execPath;
const nodeEnv = { ELECTRON_RUN_AS_NODE: "1" };

/** Finds the installed Playwright in the repository (ecommerce-frontend ships one with Storybook). */
export async function playwrightCli(repo: string) {
  const cli = join(repo, "node_modules", "playwright", "cli.js");
  try {
    await access(cli);
    await access(join(repo, "node_modules", "playwright", "test.mjs"));
  } catch {
    throw new Error("Playwright is not installed in this project. Run npm install in the repository first.");
  }
  return cli;
}

/** Opens Playwright's recorder in your browser. Resolves with the recorded code when you close the window. */
export async function record(
  repo: string,
  dir: string,
  settings: E2eSettings,
  url: string,
  signal?: AbortSignal,
) {
  const cli = await playwrightCli(repo);
  await mkdir(join(dir, "recording"), { recursive: true });
  const output = join(dir, "recording", `recording-${Date.now()}.spec.ts`);
  const result = await execute(
    node,
    [cli, "codegen", "--target", "playwright-test", "--channel", settings.browser, "--viewport-size", "1366,900", "--output", output, assertLocal(url).href],
    dir,
    { signal, windowsHide: true, env: nodeEnv, timeout: 3 * 60 * 60_000 },
  ).catch((error: unknown) => {
    if (signal?.aborted) throw new Error("Recording stopped.");
    throw error;
  });
  const code = await readFile(output, "utf8").catch(() => "");
  await rm(output, { force: true });
  if (!code.trim()) throw new Error(result.code ? `The recorder stopped: ${result.output.slice(-400)}` : "Nothing was recorded.");
  return code;
}

/** The copy that actually runs: imports point at the project's own Playwright. */
export function runnableCopy(code: string, repo: string) {
  const testModule = pathToFileURL(join(repo, "node_modules", "playwright", "test.mjs")).href;
  return code.replace(/from\s+(['"])@playwright\/test\1/g, `from ${JSON.stringify(testModule)}`);
}

interface ReportResult {
  status: string;
  duration: number;
  startTime?: string;
  error?: { message?: string };
  errors?: { message?: string }[];
  attachments?: { name: string; path?: string; contentType?: string }[];
}
interface ReportSuite {
  specs?: { tests?: { results?: ReportResult[] }[] }[];
  suites?: ReportSuite[];
}
const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/** Reads Playwright's JSON report for one journey. */
export function parseReport(report: { suites?: ReportSuite[]; errors?: { message?: string }[] }, startedAt: string, redact: (text: string) => string): E2eResult {
  const results: ReportResult[] = [];
  const walk = (suite: ReportSuite) => {
    for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) results.push(...(test.results ?? []));
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites ?? []) walk(suite);
  const last = results.at(-1);
  if (!last) {
    const message = report.errors?.map((e) => e.message).join("\n") || "Playwright found no test in the journey.";
    return { status: "error", startedAt, durationMs: 0, error: redact(message.replace(ansi, "")).slice(0, 1500) };
  }
  const find = (name: string, type?: string) =>
    [...(last.attachments ?? [])].reverse().find((a) => a.path && (a.name === name || (type && a.contentType?.startsWith(type))))?.path;
  const message = last.error?.message ?? last.errors?.[0]?.message;
  return {
    status: last.status === "passed" ? "passed" : last.status === "failed" || last.status === "timedOut" ? "failed" : "error",
    startedAt,
    durationMs: last.duration,
    ...(message ? { error: redact(message.replace(ansi, "")).split("\n").slice(0, 12).join("\n").slice(0, 1500) } : {}),
    ...(find("screenshot", "image/") ? { screenshot: find("screenshot", "image/") } : {}),
    ...(find("trace") ? { trace: find("trace") } : {}),
    ...(find("video", "video/") ? { video: find("video", "video/") } : {}),
  };
}

/** Runs one journey with Playwright's test runner and returns its result. */
export async function runJourney(options: {
  repo: string;
  dir: string;
  journeyId: string;
  settings: E2eSettings;
  password?: string;
  signal?: AbortSignal;
  onOutput?: (line: string) => void;
}): Promise<E2eResult> {
  const { repo, dir, journeyId, settings, password } = options;
  const startedAt = new Date().toISOString();
  const base = assertLocal(settings.baseUrl);
  const cli = await playwrightCli(repo);
  const code = await readFile(journeyFile(dir, journeyId), "utf8");
  const remote = remoteNavigations(code);
  if (remote.length) throw new Error(`This journey opens ${remote[0]}, which is not localhost. Record it again on the test site.`);
  const stamp = startedAt.replace(/[:.]/g, "-");
  const runDir = join(dir, "runs", `${stamp}-${journeyId}`);
  await mkdir(join(runDir, "tests"), { recursive: true });
  await writeFile(join(runDir, "tests", `${journeyId}.spec.mjs`), runnableCopy(code, repo));
  const reportFile = join(runDir, "report.json");
  const config = {
    testDir: join(runDir, "tests"),
    outputDir: join(runDir, "artifacts"),
    timeout: 5 * 60_000,
    expect: { timeout: 15_000 },
    retries: 0,
    workers: 1,
    reporter: [["json", { outputFile: reportFile }], ["line"]],
    use: {
      baseURL: base.origin,
      channel: settings.browser,
      headless: !settings.headed,
      viewport: { width: 1366, height: 900 },
      screenshot: "on",
      trace: "retain-on-failure",
      video: "retain-on-failure",
      actionTimeout: 30_000,
      navigationTimeout: 60_000,
    },
  };
  const configFile = join(runDir, "playwright.config.mjs");
  await writeFile(configFile, `export default ${JSON.stringify(config, null, 2)};\n`);
  const redact = (text: string) => (password ? text.split(password).join("********") : text);
  const result = await execute(node, [cli, "test", "--config", configFile], runDir, {
    signal: options.signal,
    timeout: 30 * 60_000,
    env: { ...nodeEnv, [userVar]: settings.username ?? "", [passwordVar]: password ?? "", PLAYWRIGHT_HTML_OPEN: "never", FORCE_COLOR: "0" },
    onOutput: (text) => {
      for (const line of redact(text).split(/\r?\n/).map((l) => l.replace(ansi, "").trim()).filter(Boolean)) options.onOutput?.(line.slice(0, 300));
    },
  }).catch((error: unknown) => {
    if (options.signal?.aborted) throw new Error("Stopped.");
    throw error;
  });
  const report = await readFile(reportFile, "utf8").then((text) => JSON.parse(text), () => undefined);
  if (!report)
    return {
      status: "error",
      startedAt,
      durationMs: Date.now() - Date.parse(startedAt),
      error: redact(result.output.replace(ansi, "")).slice(-1500) || "Playwright did not start.",
    };
  return parseReport(report, startedAt, redact);
}

/** Keeps the latest runs per project and removes older run folders. */
export async function pruneRuns(dir: string, keep = 20, folder = "runs") {
  const runs = (await readdir(join(dir, folder)).catch(() => [])).sort();
  for (const old of runs.slice(0, Math.max(0, runs.length - keep))) await rm(join(dir, folder, old), { recursive: true, force: true });
}
export const pruneRunsIn = (dir: string) => pruneRuns(dir, 20, "repo-runs");

/** A repository-relative test file, refusing paths that leave the repository. */
export function repoFile(repo: string, file: string) {
  const full = resolve(repo, file);
  const rel = relative(resolve(repo), full);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("Unknown test file.");
  return full;
}

/** Opens Playwright's trace viewer for a failed or passed run. */
export async function showTrace(repo: string, trace: string) {
  const cli = await playwrightCli(repo);
  void execute(node, [cli, "show-trace", trace], repo, { env: nodeEnv, timeout: 12 * 60 * 60_000 }).catch(() => {});
}

/** The repository's own Playwright config, when it has one (then Workstream runs that suite). */
export async function repoConfig(repo: string) {
  for (const name of ["playwright.config.ts", "playwright.config.mts", "playwright.config.js", "playwright.config.mjs"]) {
    try {
      await access(join(repo, name));
      return name;
    } catch {
      /* next */
    }
  }
  return undefined;
}

export type { RepoTest } from "../shared/types";
interface SpecNode {
  title: string;
  file: string;
  line: number;
  tests?: { status?: string; annotations?: { type: string }[]; results?: ReportResult[] }[];
}
interface SuiteNode {
  specs?: SpecNode[];
  suites?: SuiteNode[];
}

/** Every test in a Playwright JSON report, with its result when it ran. */
export function repoTests(report: { suites?: SuiteNode[] }, startedAt: string, redact: (text: string) => string, prefix = ""): RepoTest[] {
  const out: RepoTest[] = [];
  const walk = (suite: SuiteNode) => {
    for (const spec of suite.specs ?? []) {
      const test = spec.tests?.[0];
      const last = test?.results?.at(-1);
      const skipped = test?.status === "skipped" || test?.annotations?.some((a) => a.type === "fixme" || a.type === "skip");
      const file = `${prefix}${spec.file.replace(/\\/g, "/")}`;
      out.push({
        id: `${file}:${spec.line}`,
        title: spec.title,
        file,
        line: spec.line,
        ...(last
          ? {
              result: skipped
                ? { status: "skipped" as const, startedAt, durationMs: last.duration }
                : parseReport({ suites: [{ specs: [{ tests: [{ results: [last] }] }] }] }, startedAt, redact),
            }
          : {}),
      });
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites ?? []) walk(suite);
  return out;
}

/**
 * Runs the repository's own E2E suite (npm run test:e2e's Playwright) on what
 * the repository folder has checked out. Workstream passes the test account and
 * address through the environment and keeps reports and artifacts in its own
 * folder, so nothing is written into the repository.
 */
export async function runRepoSuite(options: {
  repo: string;
  dir: string;
  settings: E2eSettings;
  password?: string;
  only?: string[];
  list?: boolean;
  signal?: AbortSignal;
  onOutput?: (line: string) => void;
}) {
  const { repo, dir, settings, password } = options;
  const startedAt = new Date().toISOString();
  assertLocal(settings.baseUrl);
  const cli = await playwrightCli(repo);
  const config = await repoConfig(repo);
  if (!config) throw new Error("This repository has no playwright.config file.");
  const runDir = join(dir, "repo-runs", startedAt.replace(/[:.]/g, "-"));
  await mkdir(runDir, { recursive: true });
  const reportFile = join(runDir, "report.json");
  const redact = (text: string) => (password ? text.split(password).join("********") : text);
  const args = [cli, "test", "--config", config, "--reporter=json,line", "--output", join(runDir, "artifacts")];
  if (options.list) args.push("--list");
  else if (settings.headed) args.push("--headed");
  for (const id of options.only ?? []) {
    if (!/^[\w./ -]+:\d+$/.test(id)) throw new Error("Unknown test.");
    args.push(id);
  }
  const result = await execute(node, args, repo, {
    signal: options.signal,
    // Long enough for the dev server to start and every journey to finish.
    timeout: options.list ? 2 * 60_000 : 60 * 60_000,
    env: {
      ...nodeEnv,
      E2E_BASE_URL: settings.baseUrl,
      E2E_BROWSER: settings.browser,
      ...(settings.username ? { E2E_USERNAME: settings.username } : {}),
      ...(password ? { E2E_PASSWORD: password } : {}),
      PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile,
      PLAYWRIGHT_HTML_OPEN: "never",
      FORCE_COLOR: "0",
    },
    onOutput: (text) => {
      for (const line of redact(text).split(/\r?\n/).map((l) => l.replace(ansi, "").trim()).filter(Boolean)) options.onOutput?.(line.slice(0, 300));
    },
  }).catch((error: unknown) => {
    if (options.signal?.aborted) throw new Error("Stopped.");
    throw error;
  });
  const report = await readFile(reportFile, "utf8").then((text) => JSON.parse(text), () => undefined);
  if (!report) throw new Error(redact(result.output.replace(ansi, "")).slice(-1500) || "Playwright did not start.");
  const errors = (report.errors ?? []).map((e: { message?: string }) => redact(e.message ?? "").replace(ansi, "")).filter(Boolean);
  // Spec files are relative to the suite's testDir; make them relative to the repository.
  const rootDir = typeof report.config?.rootDir === "string" ? relative(repo, report.config.rootDir).replace(/\\/g, "/") : "";
  const prefix = rootDir && !rootDir.startsWith("..") ? `${rootDir}/` : "";
  return { startedAt, tests: repoTests(report, startedAt, redact, prefix), error: errors.join("\n").slice(0, 1500) || undefined };
}

/** Saves a recording into the repository's e2e folder, with the account read from the environment. */
export async function saveToRepo(repo: string, name: string, code: string) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "journey";
  const file = join(repo, "e2e", `${slug}.spec.ts`);
  try {
    await access(file);
    throw new Error(`e2e/${slug}.spec.ts already exists. Choose another name.`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("already exists")) throw error;
  }
  await mkdir(join(repo, "e2e"), { recursive: true });
  const body = code
    .replace(/from\s+(['"])@playwright\/test\1/g, 'from "playwright/test"')
    .replace(new RegExp(`process\\.env\\.${userVar}`, "g"), "process.env.E2E_USERNAME!")
    .replace(new RegExp(`process\\.env\\.${passwordVar}`, "g"), "process.env.E2E_PASSWORD!")
    .replace(/test\((['"])test\1/, `test(${JSON.stringify(name)}`);
  await writeFile(file, body);
  return `e2e/${slug}.spec.ts`;
}
