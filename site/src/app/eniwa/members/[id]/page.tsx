import fs from "fs";
import path from "path";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { Member, MemberActivity } from "@/types/member";
import { Accordion } from "@/components/Accordion";

function getMembers(): Member[] {
  const fp = path.join(process.cwd(), "data", "eniwa", "members.json");
  return JSON.parse(fs.readFileSync(fp, "utf-8")) as Member[];
}

function getActivity(): Record<string, MemberActivity> {
  try {
    const fp = path.join(process.cwd(), "data", "eniwa", "members_activity.json");
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as Record<string, MemberActivity>;
  } catch {
    return {};
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const members = getMembers();
  const member = members.find((m) => m.seat_number === Number(id));

  if (!member) {
    return { title: "議員詳細 | 恵庭市議会 | 北海道議会情報マップ" };
  }

  const partyLabel = member.party ?? member.faction ?? "";
  const title = partyLabel
    ? `${member.name}（${partyLabel}）- 恵庭市議会 | 北海道議会情報マップ`
    : `${member.name} - 恵庭市議会 | 北海道議会情報マップ`;
  const description = `${member.name}議員の活動テーマ・発言記録など`;

  return {
    title,
    description,
    openGraph: { title, description },
    twitter: { card: "summary" },
  };
}

export async function generateStaticParams() {
  const members = getMembers();
  return members.map((m) => ({ id: String(m.seat_number) }));
}

export default async function MemberDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const members = getMembers();
  const member = members.find((m) => m.seat_number === Number(id));
  if (!member) notFound();

  const activity = getActivity();
  const memberActivity = activity[member.name.replace(/\s/g, "")];
  const topThemes = (memberActivity?.themes ?? []).slice(0, 8);

  return (
    <div className="max-w-2xl mx-auto">
      {/* パンくず */}
      <nav className="text-sm text-[#718096] mb-5 flex items-center gap-1.5">
        <Link href="/eniwa" className="hover:text-[#1B3A6B] transition-colors">議員一覧</Link>
        <span aria-hidden="true">›</span>
        <span className="text-[#1A202C]">{member.name}</span>
      </nav>

      {/* プロフィールカード */}
      <section className="bg-white rounded-lg border border-[#CBD5E0] shadow-sm p-6 mb-6">
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
            <h2 className="text-2xl font-bold text-[#1A202C] leading-snug">{member.name}</h2>
            <p className="text-sm text-[#718096] mt-0.5">{member.furigana}</p>
          </div>
        </div>

        <hr className="border-[#E2E8F0] my-4" />

        <dl className="space-y-3">
          {member.party && (
            <div className="flex gap-3">
              <dt className="text-xs font-medium text-[#718096] w-12 shrink-0 pt-0.5">政党</dt>
              <dd className="text-sm text-[#1A202C]">{member.party}</dd>
            </div>
          )}
          {member.faction && (
            <div className="flex gap-3">
              <dt className="text-xs font-medium text-[#718096] w-12 shrink-0 pt-0.5">会派</dt>
              <dd>
                <span className="text-sm text-[#1A202C] bg-[#F4F6F9] border border-[#E2E8F0] rounded px-2 py-0.5">
                  {member.faction}
                </span>
              </dd>
            </div>
          )}
          {member.committees.length > 0 && (
            <div className="flex gap-3">
              <dt className="text-xs font-medium text-[#718096] w-12 shrink-0 pt-0.5">委員会</dt>
              <dd className="flex flex-wrap gap-1">
                {member.committees.map((c) => (
                  <span key={c} className="text-sm text-[#4A5568] bg-[#F4F6F9] border border-[#E2E8F0] rounded px-2 py-0.5">
                    {c}
                  </span>
                ))}
              </dd>
            </div>
          )}
          {member.votes && (
            <div className="flex gap-3">
              <dt className="text-xs font-medium text-[#718096] w-12 shrink-0 pt-0.5">得票数</dt>
              <dd className="text-sm text-[#1A202C]">{member.votes.toLocaleString()}票</dd>
            </div>
          )}
        </dl>
      </section>

      {/* 質問活動 */}
      {memberActivity ? (
        <section>
          <h3 className="text-base font-bold text-[#1B3A6B] mb-3">
            議会質問の記録
            <span className="ml-2 text-sm font-normal text-[#718096]">（{memberActivity.session_count}回登壇）</span>
          </h3>

          {/* 質問テーマバッジ */}
          {topThemes.length > 0 && (
            <div className="bg-white rounded-lg border border-[#CBD5E0] shadow-sm px-5 py-4 mb-4">
              <p className="text-xs font-medium text-[#718096] mb-2">質問テーマ</p>
              <div className="flex flex-wrap gap-1.5">
                {topThemes.map((theme) => (
                  <span
                    key={theme}
                    className="text-xs font-medium px-2.5 py-1 bg-[#E8EEF7] text-[#2A5298] rounded-full"
                  >
                    {theme}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 定例会ごとの履歴 */}
          <div className="space-y-3">
            {memberActivity.sessions.map((s, i) => (
              <Accordion
                key={i}
                title={s.session}
                count={s.topics.length}
                defaultOpen={i === 0}
              >
                <div className="px-5 py-4">
                  <ul className="space-y-1.5">
                    {s.topics.map((t) => (
                      <li key={t} className="flex items-start gap-2 text-sm">
                        <span className="text-[#2A5298] shrink-0 mt-0.5" aria-hidden="true">·</span>
                        <span className="text-[#4A5568]">{t}</span>
                      </li>
                    ))}
                  </ul>
                  {s.council_id > 0 && (
                    <div className="mt-3 pt-3 border-t border-[#E2E8F0]">
                      <Link
                        href={`/eniwa/minutes/${s.council_id}`}
                        className="text-xs text-[#718096] hover:text-[#1B3A6B] flex items-center gap-0.5 transition-colors"
                      >
                        議事録全文
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
                      </Link>
                    </div>
                  )}
                </div>
              </Accordion>
            ))}
          </div>

          <div className="mt-4">
            <Link
              href="/eniwa/minutes"
              className="text-sm text-[#2A5298] hover:text-[#1B3A6B] hover:underline transition-colors flex items-center gap-1"
            >
              恵庭市議会の議事録一覧を見る
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
            </Link>
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
