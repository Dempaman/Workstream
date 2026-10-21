import { contextBridge, ipcRenderer } from "electron";
import type { Bridge, Snapshot } from "../shared/types";
const bridge: Bridge = {
  attachment: (id) => ipcRenderer.invoke("workstream:attachment", id),
  initialTheme: process.argv.includes("--workstream-theme=dark")
    ? "dark"
    : "light",
  snapshot: () => ipcRenderer.invoke("workstream:snapshot"),
  command: (command) => ipcRenderer.invoke("workstream:command", command),
  chooseFolder: () => ipcRenderer.invoke("workstream:chooseFolder"),
  subscribe: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: Snapshot) =>
      callback(snapshot);
    ipcRenderer.on("workstream:changed", listener);
    return () => ipcRenderer.removeListener("workstream:changed", listener);
  },
};
contextBridge.exposeInMainWorld("workstream", bridge);
