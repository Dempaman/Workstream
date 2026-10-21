import { useState } from "react";
import { Bot, CircleAlert, Code2, RotateCw, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  acceptBlockers,
  codeProblems,
  fixAllowed,
  fixRequest,
  gapKind,
  gapText,
  unresolvedItems,
} from "../../shared/gates";
import { needKindLabels } from "@/components/AcceptGaps";
import { TechIcon } from "@/components/TechStack";
import type { Command, Run, Snapshot } from "../../shared/types";

type Send = (command: Command) => Promise<Snapshot | null>;

/**
 * Top of "What needs to be resolved": says in plain words which situation the
 * run is in and what you can do next. Code problems are fixed (by the agents in
 * a new change round with your plan approval, or by you); only items the code
 * cannot solve can be accepted.
 */
export function RecoveryGuide({
  run,
  send,
  pending,
}: {
  run: Run;
  send: Send;
  pending: boolean;
}) {
  const problems = codeProblems(run);
  const open = unresolvedItems(run);
  const canAccept = open.length > 0 && acceptBlockers(run).length === 0;
  const canAskAgents = fixAllowed(run);
  const [asking, setAsking] = useState(false);
  const [request, setRequest] = useState("");

  // Publishing stopped because the repository's commit hooks (formatters, lint
  // --fix, translation extraction) changed files after the review.
  if (run.reviewContentChanged)
    return (
      <div className="recovery-guide">
        <p className="recovery-situation">
          <CircleAlert size={16} /> Almost done. When Workstream made the
          commit, your repository&apos;s commit hooks (for example Prettier,
          ESLint --fix or translation extraction) changed some files. Nothing is
          published until the changed version has passed the checks and a
          review.
        </p>
        <ol className="recovery-options">
          <li>
            <strong>Click Re-check and review.</strong> The approved checks and
            a short independent review run on the formatted files. No developer
            round and no new plan.
          </li>
          <li>
            {run.acceptedGaps?.length ? (
              <>
                <strong>Then it publishes on its own</strong> if the review only
                reports the {run.acceptedGaps.length} item
                {run.acceptedGaps.length === 1 ? "" : "s"} you already accepted.
                If something new comes up, you decide here again.
              </>
            ) : (
              <>
                <strong>Then it publishes on its own</strong> when the review
                passes.
              </>
            )}
          </li>
        </ol>
        <div className="button-row">
          <Button
            disabled={pending}
            onClick={() => void send({ type: "continue", runId: run.id })}
          >
            <RotateCw size={15} /> Re-check and review
          </Button>
        </div>
      </div>
    );

  if (!problems.length) {
    const gaps = run.reviews.at(-1)?.acceptanceGaps ?? [];
    const outside = gaps.filter((gap) => gapKind(gap) === "outside").length;
    const agentCan = open.filter((item) => item.kind === "verification").length;
    const needsYou =
      open.length -
      agentCan -
      open.filter((item) => item.kind === "external").length;
    return (
      <div className="recovery-guide">
        <p className="recovery-situation">
          <CircleAlert size={16} />
          {open.length
            ? ` The code passed its checks and review. ${open.length} item${open.length === 1 ? " is" : "s are"} still open: ${[
                agentCan && `${agentCan} the agent can collect`,
                needsYou > 0 && `${needsYou} only you can give`,
                outside && `${outside} outside the code`,
              ]
                .filter(Boolean)
                .join(", ")}.`
            : " The code passed its checks. The reviewer could not finish; run the checks and review again."}
        </p>
        {open.length > 0 && (
          <ol className="recovery-options">
            {(agentCan > 0 || needsYou > 0) && (
              <li>
                <strong>Give the agent what it needs</strong> and click{" "}
                <em>Collect the missing evidence</em>.
              </li>
            )}
            <li>
              <strong>Or accept the items</strong> that the code cannot solve,
              with a short reason. They are listed in the pull request
              {canAccept ? "." : " (see the reason below if this is locked)."}
            </li>
          </ol>
        )}
      </div>
    );
  }

  return (
    <div className="recovery-guide">
      <p className="recovery-situation">
        <CircleAlert size={16} /> The review found {problems.length} code
        problem{problems.length === 1 ? "" : "s"}. These must be fixed before
        the run can be published. Accepting is only for things the code cannot
        solve, so it stays locked until they are fixed.
      </p>
      <ul className="code-problems">
        {problems.map((p, i) => (
          <li key={i}>
            <span className={`problem-kind ${p.kind}`}>{p.label}</span>
            <div>
              {p.where && <code>{p.where}</code>}
              <p>{p.text}</p>
              {p.fix && <p className="muted-note">Suggested fix: {p.fix}</p>}
            </div>
          </li>
        ))}
      </ul>
      <h3>Choose how to fix them</h3>
      <div className="recovery-choices">
        <div className="recovery-choice">
          <Bot size={18} />
          <div>
            <strong>Let the agents fix them</strong>
            <p>
              The developer gets these problems as your instruction and fixes
              them in the worktree, like your line comments. Then the checks and
              a new independent review run again. Works inside an open change
              round too. Uses model tokens.
            </p>
            {!canAskAgents ? (
              <p className="muted-note">
                Available when the run has stopped and the work is not yet
                published.
              </p>
            ) : !asking ? (
              <Button
                disabled={pending}
                onClick={() => {
                  setRequest(fixRequest(run));
                  setAsking(true);
                }}
              >
                <Wrench size={15} /> Ask the agents to fix these
              </Button>
            ) : (
              <form
                className="recovery-request"
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (
                    await send({
                      type: "fixFindings",
                      runId: run.id,
                      request: request.trim(),
                    })
                  )
                    setAsking(false);
                }}
              >
                <label>
                  What the agents will be asked to fix (edit if you like)
                  <textarea
                    rows={7}
                    maxLength={20000}
                    value={request}
                    onChange={(e) => setRequest(e.target.value)}
                  />
                </label>
                <div className="button-row">
                  <Button disabled={pending || request.trim().length < 5}>
                    <Wrench size={15} /> Send to the developer
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setAsking(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
        <div className="recovery-choice">
          <Code2 size={18} />
          <div>
            <strong>Fix them yourself</strong>
            <p>
              Open the worktree, make the changes and save. Then run the checks
              and a new independent review. Nothing is committed until the
              review passes.
            </p>
            <div className="button-row">
              <Button
                variant="outline"
                disabled={pending}
                onClick={() =>
                  void send({ type: "openInEditor", runId: run.id })
                }
              >
                <TechIcon id="vscode" size={14} /> Open in VS Code
              </Button>
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => void send({ type: "continue", runId: run.id })}
              >
                <RotateCw size={15} /> I fixed them: re-run checks and review
              </Button>
            </div>
          </div>
        </div>
      </div>
      <p className="muted-note">
        Think a finding is wrong? Fix it yourself with a short code comment or
        test that shows why, or ask the agents to fix it and explain in the
        request. The reviewer will look again either way.
      </p>
    </div>
  );
}

const itemHints: Record<string, string> = {
  verification:
    "The agent can collect this. Use Collect the missing evidence below.",
  you: "Only you can give this: attach an image or describe what is now available below.",
  image: "Attach the image below.",
  environment:
    "Start or give access to what is needed, then describe it below.",
  external:
    "Outside the code. Accept it below if it is handled elsewhere (CMS, Legal, the market team).",
  code: "Needs a code change.",
  review: "The reviewer could not confirm this.",
};

/** Every open item once, with what it needs, so you can see the whole picture in one list. */
export function OpenItems({ run }: { run: Run }) {
  const items = unresolvedItems(run);
  if (!items.length) return null;
  return (
    <div className="open-items">
      <h3>Open items ({items.length})</h3>
      <ul>
        {items.map((item) => (
          <li key={item.text}>
            <span className={`need-kind ${item.kind}`}>
              {needKindLabels[item.kind] ?? item.kind}
            </span>
            <div>
              <p>{gapText(item.text)}</p>
              {itemHints[item.kind] && <small>{itemHints[item.kind]}</small>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
