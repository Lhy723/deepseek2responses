import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parse, stringify } from "yaml";
import type { Config } from "./types.js";

export const CONFIG_DIR = join(homedir(), ".deepseek2responses");
export const CONFIG_FILE = join(CONFIG_DIR, "config.yaml");
export const STATS_FILE = join(CONFIG_DIR, "stats.jsonl");
export const LOG_FILE = join(CONFIG_DIR, "app.log");

export const DEFAULT_MODEL_MAPPING: Record<string, string> = {
  "deepseek-v4-pro": "deepseek-v4-pro",
  "deepseek-v4-flash": "deepseek-v4-flash",
};

export const DEFAULT_MAX_OUTPUT_TOKENS_CAP = 393216;

const DEFAULTS: Config = {
  deepseek_api_key: "",
  deepseek_base_url: "https://api.deepseek.com/v1",
  model_mapping: DEFAULT_MODEL_MAPPING,
  host: "127.0.0.1",
  port: 19199,
  timeout: 300,
  stats_file: STATS_FILE,
  log_file: LOG_FILE,
  max_output_tokens_cap: DEFAULT_MAX_OUTPUT_TOKENS_CAP,
  unsupported_tools: "drop",
  tool_name_sanitize: true,
};

export function resolveConfigPath(path?: string | null): string {
  return path || process.env.DEEPSEEK2RESPONSES_CONFIG || CONFIG_FILE;
}

export async function loadConfig(path?: string | null): Promise<Config> {
  const target = resolveConfigPath(path);
  let data: Record<string, any> = {};
  if (existsSync(target)) {
    const raw = await readFile(target, "utf8");
    data = parse(raw) || {};
  }

  if (process.env.DEEPSEEK_API_KEY && !data.deepseek_api_key) {
    data.deepseek_api_key = process.env.DEEPSEEK_API_KEY;
  }

  const modelMapping = data.model_mapping && typeof data.model_mapping === "object"
    ? { ...DEFAULT_MODEL_MAPPING, ...data.model_mapping }
    : DEFAULT_MODEL_MAPPING;

  return {
    ...DEFAULTS,
    ...data,
    model_mapping: modelMapping,
    port: Number(data.port ?? DEFAULTS.port),
    timeout: Number(data.timeout ?? DEFAULTS.timeout),
    stats_file: data.stats_file || DEFAULTS.stats_file,
    log_file: data.log_file || DEFAULTS.log_file,
    max_output_tokens_cap: Number(data.max_output_tokens_cap ?? DEFAULTS.max_output_tokens_cap),
    unsupported_tools: data.unsupported_tools === "drop" ? "drop" : "error",
    tool_name_sanitize: data.tool_name_sanitize !== false,
  };
}

export async function saveConfig(config: Config, path?: string | null): Promise<string> {
  const target = path || CONFIG_FILE;
  await mkdir(dirname(target), { recursive: true });

  const data: Record<string, any> = {
    deepseek_api_key: config.deepseek_api_key,
  };
  if (config.deepseek_base_url !== DEFAULTS.deepseek_base_url) data.deepseek_base_url = config.deepseek_base_url;
  if (config.host !== DEFAULTS.host) data.host = config.host;
  if (config.port !== DEFAULTS.port) data.port = config.port;
  if (config.timeout !== DEFAULTS.timeout) data.timeout = config.timeout;
  if (config.stats_file !== DEFAULTS.stats_file) data.stats_file = config.stats_file;
  if (config.log_file !== DEFAULTS.log_file) data.log_file = config.log_file;
  if (config.max_output_tokens_cap !== DEFAULTS.max_output_tokens_cap) data.max_output_tokens_cap = config.max_output_tokens_cap;
  if (config.unsupported_tools !== DEFAULTS.unsupported_tools) data.unsupported_tools = config.unsupported_tools;
  if (config.tool_name_sanitize !== DEFAULTS.tool_name_sanitize) data.tool_name_sanitize = config.tool_name_sanitize;
  if (Object.keys(config.model_mapping).length) data.model_mapping = config.model_mapping;

  await writeFile(target, stringify(data), "utf8");
  return target;
}

export function maskSecret(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
