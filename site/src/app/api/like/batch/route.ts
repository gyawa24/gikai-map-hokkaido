import { NextRequest, NextResponse } from "next/server";
import { getCounts, isLikeStorageKey } from "@/lib/likes";
import { checkRateLimit } from "@/lib/rateLimit";
import { getClientAddress } from "@/lib/security";

export const runtime = "edge";

const LIKE_BATCH_LIMIT = 30;
const LIKE_BATCH_WINDOW_SECONDS = 60;

export async function POST(req: NextRequest) {
  const rateLimit = await checkRateLimit({
    bucket: "api-like-batch",
    key: getClientAddress(req),
    limit: LIKE_BATCH_LIMIT,
    windowSeconds: LIKE_BATCH_WINDOW_SECONDS,
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "リクエスト回数の上限に達しました。" },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.keys)) {
    return NextResponse.json({ error: "keys[] required" }, { status: 400 });
  }
  const keys = body.keys
    .filter((k: unknown): k is string => typeof k === "string" && isLikeStorageKey(k))
    .slice(0, 200);
  if (keys.length === 0) {
    return NextResponse.json({ error: "valid like keys[] required" }, { status: 400 });
  }
  const counts = await getCounts(keys);
  return NextResponse.json({ counts });
}
