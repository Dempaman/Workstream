import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { findVsCode } from "../electron/editor";

describe("Open in VS Code", () => {
  it("finds a per-user VS Code install", async () => {
    const local = await mkdtemp(join(tmpdir(), "ws-vscode-"));
    const folder = join(local, "Programs", "Microsoft VS Code");
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "Code.exe"), "");
    expect(await findVsCode({ LOCALAPPDATA: local })).toBe(join(folder, "Code.exe"));
  });
  it("returns nothing when VS Code is not installed", async () => {
    const empty = await mkdtemp(join(tmpdir(), "ws-novscode-"));
    expect(await findVsCode({ LOCALAPPDATA: empty, ProgramFiles: empty })).toBeUndefined();
  });
});
