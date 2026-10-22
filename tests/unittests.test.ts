import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { listUnitFiles, parseUnitReport } from "../electron/unittests";
import { Sites } from "../electron/site";
import { probeSite } from "../electron/e2e";

describe("unit tests on the Tests page", () => {
  it("lists unit test files outside e2e and node_modules", async () => {
    const repo = await mkdtemp(join(tmpdir(), "workstream-unit-"));
    for (const file of ["src/a.test.ts", "src/b/c.spec.tsx", "e2e/checkout.spec.ts", "node_modules/x/y.test.ts", "src/d.ts"]) {
      await mkdir(join(repo, file, ".."), { recursive: true });
      await writeFile(join(repo, file), "");
    }
    expect(await listUnitFiles(repo)).toEqual(["src/a.test.ts", "src/b/c.spec.tsx"]);
  });

  it("reads Vitest's JSON report per file", () => {
    const repo = "/repo";
    const files = parseUnitReport(
      {
        testResults: [
          { name: "/repo/src/a.test.ts", startTime: 1000, endTime: 1250, assertionResults: [{ fullName: "a works", status: "passed" }, { fullName: "a breaks", status: "failed", failureMessages: ["\u001b[31mAssertionError\u001b[39m: expected 1 to be 2"] }] },
          { name: "/repo/src/b.test.ts", assertionResults: [{ fullName: "b", status: "passed" }] },
          { name: "/repo/src/c.test.ts", message: "SyntaxError: Unexpected token", assertionResults: [] },
        ],
      },
      repo,
      "t",
    );
    expect(files.map((f) => [f.file, f.result?.status, f.result?.passed, f.result?.failed])).toEqual([
      ["src/a.test.ts", "failed", 1, 1],
      ["src/b.test.ts", "passed", 1, 0],
      ["src/c.test.ts", "failed", 0, 0],
    ]);
    expect(files[0].result?.durationMs).toBe(250);
    expect(files[0].result?.failures[0]).toEqual({ title: "a breaks", message: "AssertionError: expected 1 to be 2" });
    expect(files[2].result?.failures[0].title).toBe("File could not run");
  });

  it("starts the dev server in the background, sees it answer and stops it", async () => {
    const repo = await mkdtemp(join(tmpdir(), "workstream-site-"));
    await writeFile(join(repo, "server.cjs"), `require("node:http").createServer((q, r) => r.end("ok")).listen(${48731}, "127.0.0.1", () => console.log("ready on http://localhost:48731"))`);
    await writeFile(join(repo, "package.json"), JSON.stringify({ scripts: { start: "node server.cjs" } }));
    const sites = new Sites(() => {});
    await sites.start("p", repo, "http://localhost:48731/sv/");
    expect(sites.states.get("p")).toMatchObject({ status: "running", command: "npm run start" });
    expect(sites.states.get("p")?.log.join("\n")).toContain("ready on http://localhost:48731");
    sites.stop("p");
    await new Promise((done) => setTimeout(done, 500));
    expect(sites.states.get("p")?.status).toBe("stopped");
    expect(await probeSite("http://localhost:48731/", 1000)).toBe(false);
  }, 30_000);
});
