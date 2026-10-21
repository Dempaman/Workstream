// Downloads the Windows Copilot runtime that ships with Workstream into
// build/copilot-runtime (packaged as resources/copilot-runtime). Its version
// must match @github/copilot-sdk in package.json.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const version = JSON.parse(readFileSync("package.json", "utf8")).devDependencies["@github/copilot-sdk"];
const work = mkdtempSync(join(tmpdir(), "copilot-runtime-"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const file = execFileSync(npm, ["pack", `@github/copilot-sdk-win32-x64@${version}`, "--silent"], { cwd: work, shell: process.platform === "win32" }).toString().trim().split("\n").pop();
execFileSync("tar", ["xzf", file], { cwd: work });
rmSync("build/copilot-runtime", { recursive: true, force: true });
renameSync(join(work, "package"), "build/copilot-runtime");
rmSync(work, { recursive: true, force: true });
console.log(`Copilot runtime ${version} ready in build/copilot-runtime`);
