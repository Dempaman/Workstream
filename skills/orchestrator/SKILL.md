---
name: orchestrator
description: Explain and coordinate Workstream's task-to-pull-request workflow when working on this application or its workflow rules.
---

The application in electron/workflow.ts owns stage transitions and durable state. It invokes task-planner, develop, and review in separate Codex sessions. Skills are instructions; application code enforces approval, review limits, and publication checks.

Preserve these invariants: investigate read-only before approval; bind approval to the exact plan; use a fetched base and isolated worktree; one active writer; independent read-only review; at most two automated repairs; verify content did not change after review; publish only within approved scope; reconcile existing PRs before creating or retrying; never force-push or auto-merge.

Project-specific target branches, ticket keys, checks, and UI conventions come from the connected repository and saved project settings. Do not hardcode DeLaval conventions into generic execution. Preserve worktrees on failure and report unavailable checks or authentication honestly.
