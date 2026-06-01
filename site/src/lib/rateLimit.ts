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
  return checkMemoryRateLimit(storageKey, limit, windowSeconds);
}
