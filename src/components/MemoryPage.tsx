import { useEffect, useState } from "react";
import { Brain, Pin, PinOff, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Command, MemoryItem, MemoryKind, Run, Snapshot } from "../../shared/types";

type Send = (command: Command) => Promise<Snapshot | null>;
export const kindLabels: Record<MemoryKind, string> = {
  outcome: "What was built",
  feedback: "Your plan feedback",
  finding: "Review finding",
  check: "Failed check",
  note: "Your note",
};

function MemoryCard({ item, send, pending }: { item: MemoryItem; send: Send; pending: boolean }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [body, setBody] = useState(item.body);
  const [confirm, setConfirm] = useState(false);
  // Long memories (code, long build summaries) start folded to a few lines.
  const long = item.body.length > 400 || item.body.split("\n").length > 6;
  const [open, setOpen] = useState(false);
  return (
    <li className={cn("memory-card", item.pinned && "pinned")} data-kind={item.kind}>
      <header>
        <span className={cn("memory-kind", item.kind)}>{kindLabels[item.kind]}</span>
        {item.runLabel && <span className="muted-note">from {item.runLabel}</span>}
        <span className="muted-note">used {item.uses}×</span>
        <span className="memory-actions">
          <button
            title={item.pinned ? "Unpin: only used when relevant" : "Pin: always given to agents in this project"}
            disabled={pending}
            onClick={() => void send({ type: "memoryUpdate", id: item.id, pinned: !item.pinned })}
          >
            {item.pinned ? <PinOff size={14} /> : <Pin size={14} />}
          </button>
          <button title="Edit" onClick={() => setEditing(!editing)}>
            <Pencil size={14} />
          </button>
          <button title="Delete" onClick={() => setConfirm(true)}>
            <Trash2 size={14} />
          </button>
        </span>
      </header>
      {editing ? (
        <form
          className="memory-edit"
          onSubmit={async (event) => {
            event.preventDefault();
            if (await send({ type: "memoryUpdate", id: item.id, title, body })) setEditing(false);
          }}
        >
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} required />
          <textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} maxLength={6000} required />
          <div className="button-row">
            <Button size="sm" disabled={pending}>Save</Button>
            <Button size="sm" variant="outline" type="button" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </form>
      ) : (
        <>
          <h3>{item.title}</h3>
          <p className={cn("memory-body", long && !open && "folded")}>{item.body}</p>
          {long && (
            <button type="button" className="memory-more" aria-expanded={open} onClick={() => setOpen(!open)}>
              {open ? "Show less" : "Show all"}
            </button>
          )}
          {item.files.length > 0 && (
            <p className="memory-files">{item.files.slice(0, 6).join(" · ")}{item.files.length > 6 ? ` +${item.files.length - 6}` : ""}</p>
          )}
        </>
      )}
      {confirm && (
        <div className="memory-confirm">
          Delete this memory? Agents will no longer see it.
          <Button size="sm" variant="outline" disabled={pending} onClick={() => void send({ type: "memoryDelete", id: item.id })}>
            Delete
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
            Keep
          </Button>
        </div>
      )}
    </li>
  );
}

export function MemoryPage({ snapshot, pending, send }: { snapshot: Snapshot; pending: boolean; send: Send }) {
  const projects = snapshot.projects.filter((p) => !p.archived);
  const view = snapshot.memoryView;
  const [projectId, setProjectId] = useState(view?.projectId ?? projects[0]?.id ?? "");
  const [query, setQuery] = useState(view?.query ?? "");
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  useEffect(() => {
    if (!projectId) return;
    const timer = setTimeout(() => void send({ type: "memoryList", projectId, query }), 250);
    return () => clearTimeout(timer);
  }, [projectId, query]);
  const items = view?.projectId === projectId ? view.items : [];
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">WHAT YOUR AGENTS REMEMBER</div>
          <h1>Memory</h1>
          <p>
            Learned automatically from finished runs, plus your own notes. Kept
            in a local database on this computer, separate per project. Agents
            get the most relevant items as history to check, never as orders.
          </p>
        </div>
        <Button onClick={() => setAdding(!adding)} disabled={!projectId}>
          <Plus size={16} /> Add note
        </Button>
      </div>
      {view && !view.available && (
        <div className="error-banner">Memory database is not available on this computer. Workstream falls back to simple run summaries.</div>
      )}
      <div className="memory-toolbar">
        <label>
          Project
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <label className="connector-search">
          <Search size={16} />
          <input value={query} placeholder="Search memories" onChange={(e) => setQuery(e.target.value)} />
          {query && (
            <button aria-label="Clear search" onClick={() => setQuery("")}>
              <X size={15} />
            </button>
          )}
        </label>
        <span className="muted-note">
          {view?.projectId === projectId ? `${query ? `${items.length} of ` : ""}${view.total} memories` : ""}
        </span>
      </div>
      {adding && (
        <form
          className="panel memory-add"
          onSubmit={async (event) => {
            event.preventDefault();
            if (await send({ type: "memoryAdd", projectId, title, body })) {
              setAdding(false);
              setTitle("");
              setBody("");
            }
          }}
        >
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short title, for example: Prices come from the CMS" required maxLength={300} />
          <textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What agents should know next time. Notes are pinned, so every agent in this project sees them." required maxLength={6000} />
          <div className="button-row">
            <Button disabled={pending}>Save note</Button>
            <Button type="button" variant="outline" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </form>
      )}
      {items.length ? (
        <ul className="memory-list">
          {items.map((item) => (
            <MemoryCard key={`${item.id}-${item.updatedAt}`} item={item} send={send} pending={pending} />
          ))}
        </ul>
      ) : (
        <section className="panel">
          <div className="memory-empty">
            <Brain size={28} />
            <p>{query ? "No memories match your search." : "No memories yet. They are created when runs finish, or add a note."}</p>
          </div>
        </section>
      )}
    </>
  );
}

/** In a run: which memories its agents were given. */
export function RunMemory({ run, onOpen }: { run: Run; onOpen: () => void }) {
  if (!run.memoryUsed?.length) return null;
  return (
    <details className="memory-panel">
      <summary>Memory given to the agents ({run.memoryUsed.length})</summary>
      <ul className="run-memory">
        {run.memoryUsed.map((item) => (
          <li key={item.id}>
            <span className={cn("memory-kind", item.kind)}>{kindLabels[item.kind]}</span> {item.title}
          </li>
        ))}
      </ul>
      <Button variant="outline" size="sm" onClick={onOpen}>
        Open Memory
      </Button>
    </details>
  );
}
