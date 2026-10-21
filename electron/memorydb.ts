import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { MemoryItem, MemoryKind, Run } from "../shared/types";

/** Removes things that look like credentials before anything is stored. */
export function redactSecrets(text: string) {
  return text
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[redacted private key]")
    .replace(/\b(?:sk-ant-[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abpr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})\b/g, "[redacted token]")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g, "[redacted token]")
    .replace(/(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi, "$1 [redacted]")
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[redacted]@")
    .replace(/\b([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY|CLIENT_?SECRET|CONNECTION_?STRING)[A-Z0-9_]*)\s*[:=]\s*["']?[^\s"']{4,}/gi, "$1=[redacted]")
    .replace(/\b(AccountKey|SharedAccessKey|Password|Pwd)=[^;\s]+/gi, "$1=[redacted]");
}

type Row = {
  id: string;
  project_id: string;
  run_id: string | null;
  run_label: string | null;
  kind: string;
  title: string;
  body: string;
  files: string;
  pinned: number;
  source: string;
  created_at: string;
  updated_at: string;
  uses: number;
  rank?: number;
};
const toItem = (row: Row): MemoryItem => ({
  id: row.id,
  projectId: row.project_id,
  runId: row.run_id ?? undefined,
  runLabel: row.run_label ?? undefined,
  kind: row.kind as MemoryKind,
  title: row.title,
  body: row.body,
  files: JSON.parse(row.files || "[]") as string[],
  pinned: Boolean(row.pinned),
  source: row.source as "auto" | "user",
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  uses: row.uses,
});

/** Turns a finished run into memory items: what was done, your feedback, review findings and failed checks. */
export function extractMemories(run: Run): Omit<MemoryItem, "id" | "projectId" | "createdAt" | "updatedAt" | "uses" | "pinned" | "source">[] {
  if (!run.plan && !run.development) return [];
  const label = run.ticketKey || run.title.slice(0, 40);
  const items: ReturnType<typeof extractMemories> = [];
  const review = run.reviews.at(-1);
  const passed = review?.verdict === "pass";
  items.push({
    runId: run.id,
    runLabel: label,
    kind: "outcome",
    title: `${run.ticketKey ? `${run.ticketKey}: ` : ""}${run.title}`,
    body: [
      // After change requests, run.plan is the latest change plan; keep the original too.
      run.revisions?.[0]?.previousPlan
        ? `Original plan: ${run.revisions[0].previousPlan.summary}`
        : run.plan?.summary && `Plan: ${run.plan.summary}`,
      run.revisions?.[0]?.previousDevelopment?.summary &&
        `First version built: ${run.revisions[0].previousDevelopment.summary}`,
      ...(run.revisions ?? []).map(
        (r) =>
          `Change request ${r.number}${r.completedAt ? " (pushed)" : " (in progress)"}: ${r.request.replace(/\s+/g, " ").slice(0, 400)}${r.developmentSummary ? ` -> ${r.developmentSummary}` : ""}`,
      ),
      run.revisions?.length
        ? run.development?.summary && `Latest change built: ${run.development.summary}`
        : run.development?.summary && `Built: ${run.development.summary}`,
      `Status: ${run.stage === "complete" ? "PR created" : run.status === "blocked" ? "stopped, unresolved" : run.stage}`,
      run.prUrl && `PR: ${run.prUrl}`,
      run.development?.limitations.length ? `Limitations: ${run.development.limitations.join("; ")}` : "",
      review?.acceptanceGaps.length ? `Open gaps: ${review.acceptanceGaps.join("; ")}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    files: run.files.slice(0, 60),
  });
  for (const revision of run.revisions ?? [])
    items.push({
      runId: run.id,
      runLabel: label,
      kind: "feedback",
      title: `Your change request ${revision.number} on ${label} after the PR`,
      body: revision.request,
      files: [],
    });
  // Change requests are recorded above with their own title.
  for (const feedback of (run.planFeedback ?? []).filter((f) => !f.startsWith("Change request after the PR:")))
    items.push({ runId: run.id, runLabel: label, kind: "feedback", title: `Your plan feedback on ${label}`, body: feedback, files: [] });
  const seen = new Set<string>();
  for (const r of run.reviews)
    for (const finding of r.findings) {
      if (finding.severity === "info" || seen.has(finding.scenario)) continue;
      seen.add(finding.scenario);
      if (seen.size > 8) break;
      items.push({
        runId: run.id,
        runLabel: label,
        kind: "finding",
        title: `Review ${finding.severity} in ${finding.file || "the change"}${passed ? " (fixed)" : ""}`,
        body: `${finding.scenario}\nRecommendation: ${finding.recommendation}`,
        files: finding.file ? [finding.file] : [],
      });
    }
  for (const check of run.checks.filter((c) => !c.passed).slice(0, 4))
    items.push({
      runId: run.id,
      runLabel: label,
      kind: "check",
      title: `Check failed: ${check.name}`,
      body: `${check.executable} ${check.args.join(" ")}\n${check.output.slice(-600)}`,
      files: [],
    });
  return items;
}

const words = (text: string) =>
  [...new Set((text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((w) => !stop.has(w)))].slice(0, 40);
const stop = new Set(["the", "and", "for", "with", "that", "this", "from", "into", "should", "when", "will", "are", "not", "but", "can", "have", "has", "all", "any", "som", "och", "att", "det", "för", "med", "inte", "ska", "kan"]);

/**
 * Local project memory in SQLite with full-text search. One file in the app
 * data folder. Agents never touch it: Workstream looks up relevant items and
 * hands them over as labelled, untrusted history. Projects never share memories.
 */
export class MemoryDb {
  private db: DatabaseSync;
  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        run_id TEXT,
        run_label TEXT,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        files TEXT NOT NULL DEFAULT '[]',
        pinned INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'auto',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        uses INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS memories_project ON memories(project_id);
      CREATE INDEX IF NOT EXISTS memories_run ON memories(run_id);
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        title, body, files, content='memories', content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 2'
      );
      CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, title, body, files) VALUES (new.rowid, new.title, new.body, new.files);
      END;
      CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, title, body, files) VALUES ('delete', old.rowid, old.title, old.body, old.files);
      END;
      CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, title, body, files) VALUES ('delete', old.rowid, old.title, old.body, old.files);
        INSERT INTO memories_fts(rowid, title, body, files) VALUES (new.rowid, new.title, new.body, new.files);
      END;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    `);
  }
  meta(key: string, value?: string) {
    if (value !== undefined) this.db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)").run(key, value);
    return (this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value?: string } | undefined)?.value;
  }
  private insert(projectId: string, item: Partial<MemoryItem> & Pick<MemoryItem, "kind" | "title" | "body">, source: "auto" | "user") {
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO memories (id, project_id, run_id, run_label, kind, title, body, files, pinned, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, projectId, item.runId ?? null, item.runLabel ?? null, item.kind, redactSecrets(item.title).slice(0, 300), redactSecrets(item.body).slice(0, 6000), JSON.stringify(item.files ?? []), item.pinned ? 1 : 0, source, now, now);
    return id;
  }
  /** Replaces the automatic memories of a run. Your own notes and pinned items are kept. */
  recordRun(run: Run) {
    const pinned = new Set(
      (this.db.prepare("SELECT title FROM memories WHERE run_id = ? AND source = 'auto' AND pinned = 1").all(run.id) as { title: string }[]).map((r) => r.title),
    );
    this.db.prepare("DELETE FROM memories WHERE run_id = ? AND source = 'auto' AND pinned = 0").run(run.id);
    for (const item of extractMemories(run)) if (!pinned.has(redactSecrets(item.title).slice(0, 300))) this.insert(run.projectId, item, "auto");
  }
  add(projectId: string, title: string, body: string) {
    return this.insert(projectId, { kind: "note", title, body, pinned: true }, "user");
  }
  update(id: string, patch: { title?: string; body?: string; pinned?: boolean }) {
    const row = this.db.prepare("SELECT * FROM memories WHERE id = ?").get(id) as Row | undefined;
    if (!row) throw new Error("Memory not found.");
    this.db
      .prepare("UPDATE memories SET title = ?, body = ?, pinned = ?, updated_at = ? WHERE id = ?")
      .run(
        patch.title !== undefined ? redactSecrets(patch.title).slice(0, 300) : row.title,
        patch.body !== undefined ? redactSecrets(patch.body).slice(0, 6000) : row.body,
        patch.pinned !== undefined ? (patch.pinned ? 1 : 0) : row.pinned,
        new Date().toISOString(),
        id,
      );
  }
  delete(id: string) {
    this.db.prepare("DELETE FROM memories WHERE id = ?").run(id);
  }
  deleteProject(projectId: string) {
    this.db.prepare("DELETE FROM memories WHERE project_id = ?").run(projectId);
  }
  count(projectId: string) {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM memories WHERE project_id = ?").get(projectId) as { n: number }).n;
  }
  hasRun(runId: string) {
    return Boolean(this.db.prepare("SELECT 1 FROM memories WHERE run_id = ? LIMIT 1").get(runId));
  }
  /** For the Memory page: newest first, or by relevance when searching. */
  list(projectId: string, query = "", limit = 200): MemoryItem[] {
    const terms = words(query);
    if (!terms.length)
      return (this.db.prepare("SELECT * FROM memories WHERE project_id = ? ORDER BY pinned DESC, updated_at DESC LIMIT ?").all(projectId, limit) as Row[]).map(toItem);
    return (
      this.db
        .prepare("SELECT m.*, bm25(memories_fts, 3.0, 1.0, 2.0) AS rank FROM memories_fts JOIN memories m ON m.rowid = memories_fts.rowid WHERE memories_fts MATCH ? AND m.project_id = ? ORDER BY rank LIMIT ?")
        .all(terms.map((t) => `"${t}"`).join(" OR "), projectId, limit) as Row[]
    ).map(toItem);
  }
  /**
   * Picks memories for an agent: pinned items first, then full-text relevance
   * to the task boosted by files the two tasks share, within a size budget.
   */
  forTask(run: Run, budget = 6000, max = 8): MemoryItem[] {
    const terms = words(`${run.ticketKey} ${run.title} ${run.description.slice(0, 4000)} ${run.plan?.summary ?? ""}`);
    const pinned = (this.db.prepare("SELECT * FROM memories WHERE project_id = ? AND pinned = 1 AND (run_id IS NULL OR run_id != ?) ORDER BY updated_at DESC LIMIT 20").all(run.projectId, run.id) as Row[]).map(toItem);
    const candidates = terms.length
      ? (this.db
          .prepare("SELECT m.*, bm25(memories_fts, 3.0, 1.0, 2.0) AS rank FROM memories_fts JOIN memories m ON m.rowid = memories_fts.rowid WHERE memories_fts MATCH ? AND m.project_id = ? AND (m.run_id IS NULL OR m.run_id != ?) AND m.pinned = 0 ORDER BY rank LIMIT 40")
          .all(terms.map((t) => `"${t}"`).join(" OR "), run.projectId, run.id) as Row[])
      : [];
    const files = new Set(run.files);
    const scored = candidates
      .map((row) => {
        const item = toItem(row);
        const shared = item.files.filter((f) => files.has(f)).length;
        return { item, score: -(row.rank ?? 0) + shared * 2 + (item.kind === "feedback" ? 0.5 : 0) };
      })
      .sort((a, b) => b.score - a.score)
      .map((x) => x.item);
    const picked: MemoryItem[] = [];
    let used = 0;
    for (const item of [...pinned, ...scored]) {
      const size = item.title.length + item.body.length + 40;
      if (picked.length >= max || used + size > budget) continue;
      picked.push(item);
      used += size;
    }
    if (picked.length)
      this.db.prepare(`UPDATE memories SET uses = uses + 1 WHERE id IN (${picked.map(() => "?").join(",")})`).run(...picked.map((p) => p.id));
    return picked;
  }
  close() {
    this.db.close();
  }
}
