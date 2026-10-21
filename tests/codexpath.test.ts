import { describe, expect, it } from "vitest";
import { missingHelpers, resolveCodexPath } from "../electron/codexpath";

const bin = "C:\\Users\\me\\AppData\\Local\\OpenAI\\Codex\\bin";
const fake = (folders: Record<string, { files: string[]; mtime: number }>) => ({
  list: (dir: string) => {
    if (dir === bin) return Object.keys(folders);
    const name = dir.split(/[\\/]/).pop()!;
    return folders[name]?.files ?? [];
  },
  mtime: (file: string) => {
    const parts = file.split(/[\\/]/);
    const folder = folders[parts.at(-2)!];
    return folder?.files.includes(parts.at(-1)!) ? folder.mtime : undefined;
  },
});
const all = ["codex.exe", "codex-command-runner.exe", "codex-code-mode-host.exe", "codex-windows-sandbox-setup.exe"];

describe("Codex app path", () => {
  it("follows a Codex app update when the configured folder lost its helpers", () => {
    const fs = fake({ old: { files: ["codex.exe"], mtime: 1 }, cur: { files: all, mtime: 2 }, rg: { files: ["rg.exe"], mtime: 2 } });
    const configured = `${bin}\\old\\codex.exe`;
    expect(missingHelpers(configured, fs)).toEqual(["codex-command-runner.exe", "codex-code-mode-host.exe"]);
    expect(resolveCodexPath(configured, fs)).toEqual({ path: `${bin}\\cur\\codex.exe`, switched: true });
  });
  it("keeps a complete configured copy and leaves other paths alone", () => {
    const fs = fake({ cur: { files: all, mtime: 2 } });
    expect(resolveCodexPath(`${bin}\\cur\\codex.exe`, fs)).toEqual({ path: `${bin}\\cur\\codex.exe`, switched: false });
    expect(resolveCodexPath("codex", fs)).toEqual({ path: "codex", switched: false });
    expect(missingHelpers("C:\\tools\\codex.exe", fs)).toEqual([]);
  });
  it("keeps the configured path when no complete install exists", () => {
    const fs = fake({ old: { files: ["codex.exe"], mtime: 1 } });
    expect(resolveCodexPath(`${bin}\\old\\codex.exe`, fs).switched).toBe(false);
  });
});
