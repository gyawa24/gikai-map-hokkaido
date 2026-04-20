import fs from "fs";
import path from "path";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { Member, MemberActivity } from "@/types/member";
import { getMunicipality } from "@/lib/municipalities";

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
    ? `${member.name}（${partyLabel}）- ${cityName}議会 | 北海道議会情報マップ`
    : `${member.name} - ${cityName}議会 | 北海道議会情報マップ`;
  const description = `${member.name}議員の活動テーマ・発言記録など`;

  return {
    title,
    description,
    openGraph: { title, description },
    twitter: { card: "summary" },
  };
}

export async function generateStaticParams({
  params,
}: {
  params: { city: string };
}) {
  const { city } = params;
  const members = getMembers(city);
  return members.map((m) => ({ id: String(m.seat_number) }));
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
    <div className="max-w-2xl mx-auto">
      {/* パンくず */}
      <nav className="text-sm text-[#718096] mb-5 flex items-center gap-1.5">
        <Link href={`/${city}`} className="hover:text-[#1B3A6B] transition-colors">
          議員一覧
        </Link>
        <span aria-hidden="true">›</span>
        <span className="text-[#1A202C]">{member.name}</span>
      </nav>

      {/* プロフィールカード */}
      <section className="bg-white rounded-lg border border-[#CBD5E0] shadow-sm p-6 mb-5">
        <div className="flex items-start gap-5">
          {member.photo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={member.photo_url}
              alt={`${member.name}議員`}
              className="w-28 h-40 object-cover rounded-lg border border-[#E2E8F0] shadow-sm shrink-0"
            />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-medium text-[#2A5298] bg-[#E8EEF7] rounded px-2 py-0.5">
                {member.seat_number}番
              </span>
              {memberActivity && (
                <span className="text-xs font-medium text-[#2A5298] bg-[#E8EEF7] rounded-full px-2 py-0.5">
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
                <span className="text-sm text-[#1A202C] bg-[#F4F6F9] border border-[#E2E8F0] rounded px-2 py-0.5">
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
                    className="text-sm text-[#4A5568] bg-[#F4F6F9] border border-[#E2E8F0] rounded px-2 py-0.5"
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

      {/* 検索ショートカット */}
      <div className="bg-[#E8EEF7] border border-[#C5D0E6] rounded-lg px-4 py-3 mb-5 flex items-center justify-between gap-3">
        <p className="text-sm text-[#1B3A6B]">
          <span className="font-semibold">{member.name}</span> 議員の発言を横断検索
        </p>
        <Link
          href={`/search?q=${memberSearchQ}`}
          className="shrink-0 text-sm font-medium px-4 py-1.5 bg-[#1B3A6B] text-white rounded-lg hover:bg-[#2A5298] transition-colors flex items-center gap-1.5"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          検索
        </Link>
      </div>

      {/* 質問活動 */}
      {memberActivity ? (
        <section>
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

          <div className="space-y-3">
            {memberActivity.sessions.map((s, i) => (
              <div
                key={i}
                className="bg-white rounded-lg border border-[#CBD5E0] px-5 py-4"
              >
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
            ))}
          </div>
        </section>
      ) : (
        <div className="bg-[#F4F6F9] rounded-lg p-6 text-center">
          <p className="text-sm text-[#718096]">質問活動データは準備中です</p>
        </div>
      )}
    </div>
  );
}
