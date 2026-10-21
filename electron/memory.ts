import type { Run } from "../shared/types";

export function summarizeRun(run: Run): string {
  const review = run.reviews.at(-1);
  return [
    `${run.ticketKey || run.id}: ${run.title} (${run.stage}, ${run.status})`,
    `Outcome: ${run.development?.summary ?? run.plan?.summary ?? "No implementation yet."}`,
    `Files: ${run.files.join(", ")}`,
    `Checks: ${run.checks.map((c) => `${c.name}: ${c.passed ? "passed" : "failed"}`).join("; ")}`,
    `Review: ${review?.summary ?? "Not reviewed"}`,
    `Unresolved: ${[...(review?.acceptanceGaps ?? []), ...(run.development?.limitations ?? [])].join("; ")}`,
    run.prUrl ? `PR: ${run.prUrl}` : "No PR recorded.",
  ]
    .join("\n")
    .slice(0, 3500);
}
export function relevantMemories(run: Run, runs: Run[]) {
  const words = new Set(
    `${run.title} ${run.description}`.toLowerCase().match(/[a-z]{4,}/g) ?? [],
  );
  return runs
    .filter(
      (other) =>
        other.id !== run.id &&
        other.projectId === run.projectId &&
        other.memory,
    )
    .map((other) => ({
      run: other,
      score: [...words].filter((word) =>
        `${other.title} ${other.memory}`.toLowerCase().includes(word),
      ).length,
    }))
    .filter((item) => item.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || b.run.updatedAt.localeCompare(a.run.updatedAt),
    )
    .slice(0, 3)
    .map((item) => ({
      id: item.run.id,
      summary: item.run.memory!.slice(0, 2000),
    }));
}
