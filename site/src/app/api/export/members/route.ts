import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getMunicipality } from "@/lib/municipalities";

// 議員名簿 CSV エクスポート。
// 使い方: /api/export/members?city=chitose
// 研究者・記者・市民向けの簡易オープンデータ提供。

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

type Member = {
  seat_number?: number;
  name?: string;
  furigana?: string;
  party?: string | null;
  faction?: string;
  committees?: string[];
  votes?: number | null;
  photo_url?: string;
};

export async function GET(req: NextRequest) {
  const city = req.nextUrl.searchParams.get("city") ?? "";
  if (!city) {
    return NextResponse.json({ error: "city query is required" }, { status: 400 });
  }
  const municipality = getMunicipality(city);
  if (!municipality) {
    return NextResponse.json({ error: "unknown city" }, { status: 404 });
  }

  const fp = path.join(process.cwd(), "data", city, "members.json");
  let members: Member[];
  try {
    members = JSON.parse(fs.readFileSync(fp, "utf-8")) as Member[];
  } catch {
    return NextResponse.json({ error: "members.json not found" }, { status: 404 });
  }

  const headers = [
    "seat_number",
    "name",
    "furigana",
    "party",
    "faction",
    "committees",
    "votes",
    "photo_url",
  ];
  const lines = [headers.join(",")];
  for (const m of members) {
    lines.push(
      [
        csvEscape(m.seat_number),
        csvEscape(m.name),
        csvEscape(m.furigana),
        csvEscape(m.party ?? ""),
        csvEscape(m.faction ?? ""),
        csvEscape((m.committees ?? []).join(" / ")),
        csvEscape(m.votes ?? ""),
        csvEscape(m.photo_url ?? ""),
      ].join(",")
    );
  }
  // Excel での文字化け防止に BOM を付ける
  const body = "\uFEFF" + lines.join("\n");

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${city}-members.csv"`,
      "Cache-Control": "public, max-age=3600",
    },
  });
}
