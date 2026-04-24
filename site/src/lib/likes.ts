import { kv } from "@vercel/kv";

export type LikeTarget =
  | { kind: "council"; slug: string; council_id: number }
  | { kind: "minute"; slug: string; council_id: number; schedule_id: number; minute_id: number };

export function likeKey(target: LikeTarget): string {
  if (target.kind === "council") {
    return `like:council:${target.slug}:${target.council_id}`;
  }
  return `like:minute:${target.slug}:${target.council_id}:${target.schedule_id}:${target.minute_id}`;
}

export function isKvConfigured(): boolean {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

export async function getCount(key: string): Promise<number> {
  if (!isKvConfigured()) return 0;
  const v = await kv.get<number>(key);
  return typeof v === "number" ? v : 0;
}

export async function getCounts(keys: string[]): Promise<Record<string, number>> {
  if (!isKvConfigured() || keys.length === 0) {
    return Object.fromEntries(keys.map((k) => [k, 0]));
  }
  const values = await kv.mget<(number | null)[]>(...keys);
  return Object.fromEntries(keys.map((k, i) => [k, values[i] ?? 0]));
}

export async function increment(key: string): Promise<number> {
  if (!isKvConfigured()) return 0;
  return await kv.incr(key);
}

export async function decrement(key: string): Promise<number> {
  if (!isKvConfigured()) return 0;
  const v = await kv.decr(key);
  if (v < 0) {
    await kv.set(key, 0);
    return 0;
  }
  return v;
}
