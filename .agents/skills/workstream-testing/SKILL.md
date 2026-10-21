---
name: workstream-testing
description: "Use when verifying Workstream's Electron and strict TypeScript behavior with Vitest, temporary Git fixtures, and Playwright desktop smoke scripts. Keep agent inference mocks distinct from live validation."
generated-by: workstream
generated-at: 2026-10-21T17:42:12.158Z
---

## Test layout

- Read `AGENTS.md` for execution and data-isolation requirements.
- `vitest.config.ts` includes `tests/**/*.test.ts` with the Node environment.
- Suites live in `tests/` and import implementation modules through relative paths.
- Existing examples include `workflow.test.ts`, `skillgen.test.ts`, `store.test.ts`, and `guards.test.ts`.
- Desktop automation lives in `scripts/smoke.mjs`; live-agent automation lives in `scripts/live-smoke.mjs`.
- No tracked Playwright runner configuration was found; these scripts use Playwright's Electron API directly.
- Workstream keeps agent-written test files out of the pull request; they remain local for verification.
- `isTestFile` in `shared/types.ts` recognizes test directories and test/spec filenames; do not rename tests to evade that behavior.

## Commands

- Lint: `npm run lint` runs `eslint .`.
- Full verification build: `npm run build` runs `tsc --noEmit && vite build && node scripts/build-main.mjs`.
- There is no separate typecheck script; `tsc --noEmit` is the type-check phase of the build.
- Unit and Git integration suites: `npm test` runs `vitest run`.
- One suite: `npm test -- tests/skillgen.test.ts` forwards the path to Vitest.
- Desktop smoke: `npm run test:desktop` runs `node scripts/smoke.mjs` against the built application.
- Live-agent smoke: `npm run test:live` runs `node scripts/live-smoke.mjs`; apply the live-use restrictions in `AGENTS.md`.
- The desktop script accepts `WORKSTREAM_TEST_EXECUTABLE` to select a packaged executable.
- Do not claim any command passed unless it actually ran successfully.

## Fixtures and mocks

- Tests usually use `describe`, `it`, and `expect`; import `vi` only when needed.
- Use `mkdtemp` or `mkdtempSync` with `tmpdir()` and a descriptive `workstream-...` prefix.
- Give `Store` an explicit temporary directory; give `Workflow` separate fixture repository, state, and worktree locations.
- Follow `workflow.test.ts` for a real temporary Git repository and `git(directory, args)` from `electron/process.ts`.
- Exercise application transitions through `workflow.command(...)` rather than replacing the workflow implementation.
- Mock agent boundaries with `vi.spyOn(engine, "connect")`, `startThread`, and `run`, as in `skillgen.test.ts`.
- Mock `run` with JSON matching the real plan/development/review schemas; keep checks and filesystem effects real when they are the behavior under test.
- Use `vi.waitFor` for asynchronous status transitions instead of assuming the command promise means background work finished.
- Use `it.each` for engine parity when a feature supports Codex, Claude, and Copilot.
- Invalid JSON from an agent, interrupted runs, and corrupt persisted files are observed boundary cases, not impossible internal states.

## Small persistence example

- This follows `tests/store.test.ts` and verifies observable reload behavior.

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Store } from "../electron/store";

describe("saved theme", () => {
  it("restores the selected dark theme", () => {
    const directory = mkdtempSync(join(tmpdir(), "workstream-theme-"));
    const store = new Store(directory);
    store.state.theme = "dark";
    store.save();
    expect(new Store(directory).state.theme).toBe("dark");
  });
});
```

## Choose relevant coverage

- For command changes, cover the reachable success path and the actual gate or failure being changed.
- For skill generation, check read-only execution, no writes before saving, handwritten-file protection, and ignored late results after cancellation.
- For persistence, cover legacy missing fields, interrupted-run recovery, and preserving corrupt input when relevant.
- Avoid manufacturing impossible `Run` combinations merely to increase assertion counts; prefer transitions through real commands.
- Do not preserve obsolete behavior solely because a local test previously expected it.

## Desktop evidence

- Follow `scripts/smoke.mjs`: isolated data under `test-results/`, `WORKSTREAM_DATA_DIR`, and an empty `WORKSTREAM_DEV_URL`.
- Use accessible locators such as `getByRole` and `getByLabel`, matching the existing smoke script.
- Capture page errors and relevant screenshots; compilation is not evidence of UI behavior.
- Report mocked inference, desktop fixture checks, and live inference as different evidence sources.
- Keep unavailable account access or live services explicit; do not substitute a mocked pass for live validation.
