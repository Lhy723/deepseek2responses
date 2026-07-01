import type { ChatMessage } from "./types.js";

export interface ResponseCacheEntry {
  responseId: string;
  createdAt: number;
  model: string;
  messages: ChatMessage[];
}

export interface ResponseCacheStats {
  size: number;
  maxSize: number;
  lookupCount: number;
  hitCount: number;
  missCount: number;
  evictionCount: number;
  hitRate: number;
}

export class ResponseStore {
  private readonly entries = new Map<string, ResponseCacheEntry>();
  private lookupCount = 0;
  private hitCount = 0;
  private missCount = 0;
  private evictionCount = 0;

  constructor(private readonly maxSize = 256) {}

  get(responseId: string | null | undefined): ResponseCacheEntry | null {
    if (!responseId) return null;
    this.lookupCount += 1;
    const entry = this.entries.get(responseId);
    if (!entry) {
      this.missCount += 1;
      return null;
    }
    this.hitCount += 1;
    this.entries.delete(responseId);
    this.entries.set(responseId, entry);
    return structuredClone(entry);
  }

  put(entry: ResponseCacheEntry): void {
    this.entries.delete(entry.responseId);
    this.entries.set(entry.responseId, structuredClone(entry));
    while (this.entries.size > this.maxSize) {
      const oldest = this.entries.keys().next().value;
      if (!oldest) break;
      this.entries.delete(oldest);
      this.evictionCount += 1;
    }
  }

  stats(): ResponseCacheStats {
    return {
      size: this.entries.size,
      maxSize: this.maxSize,
      lookupCount: this.lookupCount,
      hitCount: this.hitCount,
      missCount: this.missCount,
      evictionCount: this.evictionCount,
      hitRate: this.lookupCount ? this.hitCount / this.lookupCount : 0,
    };
  }
}

export function stripInstructionMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((message) => message.role !== "system");
}
