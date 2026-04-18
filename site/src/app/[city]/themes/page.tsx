import fs from "fs";
import path from "path";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { Member, MemberActivity } from "@/types/member";
import { getMunicipality } from "@/lib/municipalities";

// ---------- Data helpers ----------

function getMembers(city: string): Member[] {
  try {
    const fp = path.join(process.cwd(), "data", city, "members.json");
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as Member[];
  } catch {
    return [];
  }
}

function getMemberActivity(city: string): Record<string, MemberActivity> | null {
  try {
    const fp = path.join(process.cwd(), "data", city, "members_activity.json");
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as Record<string, MemberActivity>;
  } catch {
    return null;
  }
}

// ---------- Faction badge ----------

const FACTION_STYLES: Record<string, string> = {
  "自民党議員会":              "bg-amber-50 text-amber-800 border border-amber-200",
  "自民の会":                  "bg-amber-50 text-amber-800 border border-amber-200",
  "公明党議員団":              "bg-sky-50 text-sky-800 border border-sky-200",
  "ちとせ未来クラブ":          "bg-green-50 text-green-800 border border-green-200",
  "日本共産党":                "bg-red-50 text-red-800 border border-red-200",
  "日本共産党市議団":          "bg-red-50 text-red-800 border border-red-200",
  "参政党":                    "bg-purple-50 text-purple-800 border border-purple-200",
  "無所属クラブ（維新・市民）": "bg-cyan-50 text-cyan-800 border border-cyan-200",
  "自由民主党議員団（翡翠会）": "bg-amber-50 text-amber-800 border border-amber-200",
  "民主・春風の会":            "bg-sky-50 text-sky-800 border border-sky-200",
  "市民と歩む会":              "bg-teal-50 text-teal-800 border border-teal-200",
  "諸派":                      "bg-gray-50 text-gray-700 border border-gray-200",
  "新緑":                      "bg-lime-50 text-lime-800 border border-lime-200",
  "民主クラブ":                "bg-sky-50 text-sky-800 border border-sky-200",
  "改革フォーラム":            "bg-orange-50 text-orange-800 border border-orange-200",
  "会派市民":                  "bg-teal-50 text-teal-800 border border-teal-200",
  "無所属":                    "bg-gray-50 text-gray-600 border border-gray-200",
};

function factionBadgeClass(faction: string): string {
  return FACTION_STYLES[faction] ?? "bg-gray-50 text-gray-600 border border-gray-200";
}

// ---------- Types ----------

type MemberRow = {
  name: string;
  seat_number: number;
  faction: string;
  photo_url?: string;
  session_count: number;
  top_topics: string[];
  themes: string[];
};

// ---------- Metadata ----------

export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string }>;
}): Promise<Metadata> {
  const { city } = await params;
  const municipality = getMunicipality(city);
  const name = municipality?.council_name ?? "市議会";
  const title = `テーマ別議員 - ${name}`;
  return {
    title,
    description: `${name}の議員を政策テーマ別にランキング表示します。気になるテーマを選んで、相談できる議員を探しましょう。`,
    openGraph: { title },
  };
}

// ---------- Page ----------

export default async function CityThemesPage({
  params,
  searchParams,
}: {
  params: Promise<{ city: string }>;
  searchParams: Promise<{ theme?: string }>;
}) {
  const { city } = await params;
  const { theme: selectedTheme = "" } = await searchParams;

  const activity = getMemberActivity(city);
  if (!activity) notFound();

  const members = getMembers(city);
  const municipality = getMunicipality(city);
  const cityName = municipality?.name ?? city;

  // Build member lookup by stripped name
  const memberMap = new Map<string, Member>();
  for (const m of members) {
    memberMap.set(m.name.replace(/\s/g, ""), m);
  }

  // Collect all themes with member counts
  const themeCount = new Map<string, number>();
  const rows: MemberRow[] = Object.entries(activity).map(([key, act]) => {
    const member = memberMap.get(key) ?? memberMap.get(act.name.replace(/\s/g, "")) ?? null;
    for (const t of act.themes ?? []) {
      themeCount.set(t, (themeCount.get(t) ?? 0) + 1);
    }
    return {
      name: act.name,
      seat_number: member?.seat_number ?? 0,
      faction: member?.faction ?? "",
      photo_url: member?.photo_url,
      session_count: act.session_count,
      top_topics: act.top_topics ?? [],
      themes: act.themes ?? [],
    };
  });

  // Sort themes by member count descending, then alphabetically
  const allThemes = Array.from(themeCount.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja"))
    .map(([t]) => t);

  // Filter and sort members
  const filtered = (
    selectedTheme
      ? rows.filter((r) => r.themes.includes(selectedTheme))
      : rows
  ).sort((a, b) => b.session_count - a.session_count);

  // For each member, pick relevant topics when a theme is selected
  // (top_topics are general; show all when no filter)
  function getDisplayTopics(row: MemberRow): string[] {
    return row.top_topics.slice(0, 4);
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* パンくず */}
      <nav className="text-sm text-[#718096] mb-5 flex items-center gap-1.5">
        <Link href={`/${city}`} className="hover:text-[#1B3A6B] transition-colors">
          議員一覧
        </Link>
        <span aria-hidden="true">›</span>
        <span className="text-[#1A202C]">テーマ別議員</span>
      </nav>

      {/* ページ見出し */}
      <section className="mb-6">
        <h2 className="text-xl font-bold text-[#1B3A6B] mb-1">テーマ別議員ランキング</h2>
        <p className="text-base text-[#4A5568] leading-relaxed">
          テーマを選ぶと、そのテーマで活発に活動している議員を発言回数の多い順に表示します。
        </p>
      </section>

      {/* テーマフィルタータブ */}
      <div className="bg-white rounded-lg border border-[#CBD5E0] shadow-sm p-4 mb-6">
        <p className="text-xs font-medium text-[#718096] mb-3">テーマで絞り込む</p>
        <div className="flex flex-wrap gap-2">
          {/* 「すべて」タブ */}
          <Link
            href={`/${city}/themes`}
            className={`text-sm px-3 py-1.5 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298] ${
              !selectedTheme
                ? "bg-[#1B3A6B] text-white border-[#1B3A6B] font-semibold"
                : "bg-white text-[#4A5568] border-[#CBD5E0] hover:bg-[#E8EEF7] hover:text-[#1B3A6B] hover:border-[#2A5298]"
            }`}
            aria-current={!selectedTheme ? "page" : undefined}
          >
            すべて
            <span className="ml-1.5 text-xs opacity-70">{rows.length}</span>
          </Link>

          {allThemes.map((theme) => {
            const isActive = selectedTheme === theme;
            const count = themeCount.get(theme) ?? 0;
            return (
              <Link
                key={theme}
                href={`/${city}/themes?theme=${encodeURIComponent(theme)}`}
                className={`text-sm px-3 py-1.5 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298] ${
                  isActive
                    ? "bg-[#1B3A6B] text-white border-[#1B3A6B] font-semibold"
                    : "bg-white text-[#4A5568] border-[#CBD5E0] hover:bg-[#E8EEF7] hover:text-[#1B3A6B] hover:border-[#2A5298]"
                }`}
                aria-current={isActive ? "page" : undefined}
              >
                {theme}
                <span className="ml-1.5 text-xs opacity-70">{count}</span>
              </Link>
            );
          })}
        </div>
      </div>

      {/* ランキングリスト */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-lg border border-[#CBD5E0] p-8 text-center text-[#718096]">
          該当する議員が見つかりません。
        </div>
      ) : (
        <>
          <p className="text-sm text-[#718096] mb-4">
            {selectedTheme ? (
              <>
                <span className="font-medium text-[#1B3A6B]">「{selectedTheme}」</span>
                {" "}テーマの議員 — {filtered.length}名（発言回数順）
              </>
            ) : (
              <>全議員 — {filtered.length}名（発言回数順）</>
            )}
          </p>

          <div className="space-y-3">
            {filtered.map((row, rank) => (
              <div
                key={row.name}
                className="bg-white rounded-lg border border-[#CBD5E0] hover:border-[#1B3A6B] shadow-sm hover:shadow-md transition-all duration-150 overflow-hidden"
              >
                <div className="p-5">
                  <div className="flex items-start gap-4">
                    {/* ランク */}
                    <div className="shrink-0 w-8 text-center">
                      <span
                        className={`text-sm font-bold ${
                          rank === 0
                            ? "text-[#B8860B]"
                            : rank === 1
                            ? "text-[#708090]"
                            : rank === 2
                            ? "text-[#8B4513]"
                            : "text-[#A0AEC0]"
                        }`}
                      >
                        {rank + 1}
                      </span>
                    </div>

                    {/* 写真 */}
                    {row.photo_url && (
                      <div className="shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={row.photo_url}
                          alt={`${row.name}議員`}
                          className="w-14 h-20 object-cover rounded border border-[#E2E8F0] shadow-sm"
                        />
                      </div>
                    )}

                    {/* 情報 */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        {row.seat_number > 0 && (
                          <span className="text-xs font-medium text-[#2A5298] bg-[#E8EEF7] rounded px-2 py-0.5">
                            {row.seat_number}番
                          </span>
                        )}
                        <span className="text-xs font-medium text-[#2A5298] bg-[#E8EEF7] rounded-full px-2 py-0.5">
                          質問 {row.session_count}回
                        </span>
                        {row.faction && (
                          <span
                            className={`text-xs font-medium px-2 py-0.5 rounded ${factionBadgeClass(row.faction)}`}
                          >
                            {row.faction}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <Link
                          href={`/${city}/members/${row.seat_number}`}
                          className="text-lg font-bold text-[#1B3A6B] hover:underline leading-snug focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298] rounded"
                        >
                          {row.name}
                        </Link>
                        <Link
                          href={`/${city}/members/${row.seat_number}`}
                          className="shrink-0 text-xs text-[#2A5298] hover:text-[#1B3A6B] flex items-center gap-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298] rounded"
                        >
                          議員詳細
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="w-3 h-3"
                            aria-hidden="true"
                          >
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                        </Link>
                      </div>

                      {/* トピック */}
                      {getDisplayTopics(row).length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {getDisplayTopics(row).map((t) => (
                            <span
                              key={t}
                              className="text-xs px-2 py-0.5 bg-[#F4F6F9] text-[#4A5568] border border-[#E2E8F0] rounded-full"
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* テーマタグ（絞り込みなし時のみ表示） */}
                      {!selectedTheme && row.themes.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {row.themes.slice(0, 5).map((t) => (
                            <Link
                              key={t}
                              href={`/${city}/themes?theme=${encodeURIComponent(t)}`}
                              className="text-xs px-2 py-0.5 bg-[#E8EEF7] text-[#2A5298] border border-[#C5D0E6] rounded hover:bg-[#1B3A6B] hover:text-white hover:border-[#1B3A6B] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298]"
                            >
                              {t}
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* 利用案内 */}
      <section className="mt-10 bg-[#E8EEF7] rounded-lg border border-[#C5D0E6] p-6">
        <h3 className="text-base font-bold text-[#1B3A6B] mb-2">この問題は誰に相談すれば？</h3>
        <p className="text-base text-[#4A5568] leading-relaxed mb-3">
          地域の問題や市政への要望がある場合、テーマに関心を持つ議員に相談するのが近道です。
          上のテーマから気になる分野を選び、発言実績の多い議員を探してみましょう。
        </p>
        <ul className="space-y-1.5 text-sm text-[#4A5568]">
          <li className="flex items-start gap-2">
            <span className="text-[#2A5298] shrink-0 mt-0.5" aria-hidden="true">·</span>
            <span>発言回数は過去の定例会・委員会での質問登壇数をもとにしています。</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-[#2A5298] shrink-0 mt-0.5" aria-hidden="true">·</span>
            <span>「議員詳細」から過去の質問内容や議事録全文を確認できます。</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-[#2A5298] shrink-0 mt-0.5" aria-hidden="true">·</span>
            <span>
              <Link
                href="/ai-search"
                className="text-[#2A5298] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298] rounded"
              >
                AI検索
              </Link>
              を使うと、テーマに関する議会での議論を横断的に調べることもできます。
            </span>
          </li>
        </ul>
      </section>
    </div>
  );
}
