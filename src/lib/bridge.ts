import type { Bridge, Snapshot } from "../../shared/types";

// Browser mode is an explicit UI preview. It never pretends to run local tools.
const preview: Snapshot = {
  theme: "light",
  version: 1,
  desktop: false,
  projects: [],
  runs: [],
  pendingApprovals: [],
  settings: {
    codexPath: "codex",
    profiles: {
      planner: { model: "", effort: "high" },
      developer: { model: "", effort: "high" },
      reviewer: { model: "", effort: "high" },
    },
  },
  runtime: {
    connected: false,
    authenticated: false,
    accountLabel: "Desktop app required",
    models: [],
  },
  claude: {
    connected: false,
    authenticated: false,
    accountLabel: "Desktop app required",
    models: [],
    hasKey: false,
  },
  copilot: {
    connected: false,
    authenticated: false,
    accountLabel: "Not connected",
    models: [],
  },
  connectorList: [],
  roleRules: { planner: "", developer: "", reviewer: "" },
};
export const bridge: Bridge = window.workstream ?? {
  attachment: async () => {
    throw new Error("Attachments require the desktop app.");
  },
  initialTheme: "light",
  snapshot: async () => preview,
  command: async (command) => {
    if (command.type === "theme") {
      preview.theme = command.theme;
      return { ...preview };
    }
    throw new Error(
      "Open the Workstream desktop app to connect repositories and run agents. This browser view is a UI preview.",
    );
  },
  chooseFolder: async () => null,
  subscribe: () => () => {},
};
