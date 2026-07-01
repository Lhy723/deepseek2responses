import { existsSync } from "node:fs";
import { mkdir, readFile, appendFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { RequestStatsRecord } from "./types.js";

export interface StatsSummary {
  totalRequests: number;
  completedRequests: number;
  failedRequests: number;
  incompleteRequests: number;
  successRate: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalReasoningTokens: number;
  totalPromptCacheHitTokens: number;
  totalPromptCacheMissTokens: number;
  providerPromptCacheHitRate: number | null;
  averageDurationMs: number;
}

export class StatsStore {
  constructor(private readonly filePath: string) {}

  async append(record: RequestStatsRecord): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(record)}\n`, "utf8");
  }

  async readAll(): Promise<RequestStatsRecord[]> {
    if (!existsSync(this.filePath)) return [];
    const raw = await readFile(this.filePath, "utf8");
    const records: RequestStatsRecord[] = [];
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        records.push(JSON.parse(line));
      } catch {
        // JSONL is append-only; skip corrupted partial lines instead of breaking dashboard.
      }
    }
    return records;
  }

  async recent(limit = 100): Promise<RequestStatsRecord[]> {
    const records = await this.readAll();
    return records.slice(-limit).reverse();
  }

  async summary(): Promise<StatsSummary> {
    return summarize(await this.readAll());
  }

  async tokensByHour(hours = 24): Promise<Array<{ bucket: string; inputTokens: number; outputTokens: number; reasoningTokens: number; totalTokens: number }>> {
    const since = Date.now() - hours * 3600_000;
    const buckets = new Map<string, { bucket: string; inputTokens: number; outputTokens: number; reasoningTokens: number; totalTokens: number }>();
    for (const record of await this.readAll()) {
      const time = Date.parse(record.timestamp);
      if (!Number.isFinite(time) || time < since) continue;
      const date = new Date(time);
      date.setMinutes(0, 0, 0);
      const bucket = date.toISOString();
      const current = buckets.get(bucket) || { bucket, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0 };
      current.inputTokens += record.inputTokens || 0;
      current.outputTokens += record.outputTokens || 0;
      current.reasoningTokens += record.reasoningTokens || 0;
      current.totalTokens += record.totalTokens || 0;
      buckets.set(bucket, current);
    }
    return [...buckets.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
  }
}

export function summarize(records: RequestStatsRecord[]): StatsSummary {
  const totalRequests = records.length;
  const completedRequests = records.filter((r) => r.status === "completed").length;
  const failedRequests = records.filter((r) => r.status === "failed").length;
  const incompleteRequests = records.filter((r) => r.status === "incomplete").length;
  const totalInputTokens = records.reduce((sum, r) => sum + (r.inputTokens || 0), 0);
  const totalOutputTokens = records.reduce((sum, r) => sum + (r.outputTokens || 0), 0);
  const totalTokens = records.reduce((sum, r) => sum + (r.totalTokens || 0), 0);
  const totalReasoningTokens = records.reduce((sum, r) => sum + (r.reasoningTokens || 0), 0);
  const totalPromptCacheHitTokens = records.reduce((sum, r) => sum + (r.promptCacheHitTokens || 0), 0);
  const totalPromptCacheMissTokens = records.reduce((sum, r) => sum + (r.promptCacheMissTokens || 0), 0);
  const totalCacheTokens = totalPromptCacheHitTokens + totalPromptCacheMissTokens;
  const totalDuration = records.reduce((sum, r) => sum + (r.durationMs || 0), 0);

  return {
    totalRequests,
    completedRequests,
    failedRequests,
    incompleteRequests,
    successRate: totalRequests ? completedRequests / totalRequests : 0,
    totalInputTokens,
    totalOutputTokens,
    totalTokens,
    totalReasoningTokens,
    totalPromptCacheHitTokens,
    totalPromptCacheMissTokens,
    providerPromptCacheHitRate: totalCacheTokens ? totalPromptCacheHitTokens / totalCacheTokens : null,
    averageDurationMs: totalRequests ? totalDuration / totalRequests : 0,
  };
}
