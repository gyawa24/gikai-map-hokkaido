import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import type { Session } from "@/types/session";
import { getMunicipality } from "@/lib/municipalities";

export const runtime = "nodejs";

function getSession(city: string, id: string): Session | null {
  const fp = path.join(process.cwd(), "data", city, "sessions", `${id}.json`);
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as Session;
  } catch {
    return null;
  }
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const city = searchParams.get("city") ?? "chitose";
  const sessionId = searchParams.get("session") ?? "";
  const segIndex = Number(searchParams.get("seg") ?? "1");

  const session = getSession(city, sessionId);
  if (!session) {
    return new Response("Not found", { status: 404 });
  }

  const segment = session.segments.find((s) => s.index === segIndex);
  if (!segment) {
    return new Response("Segment not found", { status: 404 });
  }

  const municipality = getMunicipality(city);
  const cityName = municipality?.name ?? city;
  const detail = segment.detail;
  const speaker = detail?.speaker ?? segment.label;
  const overview = detail?.overview ?? segment.summary ?? "";
  const topics = detail?.topics ?? [];

  // 会派を members.json から取得
  let faction = "";
  try {
    const membersPath = path.join(process.cwd(), "data", city, "members.json");
    const members = JSON.parse(fs.readFileSync(membersPath, "utf-8")) as Array<{
      name: string;
      faction?: string;
    }>;
    const speakerName = speaker.replace(/委員|議員/g, "");
    const member = members.find((m) => m.name.replace(/\s/g, "").includes(speakerName));
    faction = member?.faction ?? "";
  } catch {
    // skip
  }

  // overview を短くする
  const shortOverview = overview.length > 120 ? overview.slice(0, 120) + "…" : overview;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "48px 56px",
          background: "#FFFFFF",
          fontFamily: "sans-serif",
        }}
      >
        {/* ヘッダー */}
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span
              style={{
                fontSize: "18px",
                fontWeight: 700,
                color: "#FFFFFF",
                background: "#1B3A6B",
                padding: "4px 16px",
                borderRadius: "6px",
              }}
            >
              議会質疑ダイジェスト
            </span>
            <span style={{ fontSize: "16px", color: "#718096" }}>
              {cityName}議会
            </span>
          </div>

          {/* 発言者 */}
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: "16px",
              marginTop: "16px",
            }}
          >
            <span
              style={{
                fontSize: "44px",
                fontWeight: 800,
                color: "#1A202C",
              }}
            >
              {speaker}
            </span>
            {faction && (
              <span
                style={{
                  fontSize: "22px",
                  color: "#2A5298",
                  fontWeight: 600,
                }}
              >
                {faction}
              </span>
            )}
          </div>

          {/* セッションタイトル */}
          <span style={{ fontSize: "20px", color: "#718096", marginTop: "4px" }}>
            {session.title}
          </span>
        </div>

        {/* トピック一覧 */}
        {topics.length > 0 && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "12px",
              marginTop: "8px",
            }}
          >
            {topics.slice(0, 6).map((t, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  background: "#E8EEF7",
                  borderRadius: "8px",
                  padding: "10px 18px",
                }}
              >
                <span style={{ fontSize: "22px" }}>{t.icon}</span>
                <span
                  style={{
                    fontSize: "20px",
                    fontWeight: 600,
                    color: "#1B3A6B",
                  }}
                >
                  {t.theme.length > 12 ? t.theme.slice(0, 12) + "…" : t.theme}
                </span>
                <span style={{ fontSize: "16px", color: "#718096" }}>
                  {t.qa.length}問
                </span>
              </div>
            ))}
          </div>
        )}

        {/* 概要 */}
        <div
          style={{
            display: "flex",
            borderLeft: "4px solid #2A5298",
            paddingLeft: "16px",
            marginTop: "8px",
          }}
        >
          <span
            style={{
              fontSize: "18px",
              color: "#4A5568",
              lineHeight: 1.6,
            }}
          >
            {shortOverview}
          </span>
        </div>

        {/* フッター */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderTop: "1px solid #E2E8F0",
            paddingTop: "16px",
            marginTop: "8px",
          }}
        >
          <span style={{ fontSize: "16px", color: "#718096" }}>
            北海道議会情報マップ
          </span>
          <span style={{ fontSize: "16px", color: "#718096" }}>
            {formatDate(session.date)}
          </span>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
