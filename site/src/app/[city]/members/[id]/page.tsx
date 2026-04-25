import fs from "fs";
import path from "path";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { Member, MemberActivity } from "@/types/member";
import { getMunicipality } from "@/lib/municipalities";
import MemberShareButtons from "@/components/MemberShareButtons";

// 会議名から西暦を推定（令和◯年 → 2018+N）。グルーピング用。
function yearFromSessionName(name: string): string {
  const norm = (name ?? "").replace(/[０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0)
  );
  const reiwa = norm.match(/令和\s*(\d+)/);
  if (reiwa) return String(2018 + Number(reiwa[1]));
  const heisei = norm.match(/平成\s*(\d+)/);
  if (heisei) return String(1988 + Number(heisei[1]));
  const west = norm.match(/(\d{4})/);
  if (west) return west[1];
  return "不明";
}

export const dynamicParams = false;

function getMembers(city: string): Member[] {
  try {
    const fp = path.join(process.cwd(), "data", city, "members.json");
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as Member[];
  } catch {
    return [];
  }
}

function getActivity(city: string): Record<string, MemberActivity> {
  try {
    const fp = path.join(process.cwd(), "data", city, "members_activity.json");
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as Record<string, MemberActivity>;
  } catch {
    return {};
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string; id: string }>;
}): Promise<Metadata> {
  const { city, id } = await params;
  const municipality = getMunicipality(city);
  const cityName = municipality?.name ?? city;
  const members = getMembers(city);
  const member = members.find((m) => m.seat_number === Number(id));

  if (!member) {
    return { title: `議員詳細 - ${cityName}議会` };
  }

  const partyLabel = member.party ?? member.faction ?? "";
  const title = partyLabel
    ? `${member.name}（${partyLabel}）- ${cityName}議会 | 地方議会ドットコム`
    : `${member.name} - ${cityName}議会 | 地方議会ドットコム`;
  const description = `${member.name}議員の活動テーマ・発言記録など`;
  const ogImage = `/api/og-member?city=${city}&seat=${member.seat_number}`;

  return {
    title,
    description,
    openGraph: { title, description, images: [{ url: ogImage, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image" },
  };
}

export async function generateStaticParams() {
  const { getMunicipalities } = await import("@/lib/municipalities");
  const params: { city: string; id: string }[] = [];
  for (const m of getMunicipalities()) {
    if (!m.active) continue;
    for (const member of getMembers(m.slug)) {
      params.push({ city: m.slug, id: String(member.seat_number) });
    }
  }
  return params;
}

export default async function CityMemberDetailPage({
  params,
}: {
  params: Promise<{ city: string; id: string }>;
}) {
  const { city, id } = await params;
  const municipality = getMunicipality(city);
  const cityName = municipality?.name ?? city;

  const members = getMembers(city);
  const member = members.find((m) => m.seat_number === Number(id));
  if (!member) notFound();

  const activity = getActivity(city);
  const memberActivity = activity[member.name.replace(/\s/g, "")];

  const memberSearchQ = encodeURIComponent(member.name);

  return (
    <div className="page-shell max-w-6xl">
      {/* パンくず */}
      <nav className="text-sm text-[#718096] mb-5 flex items-center gap-1.5">
        <Link href={`/${city}`} className="hover:text-[#1B3A6B] transition-colors">
          議員一覧
        </Link>
        <span aria-hidden="true">›</span>
        <span className="text-[#1A202C]">{member.name}</span>
      </nav>

      {/* プロフィールカード */}
      <section id="profile" className="theme-card mb-4 scroll-mt-20 p-6">
        <div className="flex items-start gap-5">
          {member.photo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={member.photo_url}
              alt={`${member.name}議員`}
              className="h-40 w-28 shrink-0 rounded-[20px] border border-[#E2E8F0] object-cover shadow-sm"
            />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="theme-pill-soft text-[#2A5298]">
                {member.seat_number}番
              </span>
              {memberActivity && (
                <span className="theme-pill-soft text-[#2A5298]">
                  質問 {memberActivity.session_count}回
                </span>
              )}
            </div>
            <h2 className="text-2xl font-bold text-[#1A202C] leading-snug">
              {member.name}
            </h2>
            <p className="text-sm text-[#718096] mt-0.5">{member.furigana}</p>
          </div>
        </div>

        <hr className="border-[#E2E8F0] my-4" />

        <dl className="space-y-3">
          {member.party && (
            <div className="flex gap-3">
              <dt className="text-xs font-medium text-[#718096] w-12 shrink-0 pt-0.5">
                政党
              </dt>
              <dd className="text-sm text-[#1A202C]">{member.party}</dd>
            </div>
          )}
          {member.faction && (
            <div className="flex gap-3">
              <dt className="text-xs font-medium text-[#718096] w-12 shrink-0 pt-0.5">
                会派
              </dt>
              <dd>
                <span className="theme-pill-soft text-sm text-[#1A202C]">
                  {member.faction}
                </span>
              </dd>
            </div>
          )}
          {member.committees.length > 0 && (
            <div className="flex gap-3">
              <dt className="text-xs font-medium text-[#718096] w-12 shrink-0 pt-0.5">
                委員会
              </dt>
              <dd className="flex flex-wrap gap-1">
                {member.committees.map((c) => (
                  <span
                    key={c}
                    className="theme-pill-soft text-sm text-[#4A5568]"
                  >
                    {c}
                  </span>
                ))}
              </dd>
            </div>
          )}
          {member.votes && (
            <div className="flex gap-3">
              <dt className="text-xs font-medium text-[#718096] w-12 shrink-0 pt-0.5">
                得票数
              </dt>
              <dd className="text-sm text-[#1A202C]">
                {member.votes.toLocaleString()}票
              </dd>
            </div>
          )}
        </dl>
      </section>

      {/* セクションナビゲーション */}
      <nav
        aria-label="議員ページ内ナビゲーション"
        className="theme-card mb-4 flex gap-1 p-1 text-sm"
      >
        <a
          href="#profile"
          className="flex-1 text-center px-3 py-2 rounded-md text-[#4A5568] hover:bg-[#E8EEF7] hover:text-[#1B3A6B] transition-colors font-medium"
        >
          プロフィール
        </a>
        <a
          href="#activity"
          className="flex-1 text-center px-3 py-2 rounded-md text-[#4A5568] hover:bg-[#E8EEF7] hover:text-[#1B3A6B] transition-colors font-medium"
        >
          活動記録
        </a>
        <a
          href="#share"
          className="flex-1 text-center px-3 py-2 rounded-md text-[#4A5568] hover:bg-[#E8EEF7] hover:text-[#1B3A6B] transition-colors font-medium"
        >
          シェア
        </a>
      </nav>

      {/* シェア・検索セクション */}
      <section id="share" className="mb-5 scroll-mt-20">
        <div className="theme-panel mb-2 flex items-center justify-between gap-3 px-4 py-3">
          <p className="text-sm text-[#1B3A6B]">
            <span className="font-semibold">{member.name}</span> 議員の発言を横断検索
          </p>
          <Link
            href={`/search?q=${memberSearchQ}`}
            className="theme-button shrink-0 px-4 py-1.5 text-sm font-medium"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            検索
          </Link>
        </div>

        {/* SNS先では議員名刺OG画像が表示される */}
        <MemberShareButtons
          memberName={member.name}
          cityName={cityName}
          factionLabel={member.faction ?? member.party ?? undefined}
          sessionCount={memberActivity?.session_count}
          themes={memberActivity?.themes ?? []}
        />
      </section>

      {/* 質問活動 */}
      {memberActivity ? (
        <section id="activity" className="scroll-mt-20">
          <h3 className="text-base font-bold text-[#1B3A6B] mb-3">
            議会質問の記録
            <span className="ml-2 text-sm font-normal text-[#718096]">
              （{memberActivity.session_count}回登壇）
            </span>
          </h3>

          {memberActivity.all_topics.length > 0 && (
            <div className="bg-[#E8EEF7] rounded-lg p-4 mb-4">
              <p className="text-xs font-medium text-[#718096] mb-2">
                質問テーマ一覧
              </p>
              <div className="flex flex-wrap gap-1.5">
                {memberActivity.all_topics.map((t) => {
                  const q = encodeURIComponent(t);
                  return (
                    <Link
                      key={t}
                      href={`/search?q=${q}`}
                      className="text-xs px-2 py-0.5 bg-white text-[#1B3A6B] border border-[#CBD5E0] rounded-full hover:bg-[#1B3A6B] hover:text-white transition-colors"
                    >
                      {t}
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {/* タイムライン */}
          <ol className="relative border-l-2 border-[#E2E8F0] pl-5 ml-2 space-y-6">
            {(() => {
              // 年度グルーピング（新しい順）
              const groups = new Map<string, typeof memberActivity.sessions>();
              for (const s of memberActivity.sessions) {
                const y = yearFromSessionName(s.session);
                const list = groups.get(y) ?? [];
                list.push(s);
                groups.set(y, list);
              }
              const sorted = Array.from(groups.entries()).sort((a, b) =>
                a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0
              );
              const items: React.ReactNode[] = [];
              for (const [year, sessionList] of sorted) {
                items.push(
                  <li key={`year-${year}`} className="relative -ml-2">
                    <span
                      aria-hidden="true"
                      className="absolute -left-[15px] top-1.5 w-3 h-3 rounded-full bg-[#F7C948] border-2 border-white"
                    />
                    <p className="text-xs font-bold text-[#78451F] tracking-wider tabular-nums">
                      {year === "不明" ? "年度不明" : `${year}年`}
                    </p>
                  </li>
                );
                for (let i = 0; i < sessionList.length; i++) {
                  const s = sessionList[i];
                  items.push(
                    <li key={`${year}-${i}`} className="relative">
                      <span
                        aria-hidden="true"
                        className="absolute -left-[25px] top-3 w-2.5 h-2.5 rounded-full bg-white border-2 border-[#2A5298]"
                      />
                      <div className="bg-white rounded-lg border border-[#CBD5E0] px-5 py-4">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-sm font-semibold text-[#1B3A6B]">
                            {s.session}
                          </p>
                  {s.council_id > 0 && (
                    <Link
                      href={`/${city}/minutes/${s.council_id}`}
                      className="text-xs text-[#718096] hover:text-[#1B3A6B] flex items-center gap-0.5 transition-colors"
                    >
                      議事録全文
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="w-3 h-3"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </Link>
                  )}
                </div>
                        <ul className="space-y-1.5">
                          {s.topics.map((t) => (
                            <li key={t} className="flex items-start gap-2 text-sm group">
                              <span
                                className="text-[#2A5298] shrink-0 mt-0.5"
                                aria-hidden="true"
                              >
                                ·
                              </span>
                              <div className="flex-1 flex items-start justify-between gap-2">
                                {s.council_id > 0 ? (
                                  <Link
                                    href={`/${city}/minutes/${s.council_id}?q=${encodeURIComponent(t)}`}
                                    className="text-[#2A5298] hover:text-[#1B3A6B] hover:underline transition-colors"
                                  >
                                    {t}
                                  </Link>
                                ) : (
                                  <span className="text-[#4A5568]">{t}</span>
                                )}
                                <Link
                                  href={`/search?q=${encodeURIComponent(`${member.name} ${t}`)}`}
                                  className="shrink-0 text-xs text-[#A0AEC0] hover:text-[#2A5298] opacity-0 group-hover:opacity-100 transition-opacity"
                                  title="議事録検索"
                                  aria-label={`${t}を検索`}
                                >
                                  検索
                                </Link>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </li>
                  );
                }
              }
              return items;
            })()}
          </ol>
        </section>
      ) : (
        <section id="activity" className="scroll-mt-20 bg-[#F4F6F9] rounded-lg p-6 text-center">
          <p className="text-sm text-[#718096]">質問活動データは準備中です</p>
        </section>
      )}
    </div>
  );
}
