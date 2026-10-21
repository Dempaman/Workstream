import { build } from "esbuild";
const shared = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outdir: "dist-electron",
  outExtension: { ".js": ".cjs" },
  external: ["electron", "koffi"],
};
// Main process only: the Claude Agent SDK is ESM and reads import.meta.url at load time.
await build({
  ...shared,
  entryPoints: ["electron/main.ts"],
  define: { "import.meta.url": "__workstreamImportMetaUrl" },
  banner: {
    js: 'const __workstreamImportMetaUrl = require("node:url").pathToFileURL(__filename).href;',
  },
});
// The preload runs in Electron's sandbox, where only "electron" can be required. Keep it plain.
await build({ ...shared, entryPoints: ["electron/preload.ts"] });
// Guard: a sandboxed preload that requires anything else fails silently and
// the app falls back to "Browser preview" with no access to saved data.
const { readFile } = await import("node:fs/promises");
const preload = await readFile("dist-electron/preload.cjs", "utf8");
const requires = [...preload.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1]);
if (requires.some((name) => name !== "electron"))
  throw new Error(`Preload must only require electron, found: ${requires.join(", ")}`);
