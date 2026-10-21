export interface DiffLine {
  kind: "add" | "remove" | "context" | "meta";
  text: string;
  oldLine?: number;
  newLine?: number;
}
export interface DiffFile {
  path: string;
  lines: DiffLine[];
  added: number;
  removed: number;
}
function unquote(path: string) {
  try {
    return path.startsWith('"') ? (JSON.parse(path) as string) : path;
  } catch {
    return path;
  }
}
export function parseDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | undefined;
  let oldLine = 0,
    newLine = 0,
    inHunk = false,
    legacyNew = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ") || line.startsWith("--- New file: ")) {
      legacyNew = line.startsWith("--- New file: ");
      const path = legacyNew
        ? line.slice(14)
        : unquote(
            line.match(/ ("b\/.*"|b\/.*)$/)?.[1] ?? "Changed file",
          ).replace(/^b\//, "");
      file = { path, lines: [], added: 0, removed: 0 };
      files.push(file);
      inHunk = legacyNew;
      oldLine = 0;
      newLine = 1;
      continue;
    }
    if (!file) continue;
    if (!legacyNew && line.startsWith("+++ ")) {
      const path = unquote(line.slice(4).split("\t")[0]);
      if (path !== "/dev/null") file.path = path.replace(/^b\//, "");
      continue;
    }
    if (!legacyNew && line.startsWith("--- ")) continue;
    const hunk =
      !legacyNew && /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      file.lines.push({ kind: "meta", text: line });
      continue;
    }
    if (legacyNew) {
      file.added++;
      file.lines.push({ kind: "add", text: line, newLine: newLine++ });
    } else if (inHunk && line.startsWith("+")) {
      file.added++;
      file.lines.push({ kind: "add", text: line.slice(1), newLine: newLine++ });
    } else if (inHunk && line.startsWith("-")) {
      file.removed++;
      file.lines.push({
        kind: "remove",
        text: line.slice(1),
        oldLine: oldLine++,
      });
    } else if (inHunk && line.startsWith(" "))
      file.lines.push({
        kind: "context",
        text: line.slice(1),
        oldLine: oldLine++,
        newLine: newLine++,
      });
    else if (line) file.lines.push({ kind: "meta", text: line });
  }
  return files;
}
