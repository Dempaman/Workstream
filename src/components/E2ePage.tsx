import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  CircleDot,
  Code2,
  FolderGit2,
  MinusCircle,
  Film,
  Globe,
  Image,
  LoaderCircle,
  Play,
  RotateCcw,
  Square,
  Trash2,
  Waypoints,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Command, E2eResult, Project, Run, Snapshot } from "../../shared/types";

type Send = (command: Command) => Promise<Snapshot | null>;

const defaultUrl = "http://localhost:3000/sv/";
const ago = (iso: string) => {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : minutes < 1440 ? `${Math.round(minutes / 60)} h ago` : new Date(iso).toLocaleDateString();
};
const seconds = (ms: number) => (ms < 60000 ? `${Math.round(ms / 1000)} s` : `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`);

const pillText = { passed: "Passed", failed: "Failed", error: "Could not run", skipped: "Skipped (not recorded yet)" };
export function ResultPill({ result }: { result?: E2eResult }) {
  if (!result) return <span className="e2e-pill none">Not run yet</span>;
  const Icon = result.status === "passed" ? CheckCircle2 : result.status === "failed" ? XCircle : result.status === "skipped" ? MinusCircle : AlertTriangle;
  return (
    <span className={cn("e2e-pill", result.status)}>
      <Icon size={13} /> {pillText[result.status]}
    </span>
  );
}
/** Whether the project runs the repository's own suite. */
export const repoMode = (project: Project) =>
  Boolean(project.e2eConfig) && (project.e2e?.source ?? "repository") === "repository";
interface Item {
  id: string;
  name: string;
  /** Repository tests: file:line. */
  file?: string;
  result?: E2eResult;
}

function Activity({ project, send, pending }: { project: Project; send: Send; pending: boolean }) {
  const activity = project.e2eActivity;
  if (!activity) return null;
  const stop = (
    <Button variant="outline" size="sm" disabled={pending} onClick={() => void send({ type: "e2eStop", projectId: project.id })}>
      <Square size={12} /> Stop
    </Button>
  );
  if (activity.kind === "recording")
    return (
      <div className="e2e-activity recording" role="status">
        <span className="rec-dot" aria-hidden />
        <div>
          <strong>Recording in your browser</strong>
          <p>Do the steps in the browser window. Close the window when you are done, and the journey is saved.</p>
        </div>
        {stop}
      </div>
    );
  return (
    <div className="repo-progress e2e-progress" role="status" aria-live="polite">
      <div className="repo-progress-bar indeterminate" aria-hidden>
        <span />
      </div>
      <div className="e2e-progress-head">
        <LoaderCircle size={14} className="spin" />
        <strong>Running {activity.current ?? "journey"}</strong>
        {activity.queue.length > 0 && <span className="muted-note">{activity.queue.length} more after this</span>}
        {stop}
      </div>
      {activity.output.length > 0 && (
        <ul className="skill-activity">
          {activity.output.map((line, i) => (
            <li key={`${i}-${line}`}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function JourneyRow({ project, journey, send, pending, busy }: { project: Project; journey: Item; send: Send; pending: boolean; busy: boolean }) {
  const [name, setName] = useState(journey.name);
  const result = journey.result;
  const repo = Boolean(journey.file);
  const open = (what: "code" | "screenshot" | "trace" | "video") =>
    void send({ type: "e2eOpen", projectId: project.id, journeyId: journey.id, what });
  const running = project.e2eActivity?.journeyId === journey.id;
  return (
    <li className={cn("journey", result?.status, running && "running")}>
      <div className="journey-head">
        <Waypoints size={16} />
        {repo ? (
          <span className="journey-title">
            {journey.name}
            <code>{journey.id}</code>
          </span>
        ) : (
          <input
            className="journey-name"
            value={name}
            maxLength={120}
            aria-label="Journey name"
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && name !== journey.name && void send({ type: "e2eRename", projectId: project.id, journeyId: journey.id, name })}
          />
        )}
        {running ? <span className="e2e-pill running"><LoaderCircle size={13} className="spin" /> Running</span> : <ResultPill result={result} />}
        {result && (
          <small>
            {ago(result.startedAt)}
            {result.durationMs ? ` · ${seconds(result.durationMs)}` : ""}
            {result.branch ? ` · ${result.branch}` : ""}
          </small>
        )}
      </div>
      {result?.error && <pre className="journey-error">{result.error}</pre>}
      <div className="button-row">
        <Button size="sm" disabled={pending || busy} onClick={() => void send({ type: "e2eRun", projectId: project.id, journeyIds: [journey.id] })}>
          <Play size={13} /> Run
        </Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => open("code")}>
          <Code2 size={13} /> {repo ? "Open file" : "Steps"}
        </Button>
        {result?.screenshot && (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => open("screenshot")}>
            <Image size={13} /> Screenshot
          </Button>
        )}
        {result?.trace && (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => open("trace")}>
            <CircleDot size={13} /> Trace
          </Button>
        )}
        {result?.video && (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => open("video")}>
            <Film size={13} /> Video
          </Button>
        )}
        {!repo && (
          <>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending || busy}
              onClick={() => void send({ type: "e2eRecord", projectId: project.id, journeyId: journey.id, name: journey.name })}
            >
              <RotateCcw size={13} /> Record again
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="danger-text"
              disabled={pending || busy}
              onClick={() => void send({ type: "e2eDelete", projectId: project.id, journeyId: journey.id })}
            >
              <Trash2 size={13} /> Delete
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

function Settings({ project, send, pending }: { project: Project; send: Send; pending: boolean }) {
  const e2e = project.e2e;
  const [baseUrl, setBaseUrl] = useState(e2e?.baseUrl ?? defaultUrl);
  const [browser, setBrowser] = useState<"msedge" | "chrome">(e2e?.browser ?? "msedge");
  const [headed, setHeaded] = useState(e2e?.headed ?? true);
  const [username, setUsername] = useState(e2e?.username ?? "");
  const [password, setPassword] = useState("");
  const [source, setSource] = useState<"repository" | "workstream">(e2e?.source ?? (project.e2eConfig ? "repository" : "workstream"));
  const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(baseUrl.trim());
  const save = async (extra: Partial<Extract<Command, { type: "e2eSettings" }>> = {}) => {
    if (await send({ type: "e2eSettings", projectId: project.id, baseUrl: baseUrl.trim(), browser, headed, source, username: username.trim(), ...(password ? { password } : {}), ...extra }))
      setPassword("");
  };
  return (
    <section className="panel e2e-settings">
      <h2>
        <Globe size={16} /> Test site
      </h2>
      {project.e2eConfig && (
        <fieldset className="skill-location e2e-source">
          <legend>Which tests</legend>
          <label className={cn(source === "repository" && "on")}>
            <input type="radio" name={`e2e-source-${project.id}`} checked={source === "repository"} onChange={() => setSource("repository")} />
            <FolderGit2 size={16} />
            <span>
              <strong>The repository's tests</strong>
              <small>
                The Playwright suite in {project.name} ({project.e2eConfig}, npm run test:e2e). The same tests you run in VS Code.
              </small>
            </span>
          </label>
          <label className={cn(source === "workstream" && "on")}>
            <input type="radio" name={`e2e-source-${project.id}`} checked={source === "workstream"} onChange={() => setSource("workstream")} />
            <Waypoints size={16} />
            <span>
              <strong>Journeys kept in Workstream</strong>
              <small>Recorded here and stored only in Workstream, outside the repository.</small>
            </span>
          </label>
        </fieldset>
      )}
      <div className="e2e-fields">
        <label>
          Address
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={defaultUrl} />
          {!local && <small className="bad">Only localhost is allowed: it is the dev server connected to integration.</small>}
        </label>
        <label>
          Browser
          <select value={browser} onChange={(e) => setBrowser(e.target.value as "msedge" | "chrome")}>
            <option value="msedge">Microsoft Edge</option>
            <option value="chrome">Google Chrome</option>
          </select>
        </label>
        <label>
          Test account
          <input value={username} autoComplete="off" onChange={(e) => setUsername(e.target.value)} placeholder="User name or e-mail" />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            autoComplete="new-password"
            onChange={(e) => setPassword(e.target.value)}
            placeholder={e2e?.hasPassword ? "Saved (type to replace)" : "Not saved"}
          />
        </label>
      </div>
      <label className="e2e-check">
        <input type="checkbox" checked={headed} onChange={(e) => setHeaded(e.target.checked)} /> Show the browser while the tests run
      </label>
      <p className="muted-note">
        The password is encrypted with Windows credential protection. Only the test run gets it, through an environment
        variable{project.e2eConfig ? " (E2E_USERNAME and E2E_PASSWORD, which win over .env.local)" : ""}. Agents never see it,
        and recordings never contain it.
      </p>
      <div className="button-row">
        <Button disabled={pending || !local} onClick={() => void save()}>
          Save test site
        </Button>
        {e2e?.hasPassword && (
          <Button variant="ghost" disabled={pending} onClick={() => void save({ password: null })}>
            Remove password
          </Button>
        )}
        {e2e && (
          <>
            <span className={cn("e2e-site", e2e.reachable ? "up" : e2e.reachable === false ? "down" : "")}>
              <Circle size={9} fill="currentColor" />
              {e2e.reachable ? "Site is running" : e2e.reachable === false ? "Site is not running" : "Not checked"}
            </span>
            <Button variant="outline" size="sm" disabled={pending} onClick={() => void send({ type: "e2eStartSite", projectId: project.id })}>
              {e2e.reachable ? "Check again" : "Start site"}
            </Button>
          </>
        )}
      </div>
    </section>
  );
}

/** Reads the repository's test list once when the page opens on a project. */
function ListOnOpen({ project, send }: { project: Project; send: Send }) {
  useEffect(() => {
    if (project.e2e) void send({ type: "e2eListRepo", projectId: project.id });
    // Once per project; the list refreshes after each run.
  }, [project.id]);
  return null;
}

/** The E2E tests page: test site, recorded journeys and their results. */
export function E2ePage({ snapshot, pending, send }: { snapshot: Snapshot; pending: boolean; send: Send }) {
  const projects = snapshot.projects.filter((p) => !p.archived);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const project = projects.find((p) => p.id === projectId) ?? projects[0];
  const [name, setName] = useState("Checkout: log in, buy a product and complete the order");
  if (!project)
    return (
      <div className="page-heading">
        <div>
          <h1>E2E tests</h1>
          <p>Connect a project first.</p>
        </div>
      </div>
    );
  const repo = repoMode(project);
  const items: Item[] = repo
    ? (project.repoTests ?? []).map((t) => ({ id: t.id, name: t.title, file: t.file, result: t.result }))
    : (project.journeys ?? []).map((j) => ({ id: j.id, name: j.name, result: j.lastResult }));
  const busy = Boolean(project.e2eActivity);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">CHECK THE WHOLE SITE STILL WORKS</div>
          <h1>E2E tests</h1>
          <p>
            Record a user journey once, such as logging in, buying a product and completing the order. Workstream replays it
            with Playwright in your browser whenever you want, and after a task is checked out, so you know nothing broke.
            {repo
              ? ` This project has its own suite (${project.e2eConfig}): Workstream runs those tests, the same ones you run in VS Code.`
              : " The tests live in Workstream, not in the repository."}
          </p>
        </div>
        <label className="e2e-project">
          Project
          <select value={project.id} onChange={(e) => setProjectId(e.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Settings key={project.id} project={project} send={send} pending={pending} />
      <section className="panel e2e-journeys">
        <div className="e2e-journeys-head">
          <h2>
            <Waypoints size={16} /> {repo ? "Tests in the repository" : "Journeys"}
          </h2>
          {repo && <ListOnOpen project={project} send={send} />}
          {(items.length > 1 || (repo && items.length > 0)) && (
            <Button disabled={pending || busy || !project.e2e} onClick={() => void send({ type: "e2eRun", projectId: project.id })}>
              <Play size={14} /> Run all
            </Button>
          )}
        </div>
        {project.e2eError && (
          <p className="inline-error">
            <AlertTriangle size={14} /> {project.e2eError}
          </p>
        )}
        <Activity project={project} send={send} pending={pending} />
        {project.e2eNotice && (
          <p className="e2e-notice">
            <CheckCircle2 size={14} /> {project.e2eNotice}
          </p>
        )}
        {repo && !items.length && (
          <p className="muted-note">No tests found yet in {project.name}. Record one below, or in VS Code.</p>
        )}
        {items.length > 0 && (
          <ul className="journey-list">
            {items.map((journey) => (
              <JourneyRow key={journey.id} project={project} journey={journey} send={send} pending={pending} busy={busy} />
            ))}
          </ul>
        )}
        <div className="e2e-new">
          <label>
            {repo ? "New test (saved in the repository's e2e folder)" : "New journey"}
            <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          </label>
          <Button
            disabled={pending || busy || !project.e2e || !name.trim()}
            title={project.e2e ? undefined : "Save the test site first"}
            onClick={() => void send({ type: "e2eRecord", projectId: project.id, name: name.trim() })}
          >
            <span className="rec-dot small" aria-hidden /> Record
          </Button>
        </div>
        <details className="e2e-howto" open={!items.length || items.every((i) => i.result?.status === "skipped")}>
          <summary>How to record a good checkout journey</summary>
          <ol>
            <li>Make sure the site is running (Start site), then press Record. A browser opens on the test site with a recorder bar.</li>
            <li>Log in with the test account. Type the user name and password you saved above: Workstream swaps them for the saved account, so they are never stored in the journey.</li>
            <li>Go to the product page, add it to the cart, open the cart and check out.</li>
            <li>Choose the payment method your test account can use (invoice, or an Adyen test card) and place the order.</li>
            <li>On the confirmation page, pick the recorder's "Assert visibility" tool and click the thank-you heading. That is what makes the test prove the order went through.</li>
            <li>
              Close the browser window.{" "}
              {repo
                ? "The test is saved in the repository's e2e folder, ready to run here and in VS Code. Commit it when you are happy with it."
                : "The journey is saved here, ready to run."}
            </li>
          </ol>
        </details>
      </section>
    </>
  );
}

/** On a task: run the journeys against the checked-out branch. */
export function TaskE2e({ run, project, send, pending }: { run: Run; project: Project; send: Send; pending: boolean }) {
  const count = repoMode(project) ? (project.repoTests ?? []).length : (project.journeys ?? []).length;
  if (!count || !project.e2e) return null;
  const results = run.e2e ?? [];
  const running = project.e2eActivity?.runId === run.id;
  const ready = run.worktreeRemoved && run.repoCheckedOut !== false;
  return (
    <section className="panel detail-section task-e2e">
      <div className="e2e-journeys-head">
        <h2>
          <Waypoints size={16} /> End-to-end tests
        </h2>
        <Button
          disabled={pending || Boolean(project.e2eActivity) || !ready}
          title={ready ? undefined : "Check out the branch in your repo and start localhost first"}
          onClick={() => void send({ type: "e2eRun", projectId: project.id, runId: run.id })}
        >
          <Play size={14} /> {results.length ? "Run again" : `Run ${count} ${count === 1 ? "test" : "tests"}`}
        </Button>
      </div>
      {!ready && <p className="muted-note">Check out {run.branch} in your repo and start localhost, then run the journeys on this branch.</p>}
      {running && <Activity project={project} send={send} pending={pending} />}
      {results.length > 0 && (
        <ul className="task-e2e-results">
          {results.map((entry) => (
            <li key={entry.journeyId}>
              <ResultPill result={entry.result} />
              <span>{entry.name}</span>
              <small>{ago(entry.result.startedAt)}</small>
              {entry.result.error && <pre className="journey-error">{entry.result.error}</pre>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
