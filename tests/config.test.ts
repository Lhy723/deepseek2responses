import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadConfig, saveConfig } from "../src/core/config.js";

const OLD_ENV = { ...process.env };

describe("config", () => {
  afterEach(() => {
    process.env = { ...OLD_ENV };
    vi.unstubAllEnvs();
  });

  it("loads yaml file with defaults", async () => {
    const dir = await mkdtemp(join(tmpdir(), "d2r-"));
    const path = join(dir, "config.yaml");
    await writeFile(path, "deepseek_api_key: sk-file\nport: 19999\n", "utf8");
    const config = await loadConfig(path);
    expect(config.deepseek_api_key).toBe("sk-file");
    expect(config.port).toBe(19999);
    expect(config.deepseek_base_url).toBe("https://api.deepseek.com/v1");
  });

  it("uses env api key only as fallback", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "sk-env");
    const dir = await mkdtemp(join(tmpdir(), "d2r-"));
    const missing = join(dir, "missing.yaml");
    expect((await loadConfig(missing)).deepseek_api_key).toBe("sk-env");

    const path = join(dir, "config.yaml");
    await writeFile(path, "deepseek_api_key: sk-file\n", "utf8");
    expect((await loadConfig(path)).deepseek_api_key).toBe("sk-file");
  });

  it("saves compact yaml", async () => {
    const dir = await mkdtemp(join(tmpdir(), "d2r-"));
    const path = join(dir, "config.yaml");
    const saved = await saveConfig({ deepseek_api_key: "sk", deepseek_base_url: "https://api.deepseek.com/v1", model_mapping: {}, host: "127.0.0.1", port: 19199, timeout: 300, stats_file: join(dir, "stats.jsonl"), log_file: join(dir, "app.log"), max_output_tokens_cap: 8192, unsupported_tools: "error", tool_name_sanitize: true }, path);
    expect(saved).toBe(path);
    expect((await loadConfig(path)).deepseek_api_key).toBe("sk");
  });
});
