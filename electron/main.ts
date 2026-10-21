import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  nativeTheme,
  net,
  Notification,
  safeStorage,
} from "electron";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import type { SecretVault } from "./connectors";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { commandSchema, type Snapshot } from "../shared/types";
import { Store } from "./store";
import { Workflow } from "./workflow";
import { safeError } from "./guards";

let window: BrowserWindow | null = null;
/**
 * Secrets (Anthropic API key, connector OAuth tokens) encrypted with Windows
 * DPAPI through safeStorage, one file per secret. Never written to state.json.
 */
function secretVault(directory: string): SecretVault {
  const file = (name: string) => {
    if (!/^[a-z0-9-]{1,100}$/i.test(name)) throw new Error("Invalid secret name.");
    return join(directory, `${name}.bin`);
  };
  return {
    get(name) {
      try {
        const path = file(name);
        if (!existsSync(path) || !safeStorage.isEncryptionAvailable())
          return undefined;
        return safeStorage.decryptString(readFileSync(path));
      } catch {
        return undefined;
      }
    },
    set(name, value) {
      const path = file(name);
      if (value === undefined) {
        rmSync(path, { force: true });
        return;
      }
      if (!safeStorage.isEncryptionAvailable())
        throw new Error(
          "Secure storage is unavailable on this computer, so the secret was not saved.",
        );
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      writeFileSync(path, safeStorage.encryptString(value), { mode: 0o600 });
    },
  };
}
let workflow: Workflow;
let quitting = false;
/** Last seen stage/status per run, to notify when something needs you. */
const seen = new Map<string, string>();
const seenApprovals = new Set<string>();
/** Desktop notification (and taskbar flash) when an agent waits for your permission. */
function notifyApprovals(snapshot: Snapshot) {
  const current = new Set(snapshot.pendingApprovals.map((item) => item.id));
  for (const id of seenApprovals) if (!current.has(id)) seenApprovals.delete(id);
  const fresh = snapshot.pendingApprovals.filter((item) => !seenApprovals.has(item.id));
  for (const item of fresh) seenApprovals.add(item.id);
  if (!fresh.length || !window || window.isDestroyed() || window.isFocused()) return;
  window.flashFrame(true);
  if (!Notification.isSupported()) return;
  const item = fresh[0];
  const run = snapshot.runs.find((r) => r.id === item.runId);
  const note = new Notification({
    title: `Permission needed${run?.ticketKey ? `: ${run.ticketKey}` : ""}`,
    body: `${item.tool ?? "Request"}: ${(item.command || item.description || item.method).slice(0, 180)}${fresh.length > 1 ? ` (+${fresh.length - 1} more)` : ""}`,
    urgency: "critical",
  });
  note.on("click", () => {
    window?.show();
    window?.focus();
  });
  note.show();
}
function notifyChanges(snapshot: Snapshot) {
  notifyApprovals(snapshot);
  for (const run of snapshot.runs) {
    const key = `${run.stage}|${run.status}`;
    const before = seen.get(run.id);
    seen.set(run.id, key);
    if (!before || before === key) continue;
    if (!window || window.isDestroyed() || window.isFocused()) continue;
    const message =
      run.status === "blocked"
        ? "stopped and needs your attention"
        : run.stage === "approval"
          ? "has a plan ready for your approval"
          : run.stage === "ready"
            ? "passed review and is ready to publish"
            : run.stage === "complete" && run.status !== "running"
              ? "has a pull request"
              : "";
    if (!message || !Notification.isSupported()) continue;
    const note = new Notification({
      title: "Workstream",
      body: `${run.ticketKey ? `${run.ticketKey}: ` : ""}${run.title} ${message}.`,
    });
    note.on("click", () => {
      window?.show();
      window?.focus();
    });
    note.show();
  }
}
const devUrl = process.env.WORKSTREAM_DEV_URL;
// Isolate Electron's lock, cookies and network session as well as workflow state.
app.setAppUserModelId("local.workstream.desktop");
if (process.env.WORKSTREAM_DATA_DIR)
  app.setPath("userData", process.env.WORKSTREAM_DATA_DIR);
const single = app.requestSingleInstanceLock();
if (!single) app.quit();
else {
  app.on("second-instance", () => {
    window?.show();
    window?.focus();
  });
  void app
    .whenReady()
    .then(async () => {
      const dataPath =
        process.env.WORKSTREAM_DATA_DIR || app.getPath("userData");
      const store = new Store(dataPath);
      nativeTheme.themeSource = store.state.theme;
      workflow = new Workflow(
        store,
        join(app.getAppPath(), "skills"),
        join(dataPath, "worktrees"),
        (snapshot) => {
          // Codex disconnects during shutdown and emits a final change event.
          // By then the window can already be destroyed, so never touch it.
          if (quitting || !window || window.isDestroyed()) return;
          if (window.webContents.isDestroyed()) return;
          notifyChanges(snapshot);
          nativeTheme.themeSource = snapshot.theme;
          window.setBackgroundColor(
            snapshot.theme === "dark" ? "#101722" : "#f7f8fa",
          );
          window.webContents.send("workstream:changed", snapshot);
        },
        (url) => shell.openExternal(url),
        (url, init) => net.fetch(url, init),
        secretVault(join(dataPath, "secrets")),
      );
      void workflow.startConnectors();
      void workflow.startClaude();
      void workflow.refreshStacks();
      // Pull request status (open, completed, abandoned): at start and every 15 minutes.
      void workflow.refreshPullRequests();
      setInterval(() => void workflow.refreshPullRequests(), 15 * 60_000);
      void workflow.startCopilot();
      void workflow.checkAgentMcp();
      void workflow.refreshAllSkills();
      const entry = join(app.getAppPath(), "dist", "index.html");
      const expectedUrl = devUrl || pathToFileURL(entry).href;
      if (devUrl && devUrl !== "http://127.0.0.1:4317")
        throw new Error("Unexpected development origin.");
      const trusted = (event: Electron.IpcMainInvokeEvent) => {
        const url = event.senderFrame?.url;
        if (
          !window ||
          event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame ||
          !url ||
          url.split("#")[0].replace(/\/$/, "") !==
            expectedUrl.replace(/\/$/, "")
        )
          throw new Error("Untrusted caller.");
      };
      ipcMain.handle("workstream:snapshot", (event) => {
        trusted(event);
        return workflow.snapshot();
      });
      ipcMain.handle("workstream:attachment", (event, id: unknown) => {
        trusted(event);
        const image = store.state.runs
          .flatMap((run) => run.images ?? [])
          .find((image) => image.id === id);
        if (!image) throw new Error("Attachment not found.");
        return store.attachments.read(image);
      });
      ipcMain.handle("workstream:command", async (event, input: unknown) => {
        trusted(event);
        try {
          return await workflow.command(commandSchema.parse(input));
        } catch (error) {
          throw new Error(safeError(error));
        }
      });
      ipcMain.handle("workstream:chooseFolder", async (event) => {
        trusted(event);
        const selected = await dialog.showOpenDialog(window!, {
          title: "Connect a repository",
          properties: ["openDirectory"],
        });
        return selected.canceled ? null : selected.filePaths[0];
      });
      window = new BrowserWindow({
        width: 1440,
        height: 940,
        minWidth: 780,
        minHeight: 600,
        title: "Workstream",
        backgroundColor: store.state.theme === "dark" ? "#101722" : "#f7f8fa",
        autoHideMenuBar: true,
        show: false,
        webPreferences: {
          additionalArguments: [`--workstream-theme=${store.state.theme}`],
          preload: join(__dirname, "preload.cjs"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
        },
      });
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.on("will-navigate", (event, url) => {
        if (url !== expectedUrl) event.preventDefault();
      });
      window.webContents.session.setPermissionRequestHandler(
        (_contents, _permission, callback) => callback(false),
      );
      window.once("ready-to-show", () => window?.show());
      if (devUrl) await window.loadURL(devUrl);
      else await window.loadFile(entry);
      window.on("focus", () => window?.flashFrame(false));
      window.on("closed", () => {
        window = null;
      });
      window.on("close", (event) => {
        if (workflow.snapshot().runs.some((run) => run.status === "running")) {
          const result = dialog.showMessageBoxSync(window!, {
            type: "question",
            buttons: ["Keep working", "Close app"],
            defaultId: 0,
            cancelId: 0,
            title: "A workflow is running",
            message:
              "Closing stops agent sessions. Local changes and saved progress will remain available.",
          });
          if (result === 0) event.preventDefault();
        }
      });
    })
    .catch((error) => {
      dialog.showErrorBox("Workstream could not start", safeError(error));
      app.quit();
    });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => {
    quitting = true;
    try {
      workflow?.close();
    } catch {
      /* Shutdown must never show an error dialog. State is already saved. */
    }
  });
}
