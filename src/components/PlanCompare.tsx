import ReactMarkdown from "react-markdown";
import { CheckCheck, GitPullRequestArrow, History } from "lucide-react";
import { activeRevision, type Check, type Plan, type Run } from "../../shared/types";

/** Words of a plan item, for comparing items that were reworded slightly. */
const words = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((word) => word.length > 1),
  );
/** True when an item is the same as (or almost the same as) one in an earlier plan. */
export function seenBefore(item: string, earlier: string[]) {
  const mine = words(item);
  if (!mine.size) return false;
  return earlier.some((other) => {
    const theirs = words(other);
    let shared = 0;
    for (const word of mine) if (theirs.has(word)) shared++;
    return shared / Math.max(mine.size, theirs.size) >= 0.85;
  });
}
const checkText = (check: Check) => `${check.executable} ${check.args.join(" ")}`;

/** The plans before the current one: the original plan, then each earlier change plan. */
export function earlierPlans(run: Run) {
  const rounds = run.revisions ?? [];
  const current = activeRevision(run) ?? rounds.at(-1);
  // Round N stored the plan that was current before it: the original plan for
  // round 1, change plan N-1 otherwise.
  const earlier = rounds
    .slice(0, current ? rounds.indexOf(current) + 1 : 0)
    .flatMap((round) =>
      round.previousPlan
        ? [{ label: round.number === 1 ? "Original plan" : `Change plan ${round.number - 1}`, plan: round.previousPlan as Plan }]
        : [],
    );
  return { current, earlier };
}

function Tag({ isNew, number }: { isNew: boolean; number: number }) {
  return isNew ? (
    <span className="plan-tag new">New in change {number}</span>
  ) : (
    <span className="plan-tag kept">From an earlier plan</span>
  );
}

/**
 * Plan tab during (or after) a change request: what this request adds is
 * highlighted, items carried over from earlier plans are marked, and the
 * original plan stays one click away for comparison.
 */
export function RevisionPlan({ run }: { run: Run }) {
  const plan = run.plan!;
  const { current, earlier } = earlierPlans(run);
  if (!current) return null;
  const before = earlier.map((entry) => entry.plan);
  const oldCriteria = before.flatMap((p) => p.acceptanceCriteria);
  const oldChecks = before.flatMap((p) => p.checks.map(checkText));
  const oldRisks = before.flatMap((p) => p.risks);
  const criteria = plan.acceptanceCriteria.map((text) => ({ text, isNew: !seenBefore(text, oldCriteria) }));
  const checks = plan.checks.map((check) => ({ check, isNew: !oldChecks.includes(checkText(check)) }));
  const risks = plan.risks.map((text) => ({ text, isNew: !seenBefore(text, oldRisks) }));
  const newCount = [...criteria, ...checks, ...risks].filter((item) => item.isNew).length;
  return (
    <div className="revision-plan">
      <div className="plan-legend">
        <span className="plan-tag new">New in change {current.number}</span>
        <span className="plan-tag kept">From an earlier plan</span>
        <span className="muted-note">
          {newCount} new item{newCount === 1 ? "" : "s"} in this plan. Earlier plans are at the bottom for comparison.
        </span>
      </div>
      <div className="plan-change-card">
        <div className="plan-change-heading">
          <GitPullRequestArrow size={16} />
          <strong>What change request {current.number} adds</strong>
        </div>
        <p className="plan-request">You asked: {current.request}</p>
        <p className="plan-summary">{plan.summary}</p>
        <div className="prose">
          <ReactMarkdown>{plan.markdown}</ReactMarkdown>
        </div>
      </div>
      <h3>Acceptance criteria</h3>
      <ul className="plan-items">
        {criteria.map((item, i) => (
          <li key={i} className={item.isNew ? "is-new" : "is-kept"}>
            <Tag isNew={item.isNew} number={current.number} />
            <span>{item.text}</span>
          </li>
        ))}
      </ul>
      <h3>Verification commands</h3>
      {checks.map(({ check, isNew }, i) => (
        <div className={`planned-check ${isNew ? "is-new" : "is-kept"}`} key={i}>
          <CheckCheck size={16} />
          <div>
            <strong>
              {check.name} <Tag isNew={isNew} number={current.number} />
            </strong>
            <code>{checkText(check)}</code>
          </div>
        </div>
      ))}
      {risks.length > 0 && (
        <>
          <h3>Risks & open questions</h3>
          <ul className="plan-items">
            {risks.map((item, i) => (
              <li key={i} className={item.isNew ? "is-new" : "is-kept"}>
                <Tag isNew={item.isNew} number={current.number} />
                <span>{item.text}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {earlier.length > 0 && (
        <div className="earlier-plans">
          <h3>
            <History size={15} /> Earlier plans
          </h3>
          {earlier.map((entry, i) => (
            <details key={i} open={i === 0 && earlier.length === 1}>
              <summary>
                {entry.label}: {entry.plan.summary}
              </summary>
              <div className="earlier-plan-body">
                <h4>Acceptance criteria</h4>
                <ul>
                  {entry.plan.acceptanceCriteria.map((text, j) => (
                    <li key={j}>{text}</li>
                  ))}
                </ul>
                <h4>Plan</h4>
                <div className="prose">
                  <ReactMarkdown>{entry.plan.markdown}</ReactMarkdown>
                </div>
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
