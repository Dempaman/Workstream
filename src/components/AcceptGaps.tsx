import { useState } from "react";
import { CircleCheck, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { acceptBlockers, gapText, unresolvedItems } from "../../shared/gates";
import type { Command, Run, Snapshot } from "../../shared/types";

type Send = (command: Command) => Promise<Snapshot | null>;
export const needKindLabels: Record<string, string> = {
  image: "Attach image",
  environment: "Environment or access",
  code: "Code fix needed",
  external: "Outside the code",
  you: "Needs you",
  verification: "Evidence missing",
  review: "Not confirmed by the reviewer",
};

/**
 * Lets you decide that the remaining open items are outside this change, so a
 * run does not loop in verification forever. Code problems cannot be accepted.
 */
export function AcceptGaps({
  run,
  send,
  pending,
  compact = false,
}: {
  run: Run;
  send: Send;
  pending: boolean;
  /** The items are already listed above (in "What to do next"), so only the decision is shown. */
  compact?: boolean;
}) {
  const items = unresolvedItems(run);
  const blockers = acceptBlockers(run);
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  if (!items.length) return null;
  return (
    <div className="accept-gaps">
      <h3>
        <CircleCheck size={16} /> Accept the remaining items and continue
      </h3>
      <p>
        {compact
          ? `Covers the ${items.length} open item${items.length === 1 ? "" : "s"} above. `
          : ""}
        Use this when the open items cannot be solved in code, for example texts
        the market adds in the CMS, live data that does not exist yet, or a
        business sign-off. The run moves to Ready to publish, and the items and
        your reason are listed in the pull request.
      </p>
      {!compact && (
        <ul>
          {items.map((item) => (
            <li key={item.text}>
              <span className={`need-kind ${item.kind}`}>
                {needKindLabels[item.kind] ?? item.kind}
              </span>
              {gapText(item.text)}
            </li>
          ))}
        </ul>
      )}
      {blockers.length ? (
        <p className="inline-error">
          <Lock size={13} /> Locked: {blockers.join(" ")} Fix those first with
          one of the options at the top of this section; this unlocks once a new
          review finds no code problems.
        </p>
      ) : (
        <>
          <textarea
            rows={2}
            maxLength={2000}
            value={reason}
            placeholder="Why these are outside this change, for example: Swedish texts and Finnish content are added by the market team in the CMS."
            onChange={(e) => {
              setReason(e.target.value);
              setConfirm(false);
            }}
          />
          <div className="button-row">
            <Button
              disabled={pending || reason.trim().length < 10}
              variant={confirm ? "default" : "outline"}
              onClick={async () => {
                if (!confirm) {
                  setConfirm(true);
                  return;
                }
                await send({
                  type: "acceptGaps",
                  runId: run.id,
                  items: items.map((i) => i.text),
                  reason: reason.trim(),
                });
              }}
            >
              {confirm
                ? `Yes, accept ${items.length} item${items.length === 1 ? "" : "s"} and continue`
                : "Accept and continue"}
            </Button>
            {confirm && (
              <Button variant="ghost" onClick={() => setConfirm(false)}>
                Cancel
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
