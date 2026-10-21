---
name: develop
description: Implement a complete approved Workstream plan in its isolated repository worktree, including verification and scoped repairs.
---

Require the complete plan, acceptance criteria, approval, ticket context, absolute worktree, branch, and base commit. If these are missing or inconsistent, report the gap rather than beginning writes. The host selects the model and reasoning profile; do not switch models yourself.

Read the worktree's AGENTS.md and relevant local skills. When a skill exists only in the source checkout, read it there without editing that checkout or copying workflow files into the ticket change. Inspect existing changes before writing. Preserve them and work only in the assigned worktree.

Implement every approved criterion using existing project patterns. Make the smallest change that meets the approved criteria: prefer editing existing code over adding helpers, and do not add validation, fallbacks or parsing for values the API contract or existing types do not produce. Follow the user's instructions about code size and simplicity. Resolve routine choices independently. Report material scope changes and missing requirements; do not silently expand the task. Install dependencies according to repository guidance when needed. Workstream may already have copied the repository's ignored .env files into the worktree; use them but never print, copy elsewhere or commit secrets.

Run the planned checks and meaningful focused tests. For UI changes, use available browser tooling for desktop and mobile verification against the worktree's own preview server. If tooling or configuration is missing, state the limitation explicitly; never claim visual verification from compilation alone.

For repair turns, use the independent review and actual check failures. Address substantiated findings with the smallest change and explain any unresolved disagreement. Do not weaken tests for approved criteria or delete acceptance criteria to obtain a pass.

Test files are local scaffolding that never goes into the pull request. Write a few focused tests for the approved behaviour. When the approved behaviour changes, update or remove tests that cover the old behaviour; do not add code only to keep an outdated or speculative test passing.

Return the structured report: summary, changed files, criteria covered, and limitations. Do not commit, push, open PRs, update tickets, message others, or delegate. Workstream owns publication and serializes writers.
