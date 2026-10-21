import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";
import type { Plan, Review, Run } from "../shared/types";
export { acceptBlockers, unresolvedItems } from "../shared/gates";

export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const planHash = (plan: Plan) => hash(JSON.stringify(plan));
export function assertApproved(run: Run) {
  if (
    !run.plan ||
    !run.approval ||
    run.approval.planHash !== planHash(run.plan)
  )
    throw new Error("Approve the current plan before development.");
}
export function reviewPassed(review: Review) {
  return (
    review.verdict === "pass" &&
    !review.findings.some((f) => f.severity !== "info") &&
    review.acceptanceGaps.length === 0
  );
}
export function scopedPath(root: string, file: string) {
  const rel = relative(resolve(root), resolve(root, file));
  if (
    !rel ||
    rel.startsWith("..") ||
    isAbsolute(rel) ||
    rel.split(/[\\/]/).includes(".git")
  )
    throw new Error("A changed file is outside the ticket worktree.");
  if (
    /(^|[\\/])(?:\.env(?:\..*)?|id_rsa|id_ed25519|credentials|.*\.(?:pem|pfx|key))$/i.test(
      rel,
    )
  )
    throw new Error(
      "A potential credential file is in the change. Remove it before publishing.",
    );
  return rel;
}
export function branchName(prefix: string, key: string, title: string) {
  if (key && !/^[A-Za-z][A-Za-z0-9]*-[0-9]+$/.test(key))
    throw new Error(
      "Use a ticket key such as DPP-1234, or leave it blank for a general task.",
    );
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 65) || "task";
  return `${prefix.replace(/\/+$/, "")}/${key ? key + "-" : ""}${slug}`;
}
export function safeRemote(remote: string) {
  try {
    const url = new URL(remote);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return remote.replace(/^[^@]+@/, "").replace(/[?#].*$/, "");
  }
}
export function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/https?:\/\/[^\s/@]+(?::[^\s/@]*)?@/g, "https://[redacted]@")
    .replace(/(?:Bearer\s+)[\w.-]+/gi, "Bearer [redacted]")
    .slice(0, 6000);
}

/**
 * True when a new review has no code findings and every open gap is one you
 * already accepted (same text) on an earlier review of this run.
 */
export function acceptanceCarriesOver(run: Run, review: Review) {
  if (!run.acceptedGaps?.length || !review.acceptanceGaps.length) return false;
  if (review.findings.some((f) => f.severity !== "info")) return false;
  const accepted = new Set(run.acceptedGaps.map((gap) => gap.text));
  return review.acceptanceGaps.every((gap) => accepted.has(gap));
}
/**
 * The publication gate: the latest independent review passed, or its only
 * open points are acceptance gaps you explicitly accepted for that review.
 */
export function reviewCleared(run: Run) {
  const review = run.reviews.at(-1);
  if (!review) return false;
  if (reviewPassed(review)) return true;
  if (review.findings.some((f) => f.severity !== "info")) return false;
  if (run.acceptedReviewIndex !== run.reviews.length - 1 || !run.acceptedGaps?.length) return false;
  const accepted = new Set(run.acceptedGaps.map((gap) => gap.text));
  return review.acceptanceGaps.every((gap) => accepted.has(gap));
}
