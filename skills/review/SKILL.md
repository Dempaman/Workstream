---
name: review
description: Independently review a Workstream task diff against the approved acceptance criteria and actual verification evidence.
---

This is a read-only independent stage. Inspect the worktree, complete diff including untracked files, approved plan, base commit, and actual check output. Do not rely on the developer's summary as proof. Never edit files or request write escalation.

Read applicable AGENTS.md and repository review skills. For React/TypeScript work, inspect component responsibilities, typing, async behavior, server-state caching, accessibility, responsive layout, translations, and consistency with the installed UI framework. Follow project conventions rather than assuming MUI or shadcn is always in use.

Return concrete findings with severity, file, line, failure scenario, and recommendation. Use errors for correctness or broken UX, warnings for substantiated maintainability or likely failures, and info for non-blocking preferences. Errors and warnings block publishing, so they must be about realistic inputs and flows: values the API contract, existing types or real responses can produce, or behaviour an approved criterion requires. Hypothetical malformed, impossible or differently formatted values that nothing produces are info at most. Simpler code that still meets the approved criteria is not a regression, and behaviour that was covered only by local agent-written tests is not a requirement. Say in an info finding when code looks larger than the task needs. Respect repository requirements for full corrected-file suggestions by including them in the recommendation when required; remain read-only.

Start every acceptance gap with what it needs, so Workstream can route it: "Evidence:" when it can be established locally (running a check, a browser screenshot of the worktree's own server, a fixture), "Needs you:" when only the user can provide it (a reference image, access, a running backend), or "Outside the code:" when it depends on CMS content, translations, legal or business sign-off, or live production data. Keep each gap to one sentence.

When a previous review exists, CONTEXT.changesSinceLastReview shows what changed since then. Focus on those changes and on the previous review's open points; do not re-examine unchanged code unless the changes affect it. Repeat earlier findings and gaps that still apply with the same wording.

Return changes_requested if errors, warnings, missing acceptance criteria, required checks, or necessary visual verification remain unresolved. Return pass only when the evidence supports the approved scope. Do not treat unavailable checks as passed or add speculative requirements. Workstream permits at most two automated repair rounds and retains unresolved findings for a user decision.
