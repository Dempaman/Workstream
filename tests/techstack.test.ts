import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectStack, techRules, toolIcons } from "../shared/techstack";
import { readStack } from "../electron/techstack";
import { existsSync } from "node:fs";

describe("technology detection", () => {
  it("recognises a React + MUI + TypeScript repository like ecommerce-frontend", async () => {
    const root = await mkdtemp(join(tmpdir(), "workstream-stack-"));
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        dependencies: { react: "19", "@mui/material": "7", "@tanstack/react-query": "5", zustand: "5", i18next: "25" },
        devDependencies: { typescript: "5", vite: "7", eslint: "9", "@storybook/react-vite": "9", playwright: "1", vitest: "3" },
      }),
    );
    for (const file of ["tsconfig.json", "package-lock.json", "Dockerfile", "azure-pipelines-pr.yml"]) await writeFile(join(root, file), "");
    await mkdir(join(root, ".github", "workflows"), { recursive: true });
    await writeFile(join(root, ".github", "workflows", "ci.yml"), "");
    const stack = await readStack(root);
    for (const id of ["typescript", "node", "react", "mui", "vite", "eslint", "storybook", "playwright", "npm", "docker", "azure-pipelines", "github-actions", "tanstack-query", "zustand", "vitest"])
      expect(stack).toContain(id);
    expect(stack).not.toContain("javascript");
    expect(stack).not.toContain("nextjs");
  });
  it("shows JavaScript only without TypeScript, and nothing for an empty folder", async () => {
    expect(detectStack(["express"], ["package.json"])).toEqual(["javascript", "node", "express"]);
    expect(await readStack(join(tmpdir(), "does-not-exist-xyz"))).toEqual([]);
  });
  it("has an icon file for every rule and tool that names one", () => {
    for (const rule of techRules) if (rule.icon) expect(existsSync(join("src/assets/tech", `${rule.id}.svg`))).toBe(true);
    for (const id of Object.keys(toolIcons)) expect(existsSync(join("src/assets/tech", `${id}.svg`))).toBe(true);
  });
});
