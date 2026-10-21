import { EngineMark } from "@/components/EngineMark";
import {
  costByAgent,
  formatUsd,
  pricesCheckedOn,
  sessionCost,
  type CostSource,
  type ModelPrice,
} from "../../shared/pricing";
import { engineNames, engineShortNames, type Engine, type Run, type Runtime, type UsageWindow } from "../../shared/types";

function WindowUsage({
  value,
  fallback,
}: {
  value: UsageWindow | null;
  fallback: string;
}) {
  if (!value) return <p>{fallback}: unavailable</p>;
  const remaining = Math.min(100, Math.max(0, 100 - value.usedPercent));
  const minutes = value.windowDurationMins;
  const label =
    minutes === 10080
      ? "Weekly"
      : minutes
        ? minutes % 60 === 0
          ? `${minutes / 60}h`
          : `${minutes}m`
        : fallback;
  return (
    <div className="quota-window">
      <div>
        <strong>{label}</strong>
        <span>{remaining.toFixed(0)}% remaining</span>
      </div>
      <progress
        max={100}
        value={remaining}
        aria-label={`${label} usage remaining`}
      />
      <small>
        {value.resetsAt
          ? `Resets ${new Date(value.resetsAt * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
          : "Reset time unavailable"}
      </small>
    </div>
  );
}
function Buckets({ runtime }: { runtime: Runtime }) {
  if (!runtime.limits?.length) return null;
  return (
    <>
      {runtime.limits.map((bucket) => (
        <section key={bucket.id}>
          <h3>{bucket.name}</h3>
          {(bucket.primary || !bucket.secondary) && (
            <WindowUsage value={bucket.primary} fallback="Primary" />
          )}
          {(bucket.secondary || !bucket.primary) && (
            <WindowUsage value={bucket.secondary} fallback="Secondary" />
          )}
        </section>
      ))}
    </>
  );
}
export function AccountUsage({
  runtime,
  claude,
  copilot,
  claudeAuth,
  refresh,
}: {
  runtime: Runtime;
  claude?: Runtime;
  copilot?: Runtime;
  claudeAuth?: "claude-code" | "api-key";
  refresh: () => void;
}) {
  return (
    <details className="account-usage">
      <summary>Usage remaining</summary>
      <div className="usage-popover">
        <strong>Codex</strong>
        <p>Shared across Codex apps and sessions.</p>
        {!runtime.connected ? (
          <p>Connect Codex to load usage.</p>
        ) : runtime.limits?.length ? (
          <Buckets runtime={runtime} />
        ) : (
          <p>Usage is unavailable.</p>
        )}
        {runtime.limitsError && (
          <p role="status">
            {runtime.limitsError} Displayed values may be stale.
          </p>
        )}
        {runtime.limitsUpdatedAt && (
          <small>
            Updated {new Date(runtime.limitsUpdatedAt).toLocaleTimeString()}
          </small>
        )}
        {claude && (
          <div className="usage-claude">
            <strong>Claude</strong>
            <p>Shared with Claude Code and claude.ai on the same plan.</p>
            {!claude.connected ? (
              <p>Connect Claude to load usage.</p>
            ) : claudeAuth === "api-key" ? (
              <p>
                API key: pay per use, no plan limits. Token use is shown on
                each run.
              </p>
            ) : claude.limits?.length ? (
              <Buckets runtime={claude} />
            ) : (
              !claude.limitsError && <p>Loading usage…</p>
            )}
            {claude.limitsError && <p role="status">{claude.limitsError}</p>}
            {claude.limitsUpdatedAt && (
              <small>
                Updated {new Date(claude.limitsUpdatedAt).toLocaleTimeString()}
              </small>
            )}
          </div>
        )}
        {copilot?.authenticated && (
          <div className="usage-claude">
            <strong>GitHub Copilot</strong>
            <p>Your GitHub account's Copilot plan, shared with VS Code and github.com.</p>
            {copilot.limits?.length ? (
              <Buckets runtime={copilot} />
            ) : (
              !copilot.limitsError && <p>No monthly limit reported (unlimited, or usage-based billing).</p>
            )}
            {copilot.limitsError && <p role="status">{copilot.limitsError}</p>}
            {copilot.limitsUpdatedAt && (
              <small>Updated {new Date(copilot.limitsUpdatedAt).toLocaleTimeString()}</small>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={refresh}
          disabled={!runtime.connected && !claude?.connected && !copilot?.authenticated}
        >
          Refresh usage
        </button>
      </div>
    </details>
  );
}
const roleNames: Record<string, string> = {
  planner: "Planner",
  developer: "Developer",
  reviewer: "Reviewer",
  verification: "Verification",
};
const sourceNote: Record<CostSource, string> = {
  reported: "reported by the runtime",
  estimate: "tokens × list price",
  unpriced: "no price for this model",
  none: "no usage reported",
};
function CostCell({ usd, sources }: { usd: number; sources: Set<CostSource> }) {
  const unpriced = sources.has("unpriced");
  const priced = [...sources].some((s) => s === "reported" || s === "estimate");
  return (
    <>
      <strong>{priced ? formatUsd(usd) : "—"}</strong>
      {unpriced && <small className="cost-warning"> + unpriced sessions</small>}
    </>
  );
}

export function RunUsage({
  run,
  prices,
  defaults,
}: {
  run: Run;
  prices?: Record<string, ModelPrice>;
  defaults?: Partial<Record<string, string>>;
}) {
  const recorded = run.sessions.filter((session) => session.usage);
  const total = (
    key:
      | "totalTokens"
      | "inputTokens"
      | "cachedInputTokens"
      | "outputTokens"
      | "reasoningOutputTokens",
  ) =>
    recorded
      .reduce((sum, session) => sum + (session.usage?.[key] ?? 0), 0)
      .toLocaleString();
  const agents = costByAgent(run.sessions, prices, defaults);
  const totalUsd = agents.reduce((sum, agent) => sum + agent.usd, 0);
  const allSources = new Set(agents.flatMap((agent) => [...agent.sources]));
  return (
    <section className="panel run-usage">
      <div>
        <h2>Run usage</h2>
        <p>
          {recorded.length
            ? `${total("totalTokens")} recorded tokens`
            : "Token usage was not recorded for this run yet."}
        </p>
      </div>
      {!!recorded.length && (
        <>
          <span className="run-cost">
            Estimated cost <CostCell usd={totalUsd} sources={allSources} />
          </span>
          <span>
            Input <strong>{total("inputTokens")}</strong>
          </span>
          <span>
            Cached input <strong>{total("cachedInputTokens")}</strong>
          </span>
          <span>
            Uncached input{" "}
            <strong>
              {recorded
                .reduce(
                  (sum, s) =>
                    sum +
                    Math.max(
                      0,
                      s.usage!.inputTokens - s.usage!.cachedInputTokens,
                    ),
                  0,
                )
                .toLocaleString()}
            </strong>
          </span>
          <span>
            Output <strong>{total("outputTokens")}</strong>
          </span>
          <span>
            Reasoning within output{" "}
            <strong>{total("reasoningOutputTokens")}</strong>
          </span>
        </>
      )}
      {!!recorded.length && (
        <div className="agent-costs">
          <table>
            <thead>
              <tr>
                <th>Agent</th>
                <th>Runs on</th>
                <th>Model</th>
                <th className="num">Sessions</th>
                <th className="num">Tokens</th>
                <th className="num">Estimated cost</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr key={agent.key}>
                  <td>{roleNames[agent.key] ?? agent.key}</td>
                  <td>
                    <span className="agent-cost-engines">
                      {agent.engines.map((engine) => (
                        <span key={engine} title={engineNames[engine as Engine]}>
                          <EngineMark engine={engine as Engine} size={14} />{" "}
                          {engineShortNames[engine as Engine] ?? engine}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td>{agent.models.join(", ") || "Runtime default"}</td>
                  <td className="num">{agent.sessions}</td>
                  <td className="num">{agent.tokens.toLocaleString()}</td>
                  <td className="num" title={[...agent.sources].map((s) => sourceNote[s]).join(", ")}>
                    <CostCell usd={agent.usd} sources={agent.sources} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <small>
        {recorded.length}/{run.sessions.length} sessions reporting ·{" "}
        {run.repairCount}/2 repairs · {run.reviews.length} reviews. Costs are
        estimates at API list prices ({pricesCheckedOn}, editable under Agents &
        models), not what your plan charges: ChatGPT and Claude subscriptions
        cover this usage within their limits. Claude sessions use Claude's own
        API-price figure and Copilot sessions use the AI credits Copilot reports
        ($0.01 each) when available. Cached input is already included in input,
        and reasoning is included in output.
      </small>
      <details>
        <summary>Usage by session</summary>
        <p>
          There are no token or time limits: agents run until they finish or
          you press Stop. Your plan's own usage limits still apply.
        </p>
        <ul>
          {run.sessions.map((s, i) => {
            const cost = sessionCost(s, prices, defaults);
            return (
              <li key={s.threadId}>
                Session {i + 1} ·{" "}
                {s.purpose === "verification" ? "Verification" : s.role}
                {cost.model ? ` · ${cost.label ?? cost.model}` : ""}:{" "}
                {s.usage
                  ? `${s.usage.totalTokens.toLocaleString()} tokens (${s.usage.cachedInputTokens.toLocaleString()} cached input) · ${
                      cost.source === "unpriced" ? "no price for this model" : `${formatUsd(cost.usd)} (${sourceNote[cost.source]})`
                    }`
                  : "Usage unavailable"}
              </li>
            );
          })}
        </ul>
      </details>
    </section>
  );
}
