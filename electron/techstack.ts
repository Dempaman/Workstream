import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { detectStack } from "../shared/techstack";

/** Reads package.json and the root listing; read-only and never fails a caller. */
export async function readStack(root: string) {
  try {
    const entries = (await readdir(root, { withFileTypes: true })).map((entry) => entry.name);
    const workflows = await readdir(join(root, ".github", "workflows")).catch(() => []);
    if (workflows.length) entries.push(".github/workflows");
    const pkg = await readFile(join(root, "package.json"), "utf8")
      .then((text) => JSON.parse(text) as { dependencies?: object; devDependencies?: object })
      .catch(() => undefined);
    const packages = [...Object.keys(pkg?.dependencies ?? {}), ...Object.keys(pkg?.devDependencies ?? {})];
    return detectStack(packages, entries);
  } catch {
    return [];
  }
}
