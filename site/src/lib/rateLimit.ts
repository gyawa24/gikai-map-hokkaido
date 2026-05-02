import { Redis } from "@upstash/redis";

type RateLimitOptions = {
  bucket: string;
  key: string;
  limit: number;
  windowSeconds: number;
};

export type RateLimitResult = {
  ok: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

const memoryStore = new Map<string, { count: number; resetAt: number }>();

function resolveCredentials(): { url: string; token: string } | null {
  const env = process.env;
  const candidates: Array<[string | undefined, string | undefined]> = [
    [env.KV_REST_API_URL, env.KV_REST_API_TOKEN],
    [env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN],
    [env.STORAGE_KV_REST_API_URL, env.STORAGE_KV_REST_API_TOKEN],
    [env.STORAGE_UPSTASH_REDIS_REST_URL, env.STORAGE_UPSTASH_REDIS_REST_TOKEN],
  ];
  for (const [url, token] of candidates) {
    if (url && token) return { url, token };
  }
  return null;
}

let redisClient: Redis | null | undefined;

function getRedis(): Redis | null {
  if (redisClient !== undefined) return redisClient;
  const creds = resolveCredentials();
  redisClient = creds ? new Redis(creds) : null;
  return redisClient;
}

function sanitizeRateLimitKey(value: string): string {
  return value.replace(/[^A-Za-z0-9:._-]/g, "_").slice(0, 160) || "unknown";
}

function buildResult(count: number, limit: number, retryAfterSeconds: number): RateLimitResult {
  return {
    ok: count <= limit,
    limit,
    remaining: Math.max(0, limit - count),
    retryAfterSeconds,
  };
}

async function checkRedisRateLimit(
  storageKey: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const redis = getRedis();
  if (!redis) {
    throw new Error("Redis credentials not configured");
  }
  const count = await redis.incr(storageKey);
  if (count === 1) {
    await redis.expire(storageKey, windowSeconds);
  }
  return buildResult(count, limit, windowSeconds);
}

function checkMemoryRateLimit(
  storageKey: string,
  limit: number,
  windowSeconds: number
): RateLimitResult {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const current = memoryStore.get(storageKey);
  if (!current || now >= current.resetAt) {
    memoryStore.set(storageKey, { count: 1, resetAt: now + windowMs });
    return buildResult(1, limit, windowSeconds);
  }
  current.count += 1;
  return buildResult(current.count, limit, Math.max(1, Math.ceil((current.resetAt - now) / 1000)));
}

export async function checkRateLimit({
  bucket,
  key,
  limit,
  windowSeconds,
}: RateLimitOptions): Promise<RateLimitResult> {
  const storageKey = `ratelimit:${sanitizeRateLimitKey(bucket)}:${sanitizeRateLimitKey(key)}`;
  try {
    if (getRedis()) {
      return await checkRedisRateLimit(storageKey, limit, windowSeconds);
    }
  } catch {
    // Fallback keeps the endpoint usable even if Redis is temporarily unavailable.
  }
  return checkMemoryRateLimit(storageKey, limit, windowSeconds);
}
