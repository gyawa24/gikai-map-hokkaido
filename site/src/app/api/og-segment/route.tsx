import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import type { Session } from "@/types/session";
import { getMunicipality } from "@/lib/municipalities";
import { isSafePathToken, parsePositiveInt } from "@/lib/security";

export const runtime = "nodejs";

type Member = {
  name: string;
  faction?: string;
  photo_url?: string;
};

function getSession(city: string, id: string): Session | null {
  const fp = path.join(process.cwd(), "data", city, "sessions", `${id}.json`);
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as Session;
  } catch {
    return null;
  }
}

function getMembers(city: string): Member[] {
  try {
    const fp = path.join(process.cwd(), "data", city, "members.json");
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as Member[];
  } catch {
    return [];
  }
}

// 執行機関・役職ロール（発言者名から議員検索を抑止する判定）
const EXECUTIVE_PATTERN =
  /市長|町長|村長|知事|教育長|副市長|副町長|部長|課長|局長|事務局|理事者|担当者|職員|書記|議長|副議長|委員長|副委員長|会計管理者|監査委員事務/;

function looksLikeExecutive(speaker: string): boolean {
  return EXECUTIVE_PATTERN.test(speaker);
}

// 「山口議員（自民党議員会）」→「山口」のような姓だけを抽出
function normalizeForMemberLookup(speaker: string): string {
  return speaker
    .replace(/（[^）]*）/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/議員|委員/g, "")
    .trim();
}

function findMember(speaker: string, members: Member[]): Member | null {
  if (looksLikeExecutive(speaker)) return null;
  const key = normalizeForMemberLookup(speaker);
  if (!key || key.length < 2) return null;
  return (
    members.find((m) => {
      const clean = m.name.replace(/\s/g, "");
      return clean === key || clean.startsWith(key) || clean.includes(key);
    }) ?? null
  );
}

type FactionColors = { bar: string; chipFg: string; chipBg: string };

// 会派名→カラーパレット。regex で緩く当てる（市町村で微妙に会派名が違うため）
function factionColors(faction: string | undefined): FactionColors {
  const defaults: FactionColors = { bar: "#1B3A6B", chipFg: "#FFFFFF", chipBg: "#1B3A6B" };
  if (!faction) return defaults;
  if (/自民|自由民主/.test(faction))
    return { bar: "#B45309", chipFg: "#92400E", chipBg: "#FEF3C7" };
  if (/公明/.test(faction))
    return { bar: "#0369A1", chipFg: "#075985", chipBg: "#E0F2FE" };
  if (/共産/.test(faction))
    return { bar: "#B91C1C", chipFg: "#991B1B", chipBg: "#FEE2E2" };
  if (/立憲|民主・|民主クラブ|春風/.test(faction))
    return { bar: "#0E7490", chipFg: "#155E75", chipBg: "#CFFAFE" };
  if (/維新/.test(faction))
    return { bar: "#6D28D9", chipFg: "#5B21B6", chipBg: "#EDE9FE" };
  if (/ちとせ未来|市民と歩|会派市民|改革フォーラム/.test(faction))
    return { bar: "#047857", chipFg: "#065F46", chipBg: "#D1FAE5" };
  if (/参政/.test(faction))
    return { bar: "#7E22CE", chipFg: "#6B21A8", chipBg: "#F3E8FF" };
  if (/国民民主/.test(faction))
    return { bar: "#CA8A04", chipFg: "#A16207", chipBg: "#FEF9C3" };
  if (/新緑/.test(faction))
    return { bar: "#65A30D", chipFg: "#4D7C0F", chipBg: "#ECFCCB" };
  if (/諸派|無所属/.test(faction))
    return { bar: "#52525B", chipFg: "#3F3F46", chipBg: "#F4F4F5" };
  return defaults;
}

type Role = "member" | "executive" | "generic";

function roleBadgeLabel(role: Role): string {
  if (role === "member") return "議員の発言";
  if (role === "executive") return "執行部答弁";
  return "議会質疑ダイジェスト";
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const city = searchParams.get("city") ?? "chitose";
  const sessionId = searchParams.get("session") ?? "";
  const segIndex = parsePositiveInt(searchParams.get("seg"));
  const municipality = getMunicipality(city);

  if (!municipality || !isSafePathToken(sessionId) || segIndex === null) {
    return new Response("Not found", { status: 404 });
  }

  const session = getSession(city, sessionId);
  if (!session) {
    return new Response("Not found", { status: 404 });
  }

  const segment = session.segments.find((s) => s.index === segIndex);
  if (!segment) {
    return new Response("Segment not found", { status: 404 });
  }

  const cityName = municipality?.name ?? city;
  const detail = segment.detail;
  const speaker = detail?.speaker ?? segment.label;
  const overview = detail?.overview ?? segment.summary ?? "";
  const topics = detail?.topics ?? [];

  const members = getMembers(city);
  const member = findMember(speaker, members);
  const role: Role = member
    ? "member"
    : looksLikeExecutive(speaker)
    ? "executive"
    : "generic";
  const colors = factionColors(member?.faction);

  const shortOverview = overview.length > 120 ? overview.slice(0, 120) + "…" : overview;
  const displaySpeaker = member ? member.name : speaker;
  const photoUrl = member?.photo_url;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "#FFFFFF",
          fontFamily: "sans-serif",
        }}
      >
        {/* 会派カラー縦バー（議員時に意味を持つ。非議員は濃紺デフォルト） */}
        <div style={{ width: 12, background: colors.bar, flexShrink: 0 }} />

        {/* 本体 */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "48px 56px",
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
                  background: colors.bar,
                  padding: "4px 16px",
                  borderRadius: "6px",
                }}
              >
                {roleBadgeLabel(role)}
              </span>
              <span style={{ fontSize: "16px", color: "#718096" }}>
                {cityName}議会
              </span>
            </div>

            {/* 発言者 + 写真 */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "24px",
                marginTop: "12px",
              }}
            >
              {photoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photoUrl}
                  alt=""
                  width={96}
                  height={128}
                  style={{
                    borderRadius: "8px",
                    objectFit: "cover",
                    border: `3px solid ${colors.bar}`,
                  }}
                />
              )}
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span
                  style={{
                    fontSize: "44px",
                    fontWeight: 800,
                    color: "#1A202C",
                    lineHeight: 1.2,
                  }}
                >
                  {displaySpeaker}
                </span>
                {member?.faction && (
                  <span
                    style={{
                      fontSize: "20px",
                      fontWeight: 600,
                      color: colors.chipFg,
                      background: colors.chipBg,
                      padding: "4px 14px",
                      borderRadius: "999px",
                      marginTop: "8px",
                      alignSelf: "flex-start",
                    }}
                  >
                    {member.faction}
                  </span>
                )}
              </div>
            </div>

            {/* セッションタイトル */}
            <span style={{ fontSize: "20px", color: "#718096", marginTop: "12px" }}>
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
              borderLeft: `4px solid ${colors.bar}`,
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
              地方議会ドットコム
            </span>
            <span style={{ fontSize: "16px", color: "#718096" }}>
              {formatDate(session.date)}
            </span>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
