---
name: workstream-review
description: "Use when reviewing Workstream's Electron, React, strict TypeScript, and Zod changes. Prioritize command boundaries, workflow evidence, durable state, asynchronous results, and the existing themed UI."
generated-by: workstream
generated-at: 2026-10-21T17:42:12.158Z
---

## Review basis

- Apply `AGENTS.md` and the existing `skills/review/SKILL.md`; this checklist adds repository-specific inspection points.
- Order findings by the impact of a reachable failure, using the approved scope and actual evidence.
- Trace changed commands from shared schema through Electron handling to renderer state.

## 1. IPC and native boundary

- Inspect `electron/main.ts`: every new IPC handler must retain the `trusted(event)` check; it checks sender, main frame, and expected URL.
- Check that command payloads still pass through `commandSchema.parse`; a TypeScript annotation alone does not validate renderer input.
- Compare `Bridge` in `shared/types.ts`, `electron/preload.ts`, and `src/lib/bridge.ts`; mismatches break either desktop IPC or browser preview.
- Check that browser preview still rejects native commands rather than showing fictional success.
- Inspect changes to `safeError` use and error propagation; workflow output can contain credential-bearing URLs or authorization text.
- Apply the remaining Electron and process protections from `AGENTS.md` at their actual call sites.

## 2. Gate and evidence correctness

- Check `assertApproved` and `planHash` in `electron/guards.ts`; approval must still refer to the current plan contents.
- Check `reviewPassed` and `reviewCleared`; a pass label alone is insufficient when warnings or unresolved gaps remain.
- Check `acceptedReviewIndex` and accepted-gap matching; an acceptance for an earlier review must not clear unrelated current findings.
- Check `acceptBlockers` in `shared/gates.ts`; failed checks, code findings, and failed behavioral evidence cannot become acceptable missing evidence.
- Check consumers of `codeProblems` and `unresolvedItems`; UI summaries should reflect the same decisions as orchestration.
- Preserve gap categories from `gapKind`: locally collectable evidence, user dependencies, and outside-code dependencies route differently.
- Inspect verification results for `passed`, `failed`, and `unavailable`; unavailable evidence must not become a successful check.

## 3. Durable state and recovery

- Inspect additions to `State` against `initialState` and `Store` loading in `electron/store.ts`; existing installations may lack new fields.
- Preserve the ENOENT-only fresh-state fallback; replacing corrupt JSON with empty state loses user history.
- Preserve temporary-file-plus-rename persistence; interrupted writes should not truncate the authoritative state file.
- Check restart handling for running work and transient sign-in state; stale runtime activity must not appear resumable without reconciliation.
- Check that tests and smoke scripts isolate state as specified in `AGENTS.md`; main-process startup also redirects Electron userData.

## 4. Asynchronous work and skill ownership

- Inspect `generateSkills` in `electron/workflow.ts` for identity/status checks after awaited engine output; cancelled or replaced drafts must ignore late answers.
- Check cleanup of `skillThreads` and final snapshot emission so failed or stopped generation does not leave stale activity.
- Preserve the read-only, connector-free `startThread` arguments used for skill generation.
- Check result parsing through `skillDraftSchema`; malformed engine output must become a visible failure.
- Inspect `saveSkills` in `electron/skillgen.ts`; only files marked `generated-by: workstream` may be replaced.
- Keep repository and Workstream-local skill locations distinct; a local-only choice must not create repository files.
- Check command-side skill name, description, body, and role constraints in `shared/types.ts`, not only the UI's disabled button.

## 5. Renderer behavior

- Check callers of `App.tsx`'s `send`: it returns `null` after failure, so follow-up success actions must account for that.
- Keep pending state and errors visible; controls in `SkillGenerator.tsx` disable conflicting operations and show failed drafts.
- Check subscription and timer cleanup against `App.tsx` and `useElapsed`; repeated mounts must not accumulate listeners.
- Preserve typed snapshot ownership rather than mutating authoritative project/run state in renderer components.
- Check `SkillGenerator.tsx` draft-key synchronization; incoming updates must not repeatedly overwrite the user's draft edits.

## 6. Theme and accessibility

- Check custom CSS against `src/styles.css` tokens and `light-dark(...)` pairs; light-only colors can disappear on dark surfaces.
- Keep the root `.dark` class and Electron native theme behavior aligned when changing theme handling.
- Reuse existing shadcn variants before introducing competing control styles.
- Check visible labels, icon-only accessible names, toggle `aria-pressed`, and status announcements against nearby components.
- UI text is usually inline English; do not demand an invented translation catalog or framework.

## 7. Configuration and evidence fit

- Check strict TypeScript compatibility and schema-derived types; avoid duplicated command/result interfaces that drift from Zod.
- `@/` resolves to `src/` in TypeScript and Vite; Electron/shared code usually uses relative imports, and Vitest has a separate configuration.
- ESLint uses recommended JavaScript and TypeScript rules; the installed React Hooks plugin is not configured in `eslint.config.js`.
- No tracked Prettier or Stylelint configuration was found; do not report a nonexistent formatter rule as mandatory.
- Check dependency changes against the exact versions in `package.json` and npm lockfile requirements in `AGENTS.md`.
- Distinguish Node Vitest results, Playwright desktop smoke evidence, and paid live-agent validation; one does not establish the others.
- Test files remain local verification scaffolding under Workstream's policy; do not demand production behavior solely to satisfy speculative local tests.
