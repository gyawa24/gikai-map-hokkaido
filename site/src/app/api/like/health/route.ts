import { NextResponse } from "next/server";
import { isKvConfigured } from "@/lib/likes";
import { constantTimeEqual, getBearerToken } from "@/lib/security";

export const runtime = "nodejs";

function isAuthorized(req: Request): boolean {
  const expected = process.env.UPTIME_WEBHOOK_TOKEN?.trim();
  const provided = getBearerToken(req);
  if (!expected || !provided) return false;
  return constantTimeEqual(expected, provided);
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    kvConfigured: isKvConfigured(),
  });
}
