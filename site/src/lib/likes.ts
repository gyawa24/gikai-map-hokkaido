import { Redis } from "@upstash/redis";

export type LikeTarget =
  | { kind: "council"; slug: string; council_id: number }
  | { kind: "minute"; slug: string; council_id: number; schedule_id: number; minute_id: number };

export function likeKey(target: LikeTarget): string {
  if (target.kind === "council") {
    return `like:council:${target.slug}:${target.council_id}`;
  }
  return `like:minute:${target.slug}:${target.council_id}:${target.schedule_id}:${target.minute_id}`;
}

export function isLikeStorageKey(key: string): boolean {
  return /^like:(council|minute):[a-z0-9-]+:\d+(?::\d+:\d+)?$/i.test(key);
}

// Vercel + Upstash 連携時に付与される環境変数のいくつかのパターンを順に試す:
//   - 標準（プレフィックスなし）: KV_REST_API_URL / KV_REST_API_TOKEN
//   - Upstash 標準: UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
//   - Custom Prefix "STORAGE" 付き: STORAGE_KV_REST_API_URL / STORAGE_KV_REST_API_TOKEN
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

let _redis: Redis | null | undefined;
function getRedis(): Redis | null {
  if (_redis !== undefined) return _redis;
  const creds = resolveCredentials();
  _redis = creds ? new Redis(creds) : null;
  return _redis;
}

export function isKvConfigured(): boolean {
  return getRedis() !== null;
}

export async function getCount(key: string): Promise<number> {
  const r = getRedis();
  if (!r) return 0;
  const v = await r.get<number>(key);
  return typeof v === "number" ? v : 0;
}

export async function getCounts(keys: string[]): Promise<Record<string, number>> {
  const r = getRedis();
  if (!r || keys.length === 0) {
    return Object.fromEntries(keys.map((k) => [k, 0]));
  }
  const values = (await r.mget<(number | null)[]>(...keys)) as (number | null)[];
  return Object.fromEntries(keys.map((k, i) => [k, values[i] ?? 0]));
}

export async function increment(key: string): Promise<number> {
  const r = getRedis();
  if (!r) return 0;
  return await r.incr(key);
}

export async function decrement(key: string): Promise<number> {
  const r = getRedis();
  if (!r) return 0;
  const v = await r.decr(key);
  if (v < 0) {
    await r.set(key, 0);
    return 0;
  }
  return v;
}
