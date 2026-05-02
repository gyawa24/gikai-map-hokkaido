import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { getClientAddress, parsePositiveInt } from "@/lib/security";
import { decrement, getCount, increment, likeKey, type LikeTarget } from "@/lib/likes";

export const runtime = "edge";

const LIKE_READ_LIMIT = 120;
const LIKE_WRITE_LIMIT = 30;
const LIKE_WINDOW_SECONDS = 60;

function isKnownSlug(slug: string): boolean {
  return /^[a-z0-9-]{1,64}$/i.test(slug);
}

function parseTarget(body: unknown): LikeTarget | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (
    b.kind === "council" &&
    typeof b.slug === "string" &&
    isKnownSlug(b.slug) &&
    typeof b.council_id === "number" &&
    Number.isSafeInteger(b.council_id) &&
    b.council_id > 0
  ) {
    return { kind: "council", slug: b.slug, council_id: b.council_id };
  }
  if (
    b.kind === "minute" &&
    typeof b.slug === "string" &&
    isKnownSlug(b.slug) &&
    typeof b.council_id === "number" &&
    Number.isSafeInteger(b.council_id) &&
    b.council_id > 0 &&
    typeof b.schedule_id === "number" &&
    Number.isSafeInteger(b.schedule_id) &&
    b.schedule_id > 0 &&
    typeof b.minute_id === "number"
    && Number.isSafeInteger(b.minute_id)
    && b.minute_id > 0
  ) {
    return {
      kind: "minute",
      slug: b.slug,
      council_id: b.council_id,
      schedule_id: b.schedule_id,
      minute_id: b.minute_id,
    };
  }
  return null;
}

export async function GET(req: NextRequest) {
  const rateLimit = await checkRateLimit({
    bucket: "api-like-get",
    key: getClientAddress(req),
    limit: LIKE_READ_LIMIT,
    windowSeconds: LIKE_WINDOW_SECONDS,
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "リクエスト回数の上限に達しました。" },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  const slug = url.searchParams.get("slug");
  const councilId = parsePositiveInt(url.searchParams.get("council_id"));
  const scheduleId = parsePositiveInt(url.searchParams.get("schedule_id"));
  const minuteId = parsePositiveInt(url.searchParams.get("minute_id"));

  let target: LikeTarget | null = null;
  if (kind === "council" && slug && isKnownSlug(slug) && councilId !== null) {
    target = { kind: "council", slug, council_id: councilId };
  } else if (
    kind === "minute" &&
    slug &&
    isKnownSlug(slug) &&
    councilId !== null &&
    scheduleId !== null &&
    minuteId !== null
  ) {
    target = {
      kind: "minute",
      slug,
      council_id: councilId,
      schedule_id: scheduleId,
      minute_id: minuteId,
    };
  }
  if (!target) return NextResponse.json({ error: "invalid params" }, { status: 400 });

  const count = await getCount(likeKey(target));
  return NextResponse.json({ count });
}

export async function POST(req: NextRequest) {
  const rateLimit = await checkRateLimit({
    bucket: "api-like-write",
    key: getClientAddress(req),
    limit: LIKE_WRITE_LIMIT,
    windowSeconds: LIKE_WINDOW_SECONDS,
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "操作回数の上限に達しました。" },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  const body = await req.json().catch(() => null);
  const target = parseTarget(body);
  if (!target) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  const count = await increment(likeKey(target));
  return NextResponse.json({ count });
}

export async function DELETE(req: NextRequest) {
  const rateLimit = await checkRateLimit({
    bucket: "api-like-write",
    key: getClientAddress(req),
    limit: LIKE_WRITE_LIMIT,
    windowSeconds: LIKE_WINDOW_SECONDS,
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "操作回数の上限に達しました。" },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  const body = await req.json().catch(() => null);
  const target = parseTarget(body);
  if (!target) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  const count = await decrement(likeKey(target));
  return NextResponse.json({ count });
}
