import { NextRequest, NextResponse } from "next/server";
import { getCounts } from "@/lib/likes";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.keys)) {
    return NextResponse.json({ error: "keys[] required" }, { status: 400 });
  }
  const keys = body.keys.filter((k: unknown): k is string => typeof k === "string").slice(0, 200);
  const counts = await getCounts(keys);
  return NextResponse.json({ counts });
}
