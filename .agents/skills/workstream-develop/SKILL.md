---
name: workstream-develop
description: "Use when implementing Workstream features in its Electron, React, strict TypeScript, Zod, and Tailwind codebase. Follow the existing command/snapshot architecture and themed UI patterns."
generated-by: workstream
generated-at: 2026-10-21T17:42:12.158Z
---

## Scope

- Read `AGENTS.md`; this skill supplements its application safety rules.
- Make the smallest change that satisfies the requested behavior.
- Follow the nearby implementation rather than introducing another architectural layer.

## Place code

- Put feature UI in PascalCase files under `src/components/`; application navigation and snapshot ownership currently live in `src/App.tsx`.
- Reuse installed primitives in `src/components/ui/`, including Button, Dialog, Input, Textarea, Badge, and Card.
- Put renderer utilities in `src/lib/`; `bridge.ts` is the desktop API entry point.
- Put native services and orchestration in `electron/`; extend `Workflow.command` in `electron/workflow.ts` for application commands.
- Put cross-process contracts and Zod schemas in `shared/types.ts`; reusable workflow decisions belong beside existing helpers in `shared/gates.ts`.
- Persistence lives in `electron/store.ts`; do not introduce a separate renderer store for authoritative workflow data.
- Hooks are usually local to the component using them, as with `useElapsed` in `SkillGenerator.tsx`; no dedicated hooks directory was found.

## Extend the command flow

- Add command variants to the `commandSchema` discriminated union and use its inferred `Command` type.
- Keep `Bridge`, `electron/preload.ts`, and `src/lib/bridge.ts` aligned when changing the bridge surface.
- Reuse the `send(command)` function passed from `App.tsx`; it owns pending state, snapshot replacement, and visible errors.
- Treat a `null` result from `send` as failure; do not continue a success-only UI flow.
- Feature components usually receive typed project/snapshot data and callbacks rather than fetching native state themselves.
- Preserve unsubscribe and timer cleanup in effects; follow `App.tsx` and `useElapsed`.
- Browser preview in `src/lib/bridge.ts` supports theme changes but rejects native operations; preserve that explicit distinction.

## Types and imports

- `tsconfig.json` enables strict checking, ES2023, Bundler resolution, and React JSX.
- Use `@/` for renderer imports; shared and Electron imports usually use relative paths without extensions.
- Use `import type` or inline `type` imports for contracts, matching existing files.
- Infer schema-backed types with `z.infer`; do not duplicate their shapes in UI code.
- Use `Record` for exhaustive role/kind labels, as in `SkillGenerator.tsx`.
- Existing code usually uses double quotes, semicolons, and two-space indentation; no tracked Prettier or Stylelint configuration was found.

## UI and theme

- Reuse Button variants and sizes from `src/components/ui/button.tsx` and Lucide icons.
- Feature code usually composes classes with `cn` from `src/lib/utils.ts`; existing UI primitives may use the installed `cn` package.
- Extend feature-scoped classes in `src/styles.css`; this file combines Tailwind v4 tokens with custom CSS.
- Use existing variables such as `--card`, `--foreground`, and `--primary`, or the surrounding `light-dark(...)` pattern.
- Keep styling compatible with the root `.dark` class set by `App.tsx` and Electron's native theme.
- Preserve labels, accessible icon-button names, `aria-pressed` toggles, and live status announcements where applicable.
- UI text is usually inline English; no translation catalog or i18n library was found. Match nearby wording without introducing a localization framework.

## Durable state and failures

- Extend `Store` defaults and migration behavior when adding persisted fields; existing saved state may lack them.
- Preserve temporary-file-plus-rename writes and rejection of corrupt state in `electron/store.ts`.
- Reuse `safeError` from `electron/guards.ts` at error/log boundaries; `App.tsx` already presents command failures.
- Reuse `codeProblems`, `unresolvedItems`, and `acceptBlockers` from `shared/gates.ts` instead of recreating gate logic in JSX.
- For asynchronous drafts, follow `generateSkills`: check both draft identity and status before applying a late result.
- Skill changes should reuse `skillDraftSchema`, `skillName`, `renderSkill`, and `saveSkills` in `electron/skillgen.ts`.
- Preserve the distinction between generated and handwritten skills and between repository and Workstream-local storage.

## Do not

- Do not add a state, fetching, UI, or i18n dependency for behavior already covered by these patterns.
- Do not edit `dist/`, `dist-electron/`, or `release/` as implementation source.
- Do not copy test fixture assumptions into production validation or add fallbacks for impossible typed states.
- Do not perform unrelated formatting, asset replacement, or version cleanup while changing a feature.
- Do not replace application-enforced decisions with prompt wording; follow `AGENTS.md` and the existing gate helpers.
