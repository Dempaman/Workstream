import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { State } from "../shared/types";
import { Attachments } from "./attachments";
import { summarizeRun } from "./memory";

export const initialState = (): State => ({
  theme: "light",
  version: 1,
  projects: [],
  runs: [],
  settings: {
    codexPath: "codex",
    profiles: {
      planner: { model: "", effort: "high" },
      developer: { model: "", effort: "high" },
      reviewer: { model: "", effort: "high" },
    },
  },
});
export class Store {
  readonly attachments: Attachments;
  state: State;
  private file: string;
  constructor(readonly directory: string) {
    this.attachments = new Attachments(join(directory, "attachments"));
    mkdirSync(directory, { recursive: true });
    this.file = join(directory, "state.json");
    try {
      this.state = JSON.parse(readFileSync(this.file, "utf8")) as State;
      if (
        this.state.version !== 1 ||
        !Array.isArray(this.state.runs) ||
        !Array.isArray(this.state.projects) ||
        !this.state.settings
      )
        throw new Error(
          "Unsupported or invalid Workstream data. Restore state.json from a backup.",
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.state = initialState();
    }
    this.state.theme = this.state.theme === "dark" ? "dark" : "light";
    // A sign-in cannot survive a restart; clear stale waiting states.
    for (const account of Object.values(this.state.connections ?? {}))
      if (account) {
        account.signingIn = false;
        account.loginCode = undefined;
        account.loginUrl = undefined;
      }
    for (const run of this.state.runs) {
      if (!run.memory && run.development) run.memory = summarizeRun(run);
      if (run.status === "running") {
        run.status = "blocked";
        run.error =
          "The app closed during this stage. Work is preserved. Continue to reconcile and rerun this stage.";
      }
    }
    this.save();
  }
  save() {
    writeFileSync(this.file + ".tmp", JSON.stringify(this.state, null, 2), {
      mode: 0o600,
    });
    renameSync(this.file + ".tmp", this.file);
  }
}
