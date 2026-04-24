import { NextResponse } from "next/server";
import { isKvConfigured } from "@/lib/likes";

export const runtime = "edge";

export async function GET() {
  const env = process.env;
  return NextResponse.json({
    kvConfigured: isKvConfigured(),
    detected: {
      KV_REST_API_URL: Boolean(env.KV_REST_API_URL),
      KV_REST_API_TOKEN: Boolean(env.KV_REST_API_TOKEN),
      UPSTASH_REDIS_REST_URL: Boolean(env.UPSTASH_REDIS_REST_URL),
      UPSTASH_REDIS_REST_TOKEN: Boolean(env.UPSTASH_REDIS_REST_TOKEN),
      STORAGE_KV_REST_API_URL: Boolean(env.STORAGE_KV_REST_API_URL),
      STORAGE_KV_REST_API_TOKEN: Boolean(env.STORAGE_KV_REST_API_TOKEN),
    },
  });
}
