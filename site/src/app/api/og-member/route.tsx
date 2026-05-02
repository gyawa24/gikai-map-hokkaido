import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import { getMunicipality } from "@/lib/municipalities";
import { parsePositiveInt } from "@/lib/security";

export const runtime = "nodejs";

type Member = {
  name: string;
  seat_number: number;
  faction?: string;
  party?: string | null;
  photo_url?: string;
  committees?: string[];
};

type MemberActivity = {
  name: string;
  session_count?: number;
  themes?: string[];
  top_topics?: string[];
};

function readJson<T>(fp: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as T;
  } catch {
    return null;
  }
}

function getMembers(city: string): Member[] {
  return (
    readJson<Member[]>(path.join(process.cwd(), "data", city, "members.json")) ?? []
  );
}

function getActivity(
  city: string
): Record<string, MemberActivity> | null {
  return readJson<Record<string, MemberActivity>>(
    path.join(process.cwd(), "data", city, "members_activity.json")
  );
}

// og-segment と同じパレット
type FactionColors = { bar: string; chipFg: string; chipBg: string };

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

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const city = searchParams.get("city") ?? "";
  const seat = parsePositiveInt(searchParams.get("seat"));
  const municipality = getMunicipality(city);

  if (!municipality || seat === null) {
    return new Response("Not found", { status: 404 });
  }

  const members = getMembers(city);
  const member = members.find((m) => m.seat_number === seat);
  if (!member) {
    return new Response("Member not found", { status: 404 });
  }

  const councilName = municipality?.council_name ?? `${city}議会`;

  const activityMap = getActivity(city);
  const activity =
    activityMap?.[member.name.replace(/\s/g, "")] ?? null;

  const colors = factionColors(member.faction);
  const partyLabel = member.party ?? "";
  const factionLabel = member.faction ?? "";
  const committees = (member.committees ?? []).slice(0, 3);
  const themes = (activity?.themes ?? []).slice(0, 4);
  const sessionCount = activity?.session_count ?? 0;

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
        {/* 会派カラー縦バー */}
        <div style={{ width: 14, background: colors.bar, flexShrink: 0 }} />

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
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
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
              議員プロフィール
            </span>
            <span style={{ fontSize: "18px", color: "#4A5568", fontWeight: 600 }}>
              {councilName}
            </span>
          </div>

          {/* メイン: 写真 + 氏名 + 会派 */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "32px",
              marginTop: "8px",
            }}
          >
            {member.photo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={member.photo_url}
                alt=""
                width={180}
                height={240}
                style={{
                  borderRadius: "12px",
                  objectFit: "cover",
                  border: `4px solid ${colors.bar}`,
                }}
              />
            )}
            <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
              <span
                style={{
                  fontSize: "14px",
                  color: "#718096",
                  letterSpacing: "0.1em",
                }}
              >
                第{member.seat_number}番
              </span>
              <span
                style={{
                  fontSize: "56px",
                  fontWeight: 800,
                  color: "#1A202C",
                  lineHeight: 1.1,
                  marginTop: "4px",
                }}
              >
                {member.name}
              </span>
              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  marginTop: "12px",
                  flexWrap: "wrap",
                }}
              >
                {factionLabel && (
                  <span
                    style={{
                      fontSize: "20px",
                      fontWeight: 600,
                      color: colors.chipFg,
                      background: colors.chipBg,
                      padding: "6px 18px",
                      borderRadius: "999px",
                    }}
                  >
                    {factionLabel}
                  </span>
                )}
                {partyLabel && partyLabel !== factionLabel && (
                  <span
                    style={{
                      fontSize: "18px",
                      color: "#4A5568",
                      background: "#F4F6F9",
                      border: "1px solid #E2E8F0",
                      padding: "6px 16px",
                      borderRadius: "999px",
                    }}
                  >
                    {partyLabel}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* 活動サマリ */}
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {sessionCount > 0 && (
              <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
                <span style={{ fontSize: "16px", color: "#718096" }}>質問活動</span>
                <span style={{ fontSize: "28px", fontWeight: 700, color: "#1B3A6B" }}>
                  {sessionCount}
                </span>
                <span style={{ fontSize: "16px", color: "#4A5568" }}>回登壇</span>
              </div>
            )}
            {committees.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <span style={{ fontSize: "14px", color: "#718096" }}>委員会</span>
                {committees.map((c, i) => (
                  <span
                    key={i}
                    style={{
                      fontSize: "16px",
                      color: "#1B3A6B",
                      background: "#E8EEF7",
                      padding: "4px 12px",
                      borderRadius: "6px",
                    }}
                  >
                    {c}
                  </span>
                ))}
              </div>
            )}
            {themes.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <span style={{ fontSize: "14px", color: "#718096" }}>主なテーマ</span>
                {themes.map((t, i) => (
                  <span
                    key={i}
                    style={{
                      fontSize: "18px",
                      fontWeight: 600,
                      color: colors.chipFg,
                      background: colors.chipBg,
                      padding: "4px 14px",
                      borderRadius: "999px",
                    }}
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* フッター */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              borderTop: "1px solid #E2E8F0",
              paddingTop: "16px",
            }}
          >
            <span style={{ fontSize: "16px", color: "#718096" }}>
              地方議会ドットコム
            </span>
            <span style={{ fontSize: "14px", color: "#A0AEC0" }}>
              公式情報は各議会サイトにて確認
            </span>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
