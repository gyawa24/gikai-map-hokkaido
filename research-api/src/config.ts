import path from "node:path";

export interface ResearchConfig {
  awsRegion: string;
  aiEnabled: boolean;
  bedrockModelId?: string;
  bedrockMaxOutputTokens: number;
  bedrockTimeoutMs: number;
  gikaiFetchTimeoutMs: number;
  bedrockInputCostPerMillionTokens?: number;
  bedrockOutputCostPerMillionTokens?: number;
  maxResultsPerSearch: number;
  maxEvidenceItems: number;
  maxEvidenceChars: number;
  maxLlmCallsPerRequest: number;
  maxDailyRequests: number;
  maxMonthlyRequests: number;
  researchCacheTtlSeconds: number;
  indexCacheTtlSeconds: number;
  gikaiSearchIndexUrl: string;
  gikaiCityIndexBaseUrl: string;
  gikaiSearchIndexPath?: string;
  gikaiDataRawBaseUrl: string;
  gikaiDataPath?: string;
  gikaiPublicBaseUrl: string;
  usageTableName?: string;
  debugResearch: boolean;
  port: number;
  localApiKey?: string;
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
  maximum: number,
): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

function nonNegativeNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function optionalResolvedPath(value: string | undefined): string | undefined {
  return value?.trim() ? path.resolve(value) : undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ResearchConfig {
  const config: ResearchConfig = {
    awsRegion: env.AWS_REGION?.trim() || "ap-northeast-1",
    aiEnabled: env.AI_ENABLED !== "false",
    bedrockMaxOutputTokens: positiveInteger(env.BEDROCK_MAX_OUTPUT_TOKENS, 3000, 8000),
    bedrockTimeoutMs: positiveInteger(env.BEDROCK_TIMEOUT_MS, 9000, 10000),
    gikaiFetchTimeoutMs: positiveInteger(env.GIKAI_FETCH_TIMEOUT_MS, 5000, 5000),
    maxResultsPerSearch: positiveInteger(env.MAX_RESULTS_PER_SEARCH, 20, 100),
    maxEvidenceItems: positiveInteger(env.MAX_EVIDENCE_ITEMS, 8, 20),
    maxEvidenceChars: positiveInteger(env.MAX_EVIDENCE_CHARS, 30000, 60000),
    maxLlmCallsPerRequest: positiveInteger(env.MAX_LLM_CALLS_PER_REQUEST, 2, 2),
    maxDailyRequests: positiveInteger(env.MAX_DAILY_REQUESTS, 50, 10000),
    maxMonthlyRequests: positiveInteger(env.MAX_MONTHLY_REQUESTS, 500, 100000),
    researchCacheTtlSeconds: positiveInteger(env.RESEARCH_CACHE_TTL_SECONDS, 600, 86400),
    indexCacheTtlSeconds: positiveInteger(env.INDEX_CACHE_TTL_SECONDS, 900, 86400),
    gikaiSearchIndexUrl:
      env.GIKAI_SEARCH_INDEX_URL?.trim() ||
      "https://chihougikai.com/generated/search-index.json",
    gikaiCityIndexBaseUrl:
      env.GIKAI_CITY_INDEX_BASE_URL?.trim() ||
      "https://chihougikai.com/generated/search-indexes",
    gikaiDataRawBaseUrl:
      env.GIKAI_DATA_RAW_BASE_URL?.trim() ||
      "https://raw.githubusercontent.com/gyawa24/gikai-map-hokkaido/main/site/data",
    gikaiPublicBaseUrl:
      env.GIKAI_PUBLIC_BASE_URL?.trim() || "https://chihougikai.com",
    debugResearch: env.DEBUG_RESEARCH === "true",
    port: positiveInteger(env.PORT, 8788, 65535),
  };

  const optionalValues = {
    bedrockModelId: env.BEDROCK_MODEL_ID?.trim() || undefined,
    bedrockInputCostPerMillionTokens: nonNegativeNumber(
      env.BEDROCK_INPUT_COST_PER_MILLION_TOKENS,
    ),
    bedrockOutputCostPerMillionTokens: nonNegativeNumber(
      env.BEDROCK_OUTPUT_COST_PER_MILLION_TOKENS,
    ),
    gikaiSearchIndexPath: optionalResolvedPath(env.GIKAI_SEARCH_INDEX_PATH),
    gikaiDataPath: optionalResolvedPath(env.GIKAI_DATA_PATH),
    usageTableName: env.USAGE_TABLE_NAME?.trim() || undefined,
    localApiKey: env.LOCAL_API_KEY?.trim() || undefined,
  };

  return Object.assign(
    config,
    Object.fromEntries(
      Object.entries(optionalValues).filter(([, value]) => value !== undefined),
    ),
  );
}
