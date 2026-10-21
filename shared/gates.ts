import { activeRevision, type Run } from "./types";

/**
 * The reviewer starts each acceptance gap with what it needs: "Evidence:" (the
 * agent can collect it locally), "Needs you:" (an image, access or a running
 * service only you can give) or "Outside the code:" (CMS content, sign-off, live
 * data). Untagged gaps are treated as evidence the agent can try to collect.
 */
export type GapKind = "evidence" | "you" | "outside";
const gapPrefix = /^\s*(evidence|needs you|outside the code)\s*:\s*/i;
export function gapKind(text: string): GapKind {
  const tag = text.match(gapPrefix)?.[1]?.toLowerCase();
  return tag === "needs you" ? "you" : tag === "outside the code" ? "outside" : "evidence";
}
/** The gap without its tag, for display. */
export const gapText = (text: string) => {
  const rest = text.replace(gapPrefix, "");
  return rest === text ? text : rest.charAt(0).toUpperCase() + rest.slice(1);
};
const gapItemKind: Record<GapKind, string> = { evidence: "verification", you: "you", outside: "external" };

/** Everything still open on a blocked run: review acceptance gaps and verification needs. */
export function unresolvedItems(run: Run) {
  const items = new Map<string, { text: string; kind: string }>();
  for (const gap of run.reviews.at(-1)?.acceptanceGaps ?? []) items.set(gap, { text: gap, kind: gapItemKind[gapKind(gap)] });
  // The same point can come from the review (tagged) and from verification (untagged): list it once.
  const same = (text: string) => gapText(text).trim().replace(/[.\s]+$/, "").toLowerCase();
  const seen = new Set([...items.keys()].map(same));
  for (const need of run.verification?.needs ?? [])
    if (!seen.has(same(need.action))) {
      seen.add(same(need.action));
      items.set(need.action, { text: need.action, kind: need.kind });
    }
  return [...items.values()];
}
export interface CodeProblem {
  kind: "error" | "warning" | "check" | "behaviour";
  label: string;
  where?: string;
  text: string;
  fix?: string;
}
/** Problems that need a code change: failed checks, review errors and warnings, failed behaviour checks. */
export function codeProblems(run: Run): CodeProblem[] {
  const problems: CodeProblem[] = [];
  for (const check of run.checks.filter((c) => !c.passed))
    problems.push({
      kind: "check",
      label: "Check failed",
      where: `${check.executable} ${check.args.join(" ")}`.trim(),
      text: `${check.name} failed${check.exitCode !== null ? ` (exit code ${check.exitCode})` : ""}.`,
    });
  for (const f of run.reviews.at(-1)?.findings ?? [])
    if (f.severity !== "info")
      problems.push({
        kind: f.severity,
        label: f.severity === "error" ? "Error" : "Warning",
        where: f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : undefined,
        text: f.scenario,
        fix: f.recommendation || undefined,
      });
  for (const e of run.verification?.evidence ?? [])
    if (e.result === "failed")
      problems.push({ kind: "behaviour", label: "Did not behave as required", text: `${e.check}: ${e.details}` });
  return problems;
}
/** The change request text Workstream suggests from the code problems (you can edit it). */
export function fixRequest(run: Run) {
  const problems = codeProblems(run);
  const lines = problems.map((p, i) => `${i + 1}. ${p.where ? `${p.where}: ` : ""}${p.text}${p.fix ? ` Fix: ${p.fix}` : ""}`);
  return `Fix the problems the independent review and checks found. Change only what is needed for these:\n${lines.join("\n")}`.slice(0, 19000);
}

/** A criterion the planner added itself (not asked for in the task). */
export const isProposedCriterion = (text: string) => /^\s*proposed\b/i.test(text);
/** The plan you approve: proposed criteria you did not include are left out. */
export function planWithCriteria<T extends { acceptanceCriteria: string[] }>(plan: T, included: string[]): T {
  return {
    ...plan,
    acceptanceCriteria: plan.acceptanceCriteria.filter((c) => !isProposedCriterion(c) || included.includes(c)),
  };
}
/**
 * Why the remaining items cannot simply be accepted. Code problems must be
 * fixed: only missing evidence or outside dependencies can be accepted.
 */
export function acceptBlockers(run: Run) {
  const review = run.reviews.at(-1);
  const blockers: string[] = [];
  if (!review) blockers.push("No independent review has run yet.");
  if (run.checks.some((check) => !check.passed)) blockers.push("A required check failed.");
  if (review?.findings.some((f) => f.severity !== "info"))
    blockers.push("The review found code problems.");
  if (run.verification?.evidence.some((e) => e.result === "failed"))
    blockers.push("A verification check showed the feature does not behave as required.");
  return blockers;
}

/**
 * Where "Ask the agents to fix these" can go straight to the developer: approved
 * work in the worktree, not yet published, run stopped. Also inside an open
 * change round. Like your line comments, it is your own instruction, so the
 * checks and a new independent review still decide.
 */
export function fixAllowed(run: Run) {
  return Boolean(
    run.status !== "running" &&
      run.approval &&
      run.worktree &&
      !run.worktreeRemoved &&
      !(run.stage === "complete" && run.prUrl) &&
      ["ready", "verifying", "reviewing", "developing"].includes(run.stage),
  );
}
/**
 * Where "Request changes" is offered: after the pull request exists, or before
 * it once the approved work is in the worktree (Ready to publish, or stopped at
 * Publish, Verify or Review). Not while a change request is already open.
 */
export function changeRequestAllowed(run: Run) {
  if (run.status === "running" || activeRevision(run)) return false;
  // A merged or abandoned pull request cannot take more commits: start a new task instead.
  if (run.prStatus?.state === "completed" || run.prStatus?.state === "abandoned") return false;
  if (run.stage === "complete") return Boolean(run.prUrl && run.commit);
  return Boolean(
    !run.prUrl &&
      run.approval &&
      run.worktree &&
      !run.worktreeRemoved &&
      ["ready", "publishing", "reviewing", "verifying"].includes(run.stage),
  );
}
