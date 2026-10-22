import { useMemo, useState } from "react";
import {
  BadgeCheck,
  LoaderCircle,
  Monitor,
  Plug,
  Plus,
  Search,
  ShieldCheck,
  X,
  FolderOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandLogo, EngineMark } from "@/components/EngineMark";
import { TechIcon } from "@/components/TechStack";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type {
  AgentMcpEntry,
  Command,
  ConnectorStatus,
  Engine,
  Snapshot,
} from "../../shared/types";

type Send = (command: Command) => Promise<Snapshot | null>;

/** Neutral coloured tiles; vendors' own logos can be dropped in later from their brand kits. */
function Tile({ connector }: { connector: ConnectorStatus }) {
  const tone = connector.custom
    ? "custom"
    : connector.id.startsWith("figma")
      ? "figma"
      : connector.id;
  return (
    <span className={cn("connector-tile", tone)} aria-hidden>
      {connector.custom ? (
        <Plug size={20} />
      ) : connector.id.startsWith("figma") ? (
        <span className="figma-tile-logo">
          <BrandLogo brand="figma" size={22} />
          {connector.id === "figma-desktop" && (
            <Monitor size={12} className="figma-desktop-badge" />
          )}
        </span>
      ) : connector.id === "atlassian" ? (
        <span className="atlassian-tile-logos">
          <TechIcon id="jira" size={14} />
          <TechIcon id="confluence" size={14} />
        </span>
      ) : (
        <strong>{connector.name[0]}</strong>
      )}
    </span>
  );
}

function Row({
  connector,
  snapshot,
  pending,
  send,
}: {
  connector: ConnectorStatus;
  snapshot: Snapshot;
  pending: boolean;
  send: Send;
}) {
  const busy = connector.connecting;
  const sites = snapshot.connectors?.atlassianSites ?? [];
  return (
    <li className="connector-row">
      <Tile connector={connector} />
      <div className="connector-text">
        <div className="connector-title">
          <strong>{connector.name}</strong>
          {!connector.custom && (
            <BadgeCheck size={15} aria-label="Listed by Workstream" />
          )}
        </div>
        {connector.url.includes("figma.com") && (
          <ViaAgents snapshot={snapshot} />
        )}
        <p>
          Connector · by {connector.publisher} · {connector.description}
        </p>
        {connector.connected && (
          <div className="connector-meta">
            <label className="connector-switch">
              <input
                type="checkbox"
                checked={connector.enabled}
                disabled={pending}
                onChange={(event) =>
                  void send({
                    type: "toggleConnector",
                    id: connector.id,
                    enabled: event.target.checked,
                  })
                }
              />
              <span>Agents can read</span>
            </label>
            <span>
              <ShieldCheck size={13} /> {connector.readOnlyTools} of{" "}
              {connector.tools} tools are read-only and offered to agents
            </span>
            {connector.id === "atlassian" && sites.length > 1 && (
              <select
                value={snapshot.connectors?.atlassianSiteId}
                onChange={(event) =>
                  void send({ type: "atlassianSite", id: event.target.value })
                }
              >
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </select>
            )}
            {connector.id === "atlassian" && sites.length === 1 && (
              <span>Jira site: {sites[0].name}</span>
            )}
          </div>
        )}
        {connector.error && <p className="inline-error">{connector.error}</p>}
        {busy && connector.auth === "oauth" && (
          <p className="muted-note">
            Finish the sign-in in your browser. This window updates when you are
            done.
          </p>
        )}
      </div>
      <div className="connector-actions">
        {connector.connected ? (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              void send({ type: "disconnectConnector", id: connector.id })
            }
          >
            Disconnect
          </Button>
        ) : (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() =>
              void send({ type: "connectConnector", id: connector.id })
            }
          >
            {busy && <LoaderCircle className="spin" size={14} />}
            {connector.signedIn && connector.auth === "oauth"
              ? "Reconnect"
              : "Connect"}
          </Button>
        )}
        {connector.custom && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Remove ${connector.name}`}
            disabled={pending}
            onClick={() =>
              void send({ type: "removeConnector", id: connector.id })
            }
          >
            <X size={15} />
          </Button>
        )}
      </div>
    </li>
  );
}

export function ConnectorsPage({
  snapshot,
  pending,
  send,
}: {
  snapshot: Snapshot;
  pending: boolean;
  send: Send;
}) {
  const [tab, setTab] = useState<"yours" | "discover">("yours");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const yours = (c: ConnectorStatus) =>
    c.connected || (c.signedIn && c.auth === "oauth") || c.custom;
  const list = useMemo(
    () =>
      snapshot.connectorList
        .filter((c) => (tab === "yours" ? yours(c) : !yours(c)))
        .filter((c) =>
          `${c.name} ${c.publisher} ${c.description}`
            .toLowerCase()
            .includes(query.toLowerCase()),
        ),
    [snapshot.connectorList, tab, query],
  );
  const yoursCount = snapshot.connectorList.filter(yours).length;
  return (
    <>
      <div className="connectors-head">
        <h1>Connectors</h1>
        <div className="connector-tabs" role="tablist">
          {(["yours", "discover"] as const).map((value) => (
            <button
              key={value}
              role="tab"
              aria-selected={tab === value}
              className={cn(tab === value && "active")}
              onClick={() => setTab(value)}
            >
              {value === "yours" ? "Yours" : "Discover"}
            </button>
          ))}
        </div>
        <label className="connector-search">
          <Search size={16} />
          <input
            value={query}
            placeholder="Search connectors"
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button aria-label="Clear search" onClick={() => setQuery("")}>
              <X size={15} />
            </button>
          )}
        </label>
        <Button onClick={() => setAdding(!adding)}>
          <Plus size={16} /> Add
        </Button>
      </div>
      <p className="muted-note connectors-intro">
        Connectors give agents read-only access to tools like Jira and Figma.
        Sign-in happens in your browser and tokens are stored encrypted on this
        computer. Anything that changes data (like posting to Jira) only happens
        when you click it in a task.
      </p>
      {adding && (
        <form
          className="panel connector-add"
          onSubmit={async (event) => {
            event.preventDefault();
            if (await send({ type: "addConnector", name, url })) {
              setAdding(false);
              setName("");
              setUrl("");
              setTab("yours");
            }
          }}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name, for example Internal docs"
            required
            maxLength={80}
          />
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/mcp"
            required
            type="url"
          />
          <Button disabled={pending}>Add connector</Button>
        </form>
      )}
      <h2 className="connectors-count">
        {tab === "yours" ? "Yours" : "Discover"}{" "}
        <span>
          {tab === "yours"
            ? yoursCount
            : snapshot.connectorList.length - yoursCount}
        </span>
      </h2>
      {list.length ? (
        <ul className="connector-list">
          {list.map((connector) => (
            <Row
              key={connector.id}
              connector={connector}
              snapshot={snapshot}
              pending={pending}
              send={send}
            />
          ))}
        </ul>
      ) : (
        <p className="muted-note">
          {tab === "yours"
            ? "No connectors yet. Open Discover to connect Jira or Figma."
            : "Nothing matches your search."}
        </p>
      )}
      <AgentConnections snapshot={snapshot} pending={pending} send={send} />
    </>
  );
}

/** Explicit, user-triggered Jira update after the PR exists. */
export function JiraUpdate({
  run,
  snapshot,
  pending,
  send,
}: {
  run: import("../../shared/types").Run;
  snapshot: Snapshot;
  pending: boolean;
  send: Send;
}) {
  const [comment, setComment] = useState(
    `Pull request: ${run.prUrl}\n\n${run.plan?.summary ?? run.title}`,
  );
  const [transition, setTransition] = useState("");
  const [confirmAgain, setConfirmAgain] = useState(false);
  const transitions = snapshot.jiraTransitions?.[run.id];
  return (
    <section className="panel detail-section jira-update">
      <h2>Update {run.ticketKey} in Jira</h2>
      <p>
        Nothing is sent until you click Post to Jira. The comment and status
        change are made with your Atlassian account.
      </p>
      <textarea
        className="jira-comment"
        rows={4}
        value={comment}
        onChange={(event) => setComment(event.target.value)}
      />
      <div className="button-row">
        {transitions ? (
          <select
            value={transition}
            onChange={(event) => setTransition(event.target.value)}
          >
            <option value="">Keep current status</option>
            {transitions.map((option) => (
              <option key={option.id} value={option.id}>
                Move to {option.name}
              </option>
            ))}
          </select>
        ) : (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              void send({ type: "jiraTransitions", runId: run.id })
            }
          >
            Load statuses
          </Button>
        )}
        <Button
          disabled={pending || (!comment.trim() && !transition)}
          onClick={async () => {
            if (run.jiraUpdatedAt && !confirmAgain) {
              setConfirmAgain(true);
              return;
            }
            if (
              await send({
                type: "updateJira",
                runId: run.id,
                comment,
                ...(transition ? { transitionId: transition } : {}),
              })
            )
              setConfirmAgain(false);
          }}
        >
          <TechIcon id="jira" size={13} />{" "}
          {confirmAgain ? "Post again to Jira" : "Post to Jira"}
        </Button>
      </div>
      {run.jiraUpdatedAt && (
        <p className="muted-note">
          Last posted {new Date(run.jiraUpdatedAt).toLocaleString()}.
          {confirmAgain && " Click again to post another comment."}
        </p>
      )}
    </section>
  );
}

/** After the PR: check the branch out in your own repo folder and start localhost. */
export function TryLocally({
  run,
  project,
  pending,
  send,
  error,
}: {
  run: import("../../shared/types").Run;
  project: import("../../shared/types").Project;
  pending: boolean;
  send: Send;
  /** The app's latest error, shown here so a failed click is visible next to the button. */
  error?: string;
}) {
  const [last, setLast] = useState<{
    label: string;
    ok: boolean;
    activity?: string;
  } | null>(null);
  const act = async (label: string, command: Command) => {
    setLast(null);
    const next = await send(command);
    const updated = next?.runs.find((r) => r.id === run.id);
    setLast({
      label,
      ok: Boolean(next),
      activity: updated?.activity.at(-1)?.text,
    });
  };
  // Older runs do not know yet; then both buttons are offered.
  const onBranch = run.repoCheckedOut ?? true;
  const offBranch = run.repoCheckedOut === undefined || !run.repoCheckedOut;
  const folder = run.worktreeRemoved ? project.path : run.worktree;
  return (
    <section className="panel detail-section try-locally">
      <h2>Try it locally</h2>
      {!run.worktreeRemoved ? (
        <>
          <p>
            Check out <code>{run.branch}</code> in your repository folder (
            {project.path}) to test it with your own node_modules and settings.
            Workstream first removes the task worktree; the branch and the
            pushed commit are kept. It stops without changing anything if your
            repository has uncommitted changes.
          </p>
          <p className="muted-note">Worktree: {run.worktree}</p>
        </>
      ) : (
        <p>
          {run.repoCheckedOut === false ? (
            <>
              Your repository ({project.path}) is back on{" "}
              <code>{run.previousRepoBranch ?? "another branch"}</code>. Check
              out <code>{run.branch}</code> again to test it.
            </>
          ) : (
            <>
              <code>{run.branch}</code> is checked out in {project.path}
              {run.previousRepoBranch && (
                <>
                  {" "}
                  (it was on <code>{run.previousRepoBranch}</code> before)
                </>
              )}
              .
            </>
          )}
          {run.devServer?.url && (
            <>
              {" "}
              Dev server: <code>{run.devServer.url}</code>
            </>
          )}
        </p>
      )}
      <div className="button-row">
        <Button
          disabled={pending}
          onClick={() =>
            void act("Open in VS Code", { type: "openInEditor", runId: run.id })
          }
          title={folder}
        >
          <TechIcon id="vscode" size={14} /> Open in VS Code
        </Button>
        {!run.worktreeRemoved ? (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              void act("Check out in my repo", {
                type: "checkoutInRepo",
                runId: run.id,
              })
            }
          >
            <TechIcon id="git" size={13} /> Check out in my repo
          </Button>
        ) : (
          <>
            {onBranch && (
              <Button
                variant="outline"
                disabled={pending}
                onClick={() =>
                  void act(run.devServer ? "Stop localhost" : "Start localhost", {
                    type: run.devServer ? "stopDevServer" : "startDevServer",
                    runId: run.id,
                  })
                }
              >
                <TechIcon id="node" size={13} />{" "}
                {run.devServer ? (run.devServer.url ? "Stop localhost" : "Starting… (stop)") : "Start localhost"}
              </Button>
            )}
            {offBranch && (
              <Button
                variant="outline"
                disabled={pending}
                onClick={() =>
                  void act("Check out again", {
                    type: "checkoutInRepo",
                    runId: run.id,
                  })
                }
              >
                <TechIcon id="git" size={13} /> Check out again
              </Button>
            )}
            {onBranch && run.previousRepoBranch && (
              <Button
                variant="outline"
                disabled={pending}
                onClick={() =>
                  void act(`Switch back to ${run.previousRepoBranch}`, {
                    type: "switchRepoBack",
                    runId: run.id,
                  })
                }
              >
                <TechIcon id="git" size={13} /> Switch back to{" "}
                {run.previousRepoBranch}
              </Button>
            )}
          </>
        )}
        <Button
          variant="outline"
          onClick={() =>
            void act("Open folder", { type: "openFolder", runId: run.id })
          }
        >
          <FolderOpen size={14} /> Open folder
        </Button>
      </div>
      {pending && <p className="muted-note">Working…</p>}
      {!pending && last && (
        <p className={last.ok ? "try-result ok" : "inline-error"} role="status">
          {last.label}:{" "}
          {last.ok
            ? (last.activity ?? "Done.")
            : error ||
              "It did not work. See the message at the top of the page."}
        </p>
      )}
    </section>
  );
}

const stateLabel: Record<AgentMcpEntry["state"], string> = {
  connected: "Connected",
  "signed-in": "Signed in",
  "needs-auth": "Needs sign-in",
  failed: "Cannot connect",
  configured: "Configured",
  disabled: "Disabled",
  unknown: "Status unknown",
};
const okStates = new Set<AgentMcpEntry["state"]>([
  "connected",
  "signed-in",
  "configured",
]);
const engineLabel: Record<Engine, string> = {
  claude: "Claude Code",
  codex: "Codex",
  copilot: "GitHub Copilot",
};

/** "Available through Claude Code: Connected" on the Figma row. */
function ViaAgents({ snapshot }: { snapshot: Snapshot }) {
  const found = (["claude", "codex"] as const).flatMap((engine) =>
    (snapshot.agentMcp?.[engine]?.servers ?? [])
      .filter(
        (server) =>
          server.url?.includes("figma.com") || /figma/i.test(server.name),
      )
      .map((server) => ({ engine, server })),
  );
  if (!found.length) return null;
  return (
    <div className="via-agents">
      {found.map(({ engine, server }) => (
        <span
          key={engine + server.name}
          className={cn(
            "agent-mcp-chip",
            okStates.has(server.state) ? "ok" : "warn",
          )}
        >
          {okStates.has(server.state) ? (
            <BadgeCheck size={13} />
          ) : (
            <X size={13} />
          )}
          Through {engineLabel[engine]}: {stateLabel[server.state]}
        </span>
      ))}
    </div>
  );
}

/**
 * The MCP servers Claude Code and Codex have in their own settings, signed in
 * with your accounts there (for example Figma, which only allows approved apps).
 */
function AgentConnections({
  snapshot,
  pending,
  send,
}: {
  snapshot: Snapshot;
  pending: boolean;
  send: Send;
}) {
  const reports = snapshot.agentMcp ?? {};
  const checking = snapshot.agentMcpChecking;
  return (
    <section className="panel detail-section agent-connections">
      <div className="agent-connections-head">
        <div>
          <h2>Your agents' own connections</h2>
          <p className="muted-note">
            MCP servers you added in Claude Code or Codex, signed in with your
            accounts there. Workstream asks each tool for this list; it never
            reads their tokens.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={pending || checking}
          onClick={() => void send({ type: "checkAgentMcp" })}
        >
          {checking ? <LoaderCircle size={14} className="spin" /> : null}
          {checking ? "Checking…" : "Check again"}
        </Button>
      </div>
      <div className="agent-connections-grid">
        {(["claude", "codex"] as const).map((engine) => {
          const report = reports[engine];
          return (
            <div key={engine} className="agent-connection-card">
              <h3 className="engine-heading">
                <EngineMark engine={engine} size={16} /> {engineLabel[engine]}
              </h3>
              {!report ? (
                <p className="muted-note">
                  {checking ? "Checking…" : "Not checked yet."}
                </p>
              ) : report.error ? (
                <p className="inline-error">Could not check: {report.error}</p>
              ) : report.servers.length ? (
                <ul>
                  {report.servers.map((server) => (
                    <li key={server.name}>
                      <span
                        className={cn(
                          "agent-mcp-chip",
                          okStates.has(server.state) ? "ok" : "warn",
                        )}
                      >
                        {okStates.has(server.state) ? (
                          <BadgeCheck size={13} />
                        ) : (
                          <X size={13} />
                        )}
                        {stateLabel[server.state]}
                      </span>
                      <strong>{server.name}</strong>
                      {server.url && <code>{server.url}</code>}
                      {server.detail && (
                        <small
                          className={
                            okStates.has(server.state) ? "ok-detail" : undefined
                          }
                        >
                          {server.detail}
                        </small>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted-note">
                  No MCP servers added in {engineLabel[engine]}.
                </p>
              )}
              <p className="muted-note">
                {engine === "claude"
                  ? "Workstream's Claude agents get your remote servers from Claude Code with read-only tools; anything that would change data is refused."
                  : "Codex loads these itself, so Workstream's Codex agents can use them as you set them up in Codex."}
                {report &&
                  ` Checked ${new Date(report.checkedAt).toLocaleTimeString()}.`}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
