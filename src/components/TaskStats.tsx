import { BarChart3 } from "lucide-react";
import { formatUsd } from "../../shared/pricing";
import { taskStats, type StatRow } from "../../shared/stats";
import type { Snapshot } from "../../shared/types";

const pct = (n: number) => `${Math.round(n * 100)}%`;
const one = (n: number) => (Math.round(n * 10) / 10).toString();
const time = (h: number) => (h < 1 ? `${Math.round(h * 60)} min` : `${one(h)} h`);

function Rows({ rows }: { rows: StatRow[] }) {
  return (
    <>
      {rows.map((r) => (
        <tr key={r.key}>
          <th scope="row">{r.label}</th>
          <td>{r.tasks}</td>
          <td>{formatUsd(r.avgCostUsd)}</td>
          <td>{one(r.avgReviews)}</td>
          <td>{one(r.avgRepairs)}</td>
          <td>{pct(r.firstReviewPass)}</td>
          <td>{time(r.avgHours)}</td>
        </tr>
      ))}
    </>
  );
}

/** How finished tasks went, per developer model and with or without generated skills. */
export function TaskStats({ snapshot }: { snapshot: Snapshot }) {
  const generated = new Set(snapshot.projects.flatMap((p) => (p.skillInfo ?? []).filter((s) => s.generated).map((s) => s.path)));
  const stats = taskStats(snapshot.runs, snapshot.settings.prices ?? {}, generated);
  if (!stats.total.tasks) return null;
  return (
    <section className="panel task-stats">
      <div className="section-title">
        <div>
          <BarChart3 size={17} className="blue" />
          <h2>How tasks went</h2>
        </div>
      </div>
      <p className="muted-note">
        Averages per finished task. Fewer reviews and repairs mean the agents got it right sooner. Costs are estimates from
        the prices in Agents &amp; models.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Developer</th>
              <th scope="col">Tasks</th>
              <th scope="col">Cost</th>
              <th scope="col">Reviews</th>
              <th scope="col">Repairs</th>
              <th scope="col">First review passed</th>
              <th scope="col">Time</th>
            </tr>
          </thead>
          <tbody>
            <Rows rows={[stats.total]} />
            {stats.byModel.length > 1 && <Rows rows={stats.byModel} />}
            {stats.skills.length > 0 && <Rows rows={stats.skills} />}
          </tbody>
        </table>
      </div>
    </section>
  );
}
