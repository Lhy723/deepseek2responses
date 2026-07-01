import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("deepseek2responses", {
  platform: process.platform,
  getState: () => ipcRenderer.invoke("app:get-state"),
  start: (input: unknown) => ipcRenderer.invoke("app:start", input),
  stop: () => ipcRenderer.invoke("app:stop"),
  getStats: () => ipcRenderer.invoke("app:get-stats"),
  test: () => ipcRenderer.invoke("app:test"),
  getApiKey: () => ipcRenderer.invoke("app:get-api-key"),
  saveSettings: (input: unknown) => ipcRenderer.invoke("app:save-settings", input),
});
