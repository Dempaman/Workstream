import { useState } from "react";
import { GitPullRequestArrow, MessageSquarePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImagePicker, type ImageInput } from "@/components/Images";
import { activeRevision, type Command, type Project, type Run, type Snapshot } from "../../shared/types";

type Send = (command: Command) => Promise<Snapshot | null>;

const when = (value: string) =>
  new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * Shown on a finished run: describe what should be different and Workstream
 * runs another plan, develop and review round on the same branch, then pushes
 * a new commit to the same pull request.
 */
export function RequestChanges({
  run,
  project,
  send,
  pending,
}: {
  run: Run;
  project: Project;
  send: Send;
  pending: boolean;
}) {
  const [request, setRequest] = useState("");
  const [images, setImages] = useState<ImageInput[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const roomForImages = 6 - (run.images?.length ?? 0);
  return (
    <section className="panel detail-section change-request">
      <h2>
        <MessageSquarePlus size={17} /> Request changes
      </h2>
      {run.prUrl ? (
        <p>
          Want something different in this pull request? Describe it here. Workstream
          reopens <code>{run.branch}</code>, plans only your changes for you to approve,
          develops, verifies and reviews them, then pushes a new commit to the same
          pull request. Nothing is force-pushed.
        </p>
      ) : (
        <p>
          Not published yet and something should change? Describe it here. Workstream
          plans only your changes for you to approve, the developer continues in the
          task worktree, and checks and the independent review run again. Then you
          publish as usual. To point at exact lines, comment in the Changes tab instead.
        </p>
      )}
      {run.worktreeRemoved && (
        <p className="muted-note">
          The branch is checked out in {project.path}. Workstream switches that folder
          back to <code>{run.previousRepoBranch || run.targetBranch}</code> first, and
          stops if it has uncommitted changes.
        </p>
      )}
      {!open ? (
        <div className="button-row">
          <Button disabled={pending} onClick={() => setOpen(true)}>
            <MessageSquarePlus size={15} /> Request changes
          </Button>
        </div>
      ) : (
        <form
          className="change-request-form"
          onSubmit={async (event) => {
            event.preventDefault();
            const next = await send({
              type: "requestChanges",
              runId: run.id,
              request,
              ...(images.length ? { images } : {}),
            });
            if (next) {
              setRequest("");
              setImages([]);
              setOpen(false);
            }
          }}
        >
          <ImagePicker images={images} onChange={setImages} onBusy={setBusy}>
            <textarea
              autoFocus
              rows={5}
              maxLength={20000}
              value={request}
              onChange={(event) => setRequest(event.target.value)}
              placeholder="For example: Move the dealer list above the map, use the smaller heading style, and show the phone number as a link."
            />
          </ImagePicker>
          {images.length > roomForImages && (
            <p className="inline-error">
              This run has room for {Math.max(roomForImages, 0)} more image(s).
            </p>
          )}
          <div className="button-row">
            <Button
              disabled={
                pending || busy || request.trim().length < 5 || images.length > roomForImages
              }
            >
              <GitPullRequestArrow size={15} /> Plan these changes
            </Button>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      <RevisionHistory run={run} />
    </section>
  );
}

/** Banner while a change request round is in progress. */
export function ChangeRequestBanner({
  run,
  send,
  pending,
}: {
  run: Run;
  send: Send;
  pending: boolean;
}) {
  const revision = activeRevision(run);
  if (!revision) return null;
  const running = run.status === "running";
  const canCancel = !running && ["planning", "approval", "developing", "verifying", "reviewing"].includes(run.stage);
  return (
    <div className="change-request-banner">
      <GitPullRequestArrow size={18} />
      <div>
        <strong>Change request {revision.number}</strong>
        <p>{revision.request}</p>
        {revision.notes?.map((note) => (
          <p key={note} className="muted-note">
            {note}
          </p>
        ))}
        <p className="muted-note">
          {revision.beforePr
            ? "Nothing is published until this round passes checks and review."
            : "The pull request stays as it is until this round passes review and is pushed."}
        </p>
      </div>
      {canCancel && (
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          title="Only possible before any files changed in this round"
          onClick={() => void send({ type: "cancelChanges", runId: run.id })}
        >
          <X size={13} /> Cancel change request
        </Button>
      )}
    </div>
  );
}

export function RevisionHistory({ run }: { run: Run }) {
  const done = (run.revisions ?? []).filter((revision) => revision.completedAt);
  if (!done.length) return null;
  return (
    <div className="revision-history">
      <h3>Earlier change requests</h3>
      <ol>
        {done.map((revision) => (
          <li key={revision.number}>
            <span className="revision-number">{revision.number}</span>
            <div>
              <p>{revision.request}</p>
              {revision.developmentSummary && (
                <p className="muted-note">{revision.developmentSummary}</p>
              )}
              <p className="muted-note">
                Pushed {when(revision.completedAt!)}
                {revision.commit && (
                  <>
                    {" "}
                    as <code>{revision.commit.slice(0, 8)}</code>
                  </>
                )}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
