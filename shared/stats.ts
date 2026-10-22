import type { Run } from "./types";
import { sessionCost, type ModelPrice } from "./pricing";

export interface StatRow {
  key: string;
  label: string;
  tasks: number;
  avgCostUsd: number;
  avgReviews: number;
  avgRepairs: number;
  /** Share of tasks whose first review passed. */
  firstReviewPass: number;
  avgHours: number;
}

const finished = (run: Run) => run.stage === "complete" || Boolean(run.prUrl) || run.stage === "ready";
const hours = (run: Run) => {
  const end = run.activity.at(-1)?.time ?? run.updatedAt;
  return Math.max(0, (Date.parse(end) - Date.parse(run.createdAt)) / 3_600_000);
};
const developer = (run: Run) => {
  const s = run.sessions.find((x) => x.role === "developer");
  return s ? `${s.engine ?? "codex"}${s.model ? ` · ${s.model}` : ""}` : "no developer session";
};

function row(key: string, label: string, runs: Run[], prices: Record<string, ModelPrice>): StatRow {
  const n = runs.length || 1;
  const sum = (f: (r: Run) => number) => runs.reduce((a, r) => a + f(r), 0);
  return {
    key,
    label,
    tasks: runs.length,
    avgCostUsd: sum((r) => r.sessions.reduce((a, s) => a + sessionCost(s, prices).usd, 0)) / n,
    avgReviews: sum((r) => r.reviews.length) / n,
    avgRepairs: sum((r) => r.repairCount) / n,
    firstReviewPass: runs.filter((r) => r.reviews[0]?.verdict === "pass").length / n,
    avgHours: sum(hours) / n,
  };
}

/**
 * How finished tasks went, per developer engine and model, and with or without
 * generated skills, so you can compare setups on your own work.
 */
export function taskStats(runs: Run[], prices: Record<string, ModelPrice> = {}, generatedSkillPaths: Set<string> = new Set()) {
  const done = runs.filter(finished);
  const byModel = new Map<string, Run[]>();
  for (const run of done) byModel.set(developer(run), [...(byModel.get(developer(run)) ?? []), run]);
  const usedSkills = (run: Run) => run.sessions.some((s) => s.instructions?.skills.some((k) => generatedSkillPaths.has(k.path)));
  const withSkills = done.filter(usedSkills);
  const withoutSkills = done.filter((r) => !usedSkills(r));
  return {
    total: row("all", "All finished tasks", done, prices),
    byModel: [...byModel.entries()].map(([label, list]) => row(label, label, list, prices)).sort((a, b) => b.tasks - a.tasks),
    skills: generatedSkillPaths.size && withSkills.length
      ? [row("with", "With generated skills", withSkills, prices), row("without", "Without", withoutSkills, prices)]
      : [],
  };
}
