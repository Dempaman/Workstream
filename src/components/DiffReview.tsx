import { Fragment, useMemo, useState } from "react";
import { MessageSquarePlus, Send } from "lucide-react";
import { parseDiff, type DiffLine } from "@/lib/diff";
import { isTestFile, type ReviewComment } from "../../shared/types";

type NewComment = { file: string; line: number; side: "new" | "old"; code: string; text: string };

/** Where a diff line can take a comment: added/context lines by new line, removed lines by old line. */
const anchor = (line: DiffLine) =>
  line.kind === "remove"
    ? line.oldLine !== undefined
      ? { side: "old" as const, line: line.oldLine }
      : undefined
    : (line.kind === "add" || line.kind === "context") && line.newLine !== undefined
      ? { side: "new" as const, line: line.newLine }
      : undefined;

export function DiffReview({
  diff,
  localOnly = [],
  comments = [],
  onAdd,
  onUpdate,
  onDelete,
  onSend,
  sendLabel,
  canSend = false,
  pending = false,
}: {
  diff: string;
  localOnly?: string[];
  comments?: ReviewComment[];
  onAdd?: (comment: NewComment) => Promise<unknown>;
  onUpdate?: (id: string, patch: { text?: string; status?: "open" | "resolved" }) => Promise<unknown>;
  onDelete?: (id: string) => Promise<unknown>;
  onSend?: () => Promise<unknown>;
  sendLabel?: string;
  canSend?: boolean;
  pending?: boolean;
}) {
  // Test files never go into the PR, so they are not shown here at all.
  const all = useMemo(() => parseDiff(diff), [diff]);
  const files = all.filter((file) => !localOnly.includes(file.path) && !isTestFile(file.path));
  const hidden = all.length - files.length;
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<{ key: string; text: string } | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const visible = files.filter((file) => file.path.toLowerCase().includes(query.toLowerCase()));
  const current = visible.find((file) => file.path === selected) ?? visible[0];
  const live = comments.filter((c) => c.status !== "resolved");
  const open = comments.filter((c) => c.status === "open");
  const countFor = (path: string) => live.filter((c) => c.file === path).length;
  const at = (path: string, side: string, line: number) =>
    comments.filter((c) => c.file === path && c.side === side && c.line === line);
  // Comments whose line is no longer in the diff (the code moved) are listed at the top of the file.
  const placed = new Set(
    current
      ? current.lines.flatMap((line) => {
          const a = anchor(line);
          return a ? [`${a.side}:${a.line}`] : [];
        })
      : [],
  );
  const unplaced = current ? comments.filter((c) => c.file === current.path && !placed.has(`${c.side}:${c.line}`)) : [];

  const renderComment = (comment: ReviewComment) => (
    <div className={`diff-comment ${comment.status}`} key={comment.id}>
      <div className="diff-comment-meta">
        <span className={`comment-status ${comment.status}`}>
          {comment.status === "open" ? "Not sent yet" : comment.status === "sent" ? "Sent to the agent" : "Resolved"}
        </span>
        <span>
          {comment.side === "old" ? "Removed line" : "Line"} {comment.line}
        </span>
      </div>
      {editing?.id === comment.id ? (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            await onUpdate?.(comment.id, { text: editing.text });
            setEditing(null);
          }}
        >
          <textarea rows={3} value={editing.text} onChange={(e) => setEditing({ id: comment.id, text: e.target.value })} />
          <div className="diff-comment-actions">
            <button type="submit" disabled={pending || !editing.text.trim()}>Save</button>
            <button type="button" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </form>
      ) : (
        <>
          <p>{comment.text}</p>
          <div className="diff-comment-actions">
            {comment.status === "open" && (
              <button type="button" onClick={() => setEditing({ id: comment.id, text: comment.text })}>Edit</button>
            )}
            {comment.status !== "resolved" ? (
              <button type="button" disabled={pending} onClick={() => void onUpdate?.(comment.id, { status: "resolved" })}>
                Resolve
              </button>
            ) : (
              <button type="button" disabled={pending} onClick={() => void onUpdate?.(comment.id, { status: "open" })}>
                Reopen
              </button>
            )}
            <button type="button" disabled={pending} onClick={() => void onDelete?.(comment.id)}>
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );

  return (
    <div className="pr-diff-wrap">
      {onAdd && (
        <div className="review-bar">
          <span>
            <MessageSquarePlus size={15} /> Click a line number to comment on it.{" "}
            {open.length
              ? `${open.length} comment${open.length === 1 ? "" : "s"} not sent yet.`
              : live.length
                ? `${live.length} comment${live.length === 1 ? "" : "s"} sent.`
                : ""}
          </span>
          {onSend && (
            <button
              type="button"
              className="review-send"
              disabled={pending || !canSend || !open.length}
              title={canSend ? undefined : "Comments can be sent when the run is not working on something else."}
              onClick={() => void onSend()}
            >
              <Send size={14} /> {sendLabel ?? "Send comments"}
            </button>
          )}
        </div>
      )}
      <div className="pr-diff">
        <aside className="diff-files" aria-label="Changed files">
          <label>
            Filter files
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search file paths…" />
          </label>
          <p>
            {files.length} files ·{" "}
            <span className="diff-added">+{files.reduce((sum, file) => sum + file.added, 0)}</span>{" "}
            <span className="diff-removed">−{files.reduce((sum, file) => sum + file.removed, 0)}</span>
          </p>
          {hidden > 0 && (
            <p className="muted-note">
              {hidden} test file{hidden === 1 ? "" : "s"} hidden. Tests stay in the worktree and are never part of the PR.
            </p>
          )}
          {visible.map((file) => (
            <button
              key={file.path}
              aria-current={current?.path === file.path ? "true" : undefined}
              onClick={() => setSelected(file.path)}
            >
              {file.path}
              <small>
                <span className="diff-added">+{file.added}</span> <span className="diff-removed">−{file.removed}</span>
                {countFor(file.path) > 0 && <span className="file-comment-count"> · {countFor(file.path)} comment{countFor(file.path) === 1 ? "" : "s"}</span>}
              </small>
            </button>
          ))}
        </aside>
        <div className="diff-content">
          {current ? (
            <>
              <header>
                <strong>{current.path}</strong>
                <span className="diff-added">+{current.added}</span>
                <span className="diff-removed">−{current.removed}</span>
              </header>
              {unplaced.length > 0 && (
                <div className="diff-unplaced">
                  <small>Comments on lines that have since moved:</small>
                  {unplaced.map(renderComment)}
                </div>
              )}
              <div className="diff-scroll" tabIndex={0} aria-label={`Changes in ${current.path}`}>
                <table>
                  <thead>
                    <tr>
                      <th>Old</th>
                      <th>New</th>
                      <th aria-label="Change type" />
                      <th>Code</th>
                    </tr>
                  </thead>
                  <tbody>
                    {current.lines.map((line, index) => {
                      const a = anchor(line);
                      const key = a ? `${current.path}:${a.side}:${a.line}` : "";
                      const here = a ? at(current.path, a.side, a.line) : [];
                      const start = () => onAdd && a && setDraft({ key, text: "" });
                      return (
                        <Fragment key={index}>
                          <tr className={`diff-line-${line.kind}${a && onAdd ? " commentable" : ""}`}>
                            <td onClick={start} title={a && onAdd ? "Comment on this line" : undefined}>
                              {line.oldLine ?? ""}
                            </td>
                            <td onClick={start} title={a && onAdd ? "Comment on this line" : undefined}>
                              {line.newLine ?? ""}
                            </td>
                            <td aria-label={line.kind === "add" ? "Added" : line.kind === "remove" ? "Removed" : line.kind}>
                              {a && onAdd ? (
                                <button type="button" className="add-comment" aria-label="Comment on this line" onClick={start}>
                                  +
                                </button>
                              ) : null}
                              <span className="diff-sign">{line.kind === "add" ? "+" : line.kind === "remove" ? "−" : ""}</span>
                            </td>
                            <td>
                              <code>{line.text || " "}</code>
                            </td>
                          </tr>
                          {(here.length > 0 || draft?.key === key) && a && (
                            <tr className="diff-comment-row">
                              <td colSpan={4}>
                                {here.map(renderComment)}
                                {draft?.key === key && (
                                  <form
                                    className="diff-comment new"
                                    onSubmit={async (event) => {
                                      event.preventDefault();
                                      await onAdd?.({
                                        file: current.path,
                                        line: a.line,
                                        side: a.side,
                                        code: line.text.slice(0, 2000),
                                        text: draft.text,
                                      });
                                      setDraft(null);
                                    }}
                                  >
                                    <textarea
                                      autoFocus
                                      rows={3}
                                      maxLength={5000}
                                      placeholder="What should change here? For example: use the shared formatDate helper instead."
                                      value={draft.text}
                                      onChange={(e) => setDraft({ key, text: e.target.value })}
                                    />
                                    <div className="diff-comment-actions">
                                      <button type="submit" disabled={pending || !draft.text.trim()}>
                                        Add comment
                                      </button>
                                      <button type="button" onClick={() => setDraft(null)}>
                                        Cancel
                                      </button>
                                    </div>
                                  </form>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p>No matching files.</p>
          )}
        </div>
      </div>
    </div>
  );
}
