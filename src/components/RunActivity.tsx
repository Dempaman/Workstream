import { useEffect, useState } from "react";
import type { Run } from "../../shared/types";
import { stepOf } from "./StageFlow";

const minutes = (seconds: number) =>
  seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)} min ${seconds % 60}s`;

/** What the agent is most likely waiting on, from its last activity line. */
export function waitingOn(text: string | undefined) {
  if (!text) return undefined;
  const command = text.match(/^(?:Running|Auto-allowed [\w ]+?):\s*(.+)$/s)?.[1];
  if (command) return `a command to finish: ${command.slice(0, 160)}`;
  const tool = text.match(/^Using ([\w. -]+?)(?::|$)/)?.[1];
  if (tool) return `the ${tool} tool to finish`;
  return undefined;
}

export function RunActivity({ run, waitingForYou = 0 }: { run: Run; waitingForYou?: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(
    0,
    Math.floor((now - Date.parse(run.live?.at ?? run.updatedAt)) / 1000),
  );
  const elapsed = Math.max(
    0,
    Math.floor((now - Date.parse(run.live?.startedAt ?? run.updatedAt)) / 1000),
  );
  const steps = run.live?.steps;
  return (
    <section className="panel live-activity" data-step={stepOf[run.stage]}>
      <header>
        <h2>Live activity</h2>
        <span>
          {Math.floor(elapsed / 60)}m {elapsed % 60}s in this stage
        </span>
      </header>
      <p>{run.live?.text ?? run.activity.at(-1)?.text ?? "Starting agent…"}</p>
      {waitingForYou > 0 ? (
        <div className="waiting-notice you" role="status">
          Waiting for you: {waitingForYou} permission request{waitingForYou === 1 ? "" : "s"} at the top of the page
          ({minutes(seconds)}).
        </div>
      ) : seconds >= 120 ? (
        <div className="waiting-notice" role="status">
          No new activity for {minutes(seconds)}.{" "}
          {waitingOn(run.activity.at(-1)?.text)
            ? `The agent is probably waiting for ${waitingOn(run.activity.at(-1)?.text)}.`
            : "The agent may still be thinking or running something."}{" "}
          If this looks stuck, press Stop: the work so far is kept.
        </div>
      ) : (
        <small>{seconds < 5 ? "Receiving activity" : `Last activity ${seconds}s ago`}</small>
      )}
      {!!steps?.length && (
        <>
          <p>
            {steps.filter((step) => step.status === "completed").length}/
            {steps.length} agent-reported steps complete (not a time estimate)
          </p>
          <ol>
            {steps.map((step, i) => (
              <li key={i}>
                {step.status === "completed"
                  ? "✓"
                  : step.status === "inProgress"
                    ? "→"
                    : "○"}{" "}
                {step.step}
              </li>
            ))}
          </ol>
        </>
      )}
      <details>
        <summary>Recent activity</summary>
        {run.activity
          .slice(-5)
          .reverse()
          .map((item) => (
            <p key={item.id}>
              <time>{new Date(item.time).toLocaleTimeString()}</time>{" "}
              {item.text}
            </p>
          ))}
      </details>
    </section>
  );
}
