# Workstream development

Workstream is a separate Electron application. Its connected repositories are user data, not part of this codebase.

- Use React, TypeScript, and the installed shadcn components for UI. Keep native filesystem, Git, authentication, and process operations in the Electron main process.
- Preserve context isolation, renderer sandboxing, IPC sender validation, and Zod validation of commands and agent results.
- Workflow gates belong in application code. Never bypass plan approval, independent review, content validation, or the two-repair limit to make a run appear successful.
- Keep model profiles configurable and record the actual model used. Never assume catalog membership guarantees account access.
- Preserve worktrees and interrupted runs. Never reset, force-push, delete user work, or blindly retry external creation requests.
- Use argument arrays for process execution. Do not interpolate task text, paths, or credentials into shell commands. Never log or save access tokens.
- Run `npm run build`, `npm run lint`, and `npm test` for relevant implementation changes. `npm run test:desktop` uses isolated test data; `npm run test:live` consumes model usage and must never publish fixture changes.
- Keep dependencies pinned with the lockfile. Document actual live-validation limitations separately from simulated test results.

The production app stores local state under Electron userData. Tests must use `WORKSTREAM_DATA_DIR` to avoid changing that state.
