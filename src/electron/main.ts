import { app, BrowserWindow, ipcMain, shell } from "electron";
import { existsSync } from "node:fs";
import { dirname as pathDirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "../core/types.js";
import { CONFIG_FILE, loadConfig, maskSecret, saveConfig } from "../core/config.js";
import { createServer, type ServerContext } from "../server/create-server.js";

interface DesktopEnv {
  config: Config;
  noAuth: boolean;
  configPath: string;
}

interface StartInput {
  apiKey: string;
  baseUrl?: string;
  port?: number;
}

interface SettingsInput {
  apiKey?: string;
  baseUrl?: string;
  host?: string;
  port?: number;
  timeout?: number;
  statsFile?: string;
  logFile?: string;
  modelMapping?: Record<string, string>;
  maxOutputTokensCap?: number;
  unsupportedTools?: "error" | "drop";
  toolNameSanitize?: boolean;
}

let server: ServerContext | null = null;
let mainWindow: BrowserWindow | null = null;
let desktopEnv: DesktopEnv | null = null;

async function createWindow(): Promise<void> {
  desktopEnv = await readDesktopEnv();

  mainWindow = new BrowserWindow({
    width: 640,
    height: 420,
    minWidth: 600,
    minHeight: 380,
    title: "deepseek2responses",
    icon: appIconPath(),
    backgroundColor: "#ffffff",
    resizable: true,
    webPreferences: {
      preload: join(dirname(), "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(join(rendererDir(), "index.html"));
  }
}

function registerIpc(): void {
  ipcMain.handle("app:get-state", async () => buildState());
  ipcMain.handle("app:start", async (_event, input: StartInput) => {
    if (!desktopEnv) desktopEnv = await readDesktopEnv();
    const apiKey = input.apiKey?.trim() || desktopEnv.config.deepseek_api_key;
    if (!apiKey) throw new Error("API key is required");
    const nextConfig: Config = {
      ...desktopEnv.config,
      deepseek_api_key: apiKey,
      deepseek_base_url: input.baseUrl?.trim() || desktopEnv.config.deepseek_base_url,
      port: Number(input.port || desktopEnv.config.port),
    };
    await saveConfig(nextConfig, desktopEnv.configPath);
    desktopEnv = { ...desktopEnv, config: nextConfig };
    await startServer(nextConfig, desktopEnv.noAuth);
    return buildState();
  });
  ipcMain.handle("app:stop", async () => {
    await stopServer();
    return buildState();
  });
  ipcMain.handle("app:get-stats", async () => buildStatsSnapshot());
  ipcMain.handle("app:get-api-key", async () => {
    if (!desktopEnv) desktopEnv = await readDesktopEnv();
    return desktopEnv.config.deepseek_api_key;
  });
  ipcMain.handle("app:test", async () => testProxy());
  ipcMain.handle("app:save-settings", async (_event, input: SettingsInput) => {
    if (!desktopEnv) desktopEnv = await readDesktopEnv();
    const nextConfig: Config = {
      ...desktopEnv.config,
      deepseek_api_key: input.apiKey?.trim() || desktopEnv.config.deepseek_api_key,
      deepseek_base_url: input.baseUrl?.trim() || desktopEnv.config.deepseek_base_url,
      host: input.host?.trim() || desktopEnv.config.host,
      port: Number(input.port || desktopEnv.config.port),
      timeout: Number(input.timeout || desktopEnv.config.timeout),
      stats_file: input.statsFile?.trim() || desktopEnv.config.stats_file,
      log_file: input.logFile?.trim() || desktopEnv.config.log_file,
      model_mapping: input.modelMapping || desktopEnv.config.model_mapping,
      max_output_tokens_cap: Number(input.maxOutputTokensCap || desktopEnv.config.max_output_tokens_cap),
      unsupported_tools: input.unsupportedTools || desktopEnv.config.unsupported_tools,
      tool_name_sanitize: input.toolNameSanitize ?? desktopEnv.config.tool_name_sanitize,
    };
    const restartRequired = nextConfig.host !== desktopEnv.config.host || nextConfig.port !== desktopEnv.config.port;
    await saveConfig(nextConfig, desktopEnv.configPath);
    desktopEnv = { ...desktopEnv, config: nextConfig };
    return { ...(await buildState()), restartRequired };
  });
}

async function startServer(config: Config, noAuth: boolean): Promise<void> {
  if (server) return;
  server = await createServer({ config, noAuth, rendererDir: rendererDir() });
  await server.app.listen({ host: config.host, port: config.port });
}

async function stopServer(): Promise<void> {
  if (!server) return;
  await server.app.close();
  server = null;
}

async function buildState() {
  if (!desktopEnv) desktopEnv = await readDesktopEnv();
  return {
    hasApiKey: Boolean(desktopEnv.config.deepseek_api_key),
    serverRunning: Boolean(server),
    configPath: desktopEnv.configPath,
    runtime: runtimeInfo(),
  };
}

async function buildStatsSnapshot() {
  if (!server) {
    return { summary: null, cache: null, tokens: [], runtime: runtimeInfo() };
  }
  const [summary, tokens] = await Promise.all([
    server.statsStore.summary(),
    server.statsStore.tokensByHour(24),
  ]);
  return {
    summary,
    cache: server.responseStore.stats(),
    tokens,
    runtime: runtimeInfo(),
  };
}

async function testProxy() {
  if (!desktopEnv) desktopEnv = await readDesktopEnv();
  if (!server) throw new Error("Proxy is not running");
  const started = Date.now();
  const config = desktopEnv.config;
  const baseUrl = `http://127.0.0.1:${config.port}`;

  const modelsResponse = await fetch(`${baseUrl}/v1/models`);
  if (!modelsResponse.ok) {
    throw new Error(`Models test failed: HTTP ${modelsResponse.status}`);
  }
  const modelsData = await modelsResponse.json() as { data?: Array<{ id: string }> };
  const model = modelsData.data?.[0]?.id || Object.keys(config.model_mapping)[0] || "deepseek-v4-flash";

  const response = await fetch(`${baseUrl}/v1/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(desktopEnv.noAuth ? {} : { Authorization: `Bearer ${config.deepseek_api_key}` }),
    },
    body: JSON.stringify({ model, input: "ping", max_output_tokens: 1, store: false }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Responses test failed: HTTP ${response.status} ${text.slice(0, 160)}`);
  }

  return {
    ok: true,
    model,
    durationMs: Date.now() - started,
  };
}

function runtimeInfo() {
  const config = desktopEnv?.config;
  if (!config) return null;
  return {
    host: config.host,
    port: config.port,
    baseUrl: config.deepseek_base_url,
    timeout: config.timeout,
    configAuth: Boolean(config.deepseek_api_key),
    noAuth: Boolean(desktopEnv?.noAuth),
    apiKey: maskSecret(config.deepseek_api_key),
    modelMapping: config.model_mapping,
    statsFile: config.stats_file,
    logFile: config.log_file,
    maxOutputTokensCap: config.max_output_tokens_cap,
    unsupportedTools: config.unsupported_tools,
    toolNameSanitize: config.tool_name_sanitize,
  };
}

app.whenReady().then(async () => {
  registerIpc();
  await createWindow();
}).catch((error) => {
  console.error(error);
  app.quit();
});

app.on("window-all-closed", async () => {
  await stopServer();
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow().catch((error) => {
      console.error(error);
      app.quit();
    });
  }
});

async function readDesktopEnv(): Promise<DesktopEnv> {
  const raw = process.env.DEEPSEEK2RESPONSES_DESKTOP;
  if (raw) {
    const parsed = JSON.parse(raw) as { config: Config; noAuth: boolean };
    return { ...parsed, configPath: configPath() };
  }

  const target = configPath();
  const config = await loadConfig(target);
  return { config, noAuth: process.env.DEEPSEEK2RESPONSES_NO_AUTH === "1", configPath: target };
}

function configPath(): string {
  return process.env.DEEPSEEK2RESPONSES_CONFIG || devConfigPath() || CONFIG_FILE;
}

function devConfigPath(): string | null {
  if (!process.env.VITE_DEV_SERVER_URL) return null;
  const candidate = resolve(process.cwd(), "config.yaml");
  return existsSync(candidate) ? candidate : null;
}

function dirname(): string {
  return pathDirname(fileURLToPath(import.meta.url));
}

function rendererDir(): string {
  return join(dirname(), "..", "renderer");
}

function appIconPath(): string {
  const candidates = [
    join(rendererDir(), "icon.png"),
    resolve(process.cwd(), "src", "renderer", "public", "icon.png"),
    resolve(process.cwd(), "assets", "icon.png"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) || candidates[0];
}
