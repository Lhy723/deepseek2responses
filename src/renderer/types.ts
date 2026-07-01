export interface Summary {
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

export interface RequestRecord {
  id: string;
  responseId?: string | null;
  timestamp: string;
  model: string;
  upstreamModel?: string;
  stream: boolean;
  status: string;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens: number;
  promptCacheHitTokens: number;
  promptCacheMissTokens: number;
  providerPromptCacheHitRate: number | null;
  responseCacheHit: boolean | null;
  errorCode: string | null;
}

export interface CacheStats {
  size: number;
  maxSize: number;
  lookupCount: number;
  hitCount: number;
  missCount: number;
  evictionCount: number;
  hitRate: number;
}

export interface RuntimeInfo {
  host: string;
  port: number;
  baseUrl: string;
  timeout: number;
  configAuth: boolean;
  noAuth: boolean;
  apiKey: string;
  modelMapping: Record<string, string>;
  statsFile: string;
  logFile: string;
  maxOutputTokensCap: number;
  unsupportedTools: "error" | "drop";
  toolNameSanitize: boolean;
}

export interface TokenBucket {
  bucket: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

export interface DesktopState {
  hasApiKey: boolean;
  serverRunning: boolean;
  configPath: string;
  runtime: RuntimeInfo | null;
}

export interface StartInput {
  apiKey: string;
  baseUrl?: string;
  port?: number;
}

export interface SettingsInput {
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

export interface StatsSnapshot {
  summary: Summary | null;
  cache: CacheStats | null;
  tokens: TokenBucket[];
  runtime: RuntimeInfo | null;
}

export interface TestResult {
  ok: boolean;
  model: string;
  durationMs: number;
}

export interface DesktopBridge {
  platform: string;
  getState(): Promise<DesktopState>;
  start(input: StartInput): Promise<DesktopState>;
  stop(): Promise<DesktopState>;
  getStats(): Promise<StatsSnapshot>;
  getApiKey(): Promise<string>;
  test(): Promise<TestResult>;
  saveSettings(input: SettingsInput): Promise<DesktopState & { restartRequired: boolean }>;
}

declare global {
  interface Window {
    deepseek2responses?: DesktopBridge;
  }
}
