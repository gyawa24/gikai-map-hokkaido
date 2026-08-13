import { createHash } from "node:crypto";
import type { ResearchResponse, ResearchSearchQuery } from "../research/types.js";

type CacheEntry = {
  expiresAt: number;
  response: ResearchResponse;
};

export class ResearchResponseCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(
    private readonly ttlSeconds: number,
    private readonly maxEntries = 50,
  ) {}

  keyFor(query: ResearchSearchQuery): string {
    const canonical = JSON.stringify({
      query: query.query.normalize("NFKC").trim().replace(/\s+/g, " "),
      municipalities: [...(query.municipalities ?? [])].sort(),
      sourceTypes: [...(query.sourceTypes ?? [])].sort(),
      fiscalYears: [...(query.fiscalYears ?? [])].sort((a, b) => a - b),
      mode: query.mode ?? "research",
    });
    return createHash("sha256").update(canonical).digest("hex");
  }

  get(key: string, now = Date.now()): ResearchResponse | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return null;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return structuredClone(entry.response);
  }

  set(key: string, response: ResearchResponse, now = Date.now()): void {
    this.entries.delete(key);
    this.entries.set(key, {
      expiresAt: now + this.ttlSeconds * 1000,
      response: structuredClone(response),
    });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (!oldest) break;
      this.entries.delete(oldest);
    }
  }
}
