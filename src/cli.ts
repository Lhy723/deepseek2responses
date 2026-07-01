#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Command } from "commander";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_FILE, DEFAULT_MAX_OUTPUT_TOKENS_CAP, DEFAULT_MODEL_MAPPING, loadConfig, saveConfig } from "./core/config.js";
import type { Config } from "./core/types.js";
import { listenServer } from "./server/create-server.js";

const VERSION = "0.1.0";

interface CliOptions {
  config?: string;
  port?: string;
  noAuth?: boolean;
  setup?: boolean;
  desktop?: boolean;
}

const program = new Command();
program
  .name("deepseek2responses")
  .description("DeepSeek to OpenAI Responses API proxy")
  .version(VERSION, "-v, --version", "Show version")
  .option("-c, --config <path>", "Path to config file")
  .option("-p, --port <port>", "Server port")
  .option("--no-auth", "Disable API key authentication")
  .option("--setup", "Print Codex config snippets and exit")
  .option("--desktop", "Launch Electron desktop dashboard");

program.parse();
const options = program.opts<CliOptions>();

async function main(): Promise<void> {
  let config = await loadConfig(options.config);
  if (options.port) config = { ...config, port: Number(options.port) };

  if (!config.deepseek_api_key) {
    if (existsSync(options.config || CONFIG_FILE)) {
      console.error(`Error: deepseek_api_key not set in ${options.config || CONFIG_FILE}`);
      console.error("Add 'deepseek_api_key: \"sk-your-key\"' to the config, or set DEEPSEEK_API_KEY env var.");
      process.exit(1);
    }
    if (!process.stdin.isTTY) {
      console.error("Error: DEEPSEEK_API_KEY not set. Use env var or run interactively to configure.");
      process.exit(1);
    }
    config = await firstRunWizard();
    if (options.port) config = { ...config, port: Number(options.port) };
  }

  if (options.setup) {
    printCodexConfig(config);
    return;
  }

  if (options.desktop) {
    await launchDesktop(config, Boolean(options.noAuth));
    return;
  }

  await startServer(config, Boolean(options.noAuth));
}

async function firstRunWizard(): Promise<Config> {
  console.log("First run — configure your DeepSeek API key.");
  console.log("Get one at https://platform.deepseek.com/api_keys");
  console.log();
  const rl = createInterface({ input, output });
  let key = "";
  while (!key.trim()) {
    key = (await rl.question("DeepSeek API key: ")).trim();
  }
  rl.close();
  const config: Config = {
    deepseek_api_key: key,
    deepseek_base_url: "https://api.deepseek.com/v1",
    model_mapping: DEFAULT_MODEL_MAPPING,
    host: "127.0.0.1",
    port: 19199,
    timeout: 300,
    stats_file: join(dirname(CONFIG_FILE), "stats.jsonl"),
    log_file: join(dirname(CONFIG_FILE), "app.log"),
    max_output_tokens_cap: DEFAULT_MAX_OUTPUT_TOKENS_CAP,
    unsupported_tools: "drop",
    tool_name_sanitize: true,
  };
  const path = await saveConfig(config);
  console.log(`Config saved to ${path}`);
  console.log();
  return config;
}

function printCodexConfig(config: Config): void {
  const model = Object.values(config.model_mapping)[0] || "deepseek-v4-pro";
  const baseUrl = `http://127.0.0.1:${config.port}/v1`;
  console.log();
  console.log("=".repeat(50));
  console.log("  Codex Config (copy-paste or use with cc-switch)");
  console.log("=".repeat(50));
  console.log();
  console.log("── .codex/auth.json ──────────────────────────────");
  console.log("{");
  console.log(`  "OPENAI_API_KEY": "${config.deepseek_api_key}"`);
  console.log("}");
  console.log();
  console.log("── .codex/config.toml ────────────────────────────");
  console.log(`model = "${model}"`);
  console.log('model_provider = "deepseek"');
  console.log("model_context_window = 1000000");
  console.log("model_max_output_tokens = 393216");
  console.log('model_reasoning_effort = "high"');
  console.log("disable_response_storage = true");
  console.log();
  console.log("[model_providers.deepseek]");
  console.log('name = "DeepSeek"');
  console.log(`base_url = "${baseUrl}"`);
  console.log('wire_api = "responses"');
  console.log("requires_openai_auth = true");
  console.log("request_max_retries = 1");
  console.log("=".repeat(50));
}

async function startServer(config: Config, noAuth: boolean): Promise<void> {
  console.log(`deepseek2responses v${VERSION}`);
  if (noAuth) console.log("WARNING: auth disabled (--no-auth)");
  else console.log(`API key: ${config.deepseek_api_key} (same as your DeepSeek key)`);
  console.log(`Bind:     http://${config.host}:${config.port}`);
  console.log(`Endpoint: http://127.0.0.1:${config.port}/v1/responses`);
  console.log(`Dashboard: http://127.0.0.1:${config.port}/dashboard/`);
  await listenServer({ config, noAuth, rendererDir: rendererDir() });
}

async function launchDesktop(config: Config, noAuth: boolean): Promise<void> {
  process.env.DEEPSEEK2RESPONSES_DESKTOP = JSON.stringify({ config, noAuth });
  const electron = await import("electron");
  const electronPath = (electron as any).default || (electron as any);
  const { spawn } = await import("node:child_process");
  const child = spawn(electronPath, [electronMainPath()], { stdio: "inherit", env: process.env });
  child.on("exit", (code) => process.exit(code || 0));
}

function rendererDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "renderer");
}

function electronMainPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "electron", "main.js");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
