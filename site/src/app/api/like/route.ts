import { NextRequest, NextResponse } from "next/server";
import { decrement, getCount, increment, likeKey, type LikeTarget } from "@/lib/likes";

export const runtime = "edge";

function parseTarget(body: unknown): LikeTarget | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (b.kind === "council" && typeof b.slug === "string" && typeof b.council_id === "number") {
    return { kind: "council", slug: b.slug, council_id: b.council_id };
  }
  if (
    b.kind === "minute" &&
    typeof b.slug === "string" &&
    typeof b.council_id === "number" &&
    typeof b.schedule_id === "number" &&
    typeof b.minute_id === "number"
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
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  const slug = url.searchParams.get("slug");
  const cid = url.searchParams.get("council_id");
  const sid = url.searchParams.get("schedule_id");
  const mid = url.searchParams.get("minute_id");

  let target: LikeTarget | null = null;
  if (kind === "council" && slug && cid) {
    target = { kind: "council", slug, council_id: parseInt(cid, 10) };
  } else if (kind === "minute" && slug && cid && sid && mid) {
    target = {
      kind: "minute",
      slug,
      council_id: parseInt(cid, 10),
      schedule_id: parseInt(sid, 10),
      minute_id: parseInt(mid, 10),
    };
  }
  if (!target) return NextResponse.json({ error: "invalid params" }, { status: 400 });

  const count = await getCount(likeKey(target));
  return NextResponse.json({ count });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const target = parseTarget(body);
  if (!target) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  const count = await increment(likeKey(target));
  return NextResponse.json({ count });
}

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const target = parseTarget(body);
  if (!target) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  const count = await decrement(likeKey(target));
  return NextResponse.json({ count });
}
