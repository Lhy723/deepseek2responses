import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { StatsStore } from "../src/core/stats-store.js";

const baseRecord = {
  id: "req_1",
  responseId: "resp_1",
  timestamp: new Date().toISOString(),
  model: "gpt-4.1",
  upstreamModel: "deepseek-v4-pro",
  stream: false,
  status: "completed" as const,
  durationMs: 100,
  inputTokens: 10,
  outputTokens: 5,
  totalTokens: 15,
  reasoningTokens: 2,
  promptCacheHitTokens: 8,
  promptCacheMissTokens: 2,
  providerPromptCacheHitRate: 0.8,
  responseCacheHit: true,
  errorCode: null,
};

describe("StatsStore", () => {
  it("appends JSONL and summarizes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "d2r-stats-"));
    const store = new StatsStore(join(dir, "stats.jsonl"));
    await store.append(baseRecord);
    await store.append({ ...baseRecord, id: "req_2", status: "failed", totalTokens: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, errorCode: "bad_gateway" });
    const summary = await store.summary();
    expect(summary.totalRequests).toBe(2);
    expect(summary.failedRequests).toBe(1);
    expect(summary.totalTokens).toBe(15);
    expect(summary.providerPromptCacheHitRate).toBe(0.8);
  });

  it("skips corrupted lines", async () => {
    const dir = await mkdtemp(join(tmpdir(), "d2r-stats-"));
    const path = join(dir, "stats.jsonl");
    await writeFile(path, `${JSON.stringify(baseRecord)}\nnot-json\n`, "utf8");
    const store = new StatsStore(path);
    expect(await store.readAll()).toHaveLength(1);
  });
});
