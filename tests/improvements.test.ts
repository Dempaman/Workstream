import { describe, expect, it } from "vitest";
import { parseDiff } from "../src/lib/diff";
import { decodeImage } from "../electron/attachments";
import { parseLimits } from "../electron/telemetry";
import { relevantMemories } from "../electron/memory";
import type { Run } from "../shared/types";

describe("PR diff parsing", () => {
  it("tracks both line numbers across changes and separate hunks", () => {
    const [file] = parseDiff(
      "diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -10,2 +10,2 @@\n-old\n+new\n kept\n@@ -20 +20 @@\n-second\n+replacement\n",
    );
    expect(file.added).toBe(2);
    expect(file.removed).toBe(2);
    expect(file.lines[1]).toMatchObject({ oldLine: 10, kind: "remove" });
    expect(file.lines[2]).toMatchObject({ newLine: 10, kind: "add" });
    expect(file.lines[3]).toMatchObject({
      oldLine: 11,
      newLine: 11,
      kind: "context",
    });
    expect(file.lines.at(-1)).toMatchObject({ newLine: 20 });
  });
  it("supports quoted names, new files, deleted files, binary changes, and legacy runs", () => {
    const files = parseDiff(
      'diff --git "a/new file.txt" "b/new file.txt"\n--- /dev/null\n+++ "b/new file.txt"\n@@ -0,0 +1 @@\n+hello\ndiff --git a/deleted.txt b/deleted.txt\n--- a/deleted.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-gone\ndiff --git a/image.png b/image.png\nBinary files differ\n--- New file: old.txt\nlegacy',
    );
    expect(files.map((file) => file.path)).toEqual([
      "new file.txt",
      "deleted.txt",
      "image.png",
      "old.txt",
    ]);
    expect(files[0].added).toBe(1);
    expect(files[1].removed).toBe(1);
    expect(files[2].lines[0].text).toBe("Binary files differ");
    expect(files[3].lines[0]).toMatchObject({ kind: "add", text: "legacy" });
  });
});
describe("usage and attachment boundaries", () => {
  it("prefers multi-bucket usage and preserves unavailable resets", () => {
    const buckets = parseLimits({
      rateLimits: { limitId: "legacy", primary: null },
      rateLimitsByLimitId: {
        codex: {
          primary: { usedPercent: 75, windowDurationMins: 300, resetsAt: 123 },
          secondary: null,
        },
        another: { primary: { usedPercent: 0 } },
      },
    });
    expect(buckets.map((bucket) => bucket.id)).toEqual(["codex", "another"]);
    expect(buckets[0].primary?.usedPercent).toBe(75);
    expect(buckets[1].primary?.resetsAt).toBeNull();
    expect(parseLimits({ rateLimits: null })).toEqual([]);
  });
  it("rejects non-image payloads even if their declared MIME type is allowed", () => {
    expect(() => decodeImage("data:image/png;base64,SGVsbG8=")).toThrow(
      "content",
    );
    expect(() => decodeImage("data:image/svg+xml;base64,SGVsbG8=")).toThrow(
      "PNG",
    );
    expect(() =>
      decodeImage(
        `data:image/png;base64,${Buffer.alloc(4 * 1024 * 1024 + 1).toString("base64")}`,
      ),
    ).toThrow("4 MB");
  });
});
it("retrieves bounded related memory from the same project only", () => {
  const run = {
    id: "current",
    projectId: "one",
    title: "Fix market selector",
    description: "country navigation",
  } as Run;
  const candidates = [
    {
      id: "related",
      projectId: "one",
      title: "Market selector",
      memory: "Country navigation details",
      updatedAt: "2026-10-14",
    },
    {
      id: "other-project",
      projectId: "two",
      title: "Market selector",
      memory: "Country",
      updatedAt: "2026-10-14",
    },
    {
      id: "irrelevant",
      projectId: "one",
      title: "Fonts",
      memory: "Typography",
      updatedAt: "2026-10-14",
    },
  ] as Run[];
  expect(relevantMemories(run, candidates).map((memory) => memory.id)).toEqual([
    "related",
  ]);
});
