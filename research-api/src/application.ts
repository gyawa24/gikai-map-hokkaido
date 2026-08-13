import { randomUUID } from "node:crypto";

import type { ResearchConfig } from "./config.js";
import {
  BedrockResearchAnalyzer,
  GikaiMinutesAdapter,
  QueryRouter,
  ResearchService,
  type ResearchResponse,
  type ResearchSearchQuery,
} from "./research/index.js";
import {
  DynamoDbQuotaStore,
  InMemoryQuotaStore,
  type QuotaStore,
} from "./infrastructure/quota-store.js";
import { ResearchResponseCache } from "./infrastructure/research-cache.js";

export class QuotaExceededError extends Error {
  constructor() {
    super("research_request_quota_exceeded");
    this.name = "QuotaExceededError";
  }
}

export interface ResearchApplicationOptions {
  service?: ResearchService;
  quotaStore?: QuotaStore;
  cache?: ResearchResponseCache;
  createRequestId?: () => string;
  now?: () => number;
}

export class ResearchApplication {
  private readonly service: ResearchService;
  private readonly quotaStore: QuotaStore;
  private readonly cache: ResearchResponseCache;
  private readonly createRequestId: () => string;
  private readonly now: () => number;

  constructor(
    private readonly config: ResearchConfig,
    options: ResearchApplicationOptions = {},
  ) {
    const adapter = new GikaiMinutesAdapter(config);
    const router = new QueryRouter([adapter]);
    const analyzer = config.aiEnabled && config.bedrockModelId
      ? new BedrockResearchAnalyzer(config)
      : undefined;
    this.service =
      options.service ??
      new ResearchService(config, router, analyzer ? { analyzer } : {});
    this.quotaStore =
      options.quotaStore ??
      (config.usageTableName
        ? new DynamoDbQuotaStore(
            config.usageTableName,
            { daily: config.maxDailyRequests, monthly: config.maxMonthlyRequests },
            undefined,
            { region: config.awsRegion },
          )
        : new InMemoryQuotaStore({
            daily: config.maxDailyRequests,
            monthly: config.maxMonthlyRequests,
          }));
    this.cache =
      options.cache ?? new ResearchResponseCache(config.researchCacheTtlSeconds);
    this.createRequestId = options.createRequestId ?? randomUUID;
    this.now = options.now ?? Date.now;
  }

  async execute(
    query: ResearchSearchQuery,
    requestId = this.createRequestId(),
  ): Promise<ResearchResponse> {
    const startedAt = this.now();
    if (!(await this.quotaStore.consume(new Date(startedAt)))) {
      throw new QuotaExceededError();
    }

    const cacheKey = this.cache.keyFor(query);
    const cached = this.cache.get(cacheKey, startedAt);
    if (cached) {
      cached.requestId = requestId;
      cached.metadata.cacheHit = true;
      cached.metadata.durationMs = Math.max(0, this.now() - startedAt);
      return cached;
    }

    const response = await this.service.research(query);
    response.requestId = requestId;
    this.cache.set(cacheKey, response, this.now());
    return response;
  }
}
