import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { Store } from "../electron/store";
import type { Run } from "../shared/types";

describe("durable workflow recovery", () => {
  it("migrates existing data to light mode and restores a saved dark preference", () => {
    const directory = mkdtempSync(join(tmpdir(), "workstream-theme-"));
    const store = new Store(directory);
    const legacy = { ...store.state, theme: undefined };
    writeFileSync(join(directory, "state.json"), JSON.stringify(legacy));
    const migrated = new Store(directory);
    expect(migrated.state.theme).toBe("light");
    migrated.state.theme = "dark";
    migrated.save();
    expect(new Store(directory).state.theme).toBe("dark");
  });
  it("preserves interrupted work and requires explicit recovery", () => {
    const directory = mkdtempSync(join(tmpdir(), "workstream-store-"));
    const store = new Store(directory);
    store.state.runs.push({
      id: "interrupted",
      status: "running",
      stage: "reviewing",
      worktree: "/preserved/worktree",
      baseCommit: "abc",
    } as Run);
    store.save();
    const restored = new Store(directory);
    expect(restored.state.runs[0]).toMatchObject({
      status: "blocked",
      stage: "reviewing",
      worktree: "/preserved/worktree",
      baseCommit: "abc",
    });
    expect(restored.state.runs[0].error).toContain("preserved");
  });
  it("never silently overwrites corrupt state", () => {
    const directory = mkdtempSync(join(tmpdir(), "workstream-store-"));
    writeFileSync(join(directory, "state.json"), "{broken");
    expect(() => new Store(directory)).toThrow();
    expect(readFileSync(join(directory, "state.json"), "utf8")).toBe("{broken");
  });
});
