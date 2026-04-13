import fs from "fs";
import path from "path";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { Member, MemberActivity } from "@/types/member";
import type { ComprehensivePlan } from "@/types/comprehensivePlan";
import { matchPoliciesToMember } from "@/lib/planUtils";

function getMembers(): Member[] {
  const fp = path.join(process.cwd(), "data", "chitose", "members.json");
  return JSON.parse(fs.readFileSync(fp, "utf-8")) as Member[];
}

function getActivity(): Record<string, MemberActivity> {
  try {
    const fp = path.join(process.cwd(), "data", "chitose", "members_activity.json");
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as Record<string, MemberActivity>;
  } catch {
    return {};
  }
}

function getPlan(): ComprehensivePlan | null {
  try {
    const fp = path.join(process.cwd(), "data", "chitose", "comprehensive_plan.json");
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as ComprehensivePlan;
  } catch {
    return null;
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
    return { title: "議員詳細 | 千歳市議会 | 北海道議会情報マップ" };
  }

  const partyLabel = member.party ?? member.faction ?? "";
  const title = partyLabel
    ? `${member.name}（${partyLabel}）- 千歳市議会 | 北海道議会情報マップ`
    : `${member.name} - 千歳市議会 | 北海道議会情報マップ`;
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

const GOAL_BADGE_COLORS: Record<number, string> = {
  1: "bg-amber-100 text-amber-800 border-amber-300",
  2: "bg-green-100 text-green-800 border-green-300",
  3: "bg-red-100 text-red-800 border-red-300",
  4: "bg-purple-100 text-purple-800 border-purple-300",
  5: "bg-blue-100 text-blue-800 border-blue-300",
  6: "bg-slate-100 text-slate-800 border-slate-300",
  7: "bg-teal-100 text-teal-800 border-teal-300",
};

const GOAL_BAR_COLORS: Record<number, string> = {
  1: "bg-amber-400", 2: "bg-green-500", 3: "bg-red-400",
  4: "bg-purple-500", 5: "bg-blue-500", 6: "bg-slate-500", 7: "bg-teal-500",
};

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
  const plan = getPlan();

  const policyTags = plan && memberActivity
    ? matchPoliciesToMember(memberActivity.all_topics ?? [], memberActivity.themes ?? [], plan, 6)
    : [];

  // テーマ別スコア集計（基本目標単位）
  const goalScores: Record<number, number> = {};
  for (const tag of policyTags) {
    goalScores[tag.goalId] = (goalScores[tag.goalId] ?? 0) + tag.score;
  }
  const maxGoalScore = Math.max(...Object.values(goalScores), 1);

  const aiSearchQ = encodeURIComponent(
    `${member.name}議員の議会質問の傾向と主な主張を教えてください`
  );

  return (
    <div className="max-w-2xl mx-auto">
      {/* パンくず */}
      <nav className="text-sm text-[#718096] mb-5 flex items-center gap-1.5">
        <Link href="/chitose" className="hover:text-[#1B3A6B] transition-colors">議員一覧</Link>
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

      {/* AI検索ショートカット */}
      <div className="bg-[#E8EEF7] border border-[#C5D0E6] rounded-lg px-4 py-3 mb-5 flex items-center justify-between gap-3">
        <p className="text-sm text-[#1B3A6B]">
          <span className="font-semibold">{member.name}</span> 議員の活動をAIに聞く
        </p>
        <Link
          href={`/ai-search?q=${aiSearchQ}`}
          className="shrink-0 text-sm font-medium px-4 py-1.5 bg-[#1B3A6B] text-white rounded-lg hover:bg-[#2A5298] transition-colors flex items-center gap-1.5"
        >
          <span aria-hidden="true">✦</span>
          AI検索
        </Link>
      </div>

      {/* 総合計画との関連施策 */}
      {policyTags.length > 0 && (
        <section className="bg-white rounded-lg border border-[#CBD5E0] shadow-sm px-6 py-5 mb-5">
          <h3 className="text-sm font-semibold text-[#4A5568] uppercase tracking-wide mb-4">
            総合計画との関連施策
          </h3>

          {/* 基本目標分布バー */}
          {Object.keys(goalScores).length > 0 && (
            <div className="space-y-2 mb-5">
              {plan?.basic_goals
                .filter((g) => goalScores[g.id])
                .sort((a, b) => (goalScores[b.id] ?? 0) - (goalScores[a.id] ?? 0))
                .map((goal) => {
                  const pct = Math.round(((goalScores[goal.id] ?? 0) / maxGoalScore) * 100);
                  return (
                    <div key={goal.id} className="flex items-center gap-3">
                      <span className={`shrink-0 text-xs font-bold text-white rounded-full w-5 h-5 flex items-center justify-center ${GOAL_BAR_COLORS[goal.id] ?? "bg-gray-400"}`}>
                        {goal.id}
                      </span>
                      <span className="text-xs text-[#4A5568] w-32 shrink-0 truncate" title={goal.title}>
                        {goal.title}
                      </span>
                      <div className="flex-1 h-3 bg-[#F4F6F9] rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${GOAL_BAR_COLORS[goal.id] ?? "bg-gray-400"}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
            </div>
          )}

          {/* 施策タグ */}
          <div className="flex flex-wrap gap-2">
            {policyTags.map((tag) => {
              const searchQ = encodeURIComponent(
                `${member.name}議員の「${tag.policyTitle}」に関する議会質問を教えてください`
              );
              return (
                <Link
                  key={tag.policyId}
                  href={`/ai-search?q=${searchQ}`}
                  className={`text-xs px-2.5 py-1 rounded-lg border ${GOAL_BADGE_COLORS[tag.goalId] ?? "bg-gray-100 text-gray-700 border-gray-300"} hover:opacity-80 transition-opacity`}
                  title={`AI検索: ${tag.policyTitle}`}
                >
                  {tag.policyTitle.length > 18 ? tag.policyTitle.slice(0, 18) + "…" : tag.policyTitle}
                </Link>
              );
            })}
          </div>
          <p className="text-xs text-[#A0AEC0] mt-3">
            ※ タップするとこの施策に関するAI検索が開きます
          </p>
        </section>
      )}

      {/* 質問活動 */}
      {memberActivity ? (
        <section>
          <h3 className="text-base font-bold text-[#1B3A6B] mb-3">
            議会質問の記録
            <span className="ml-2 text-sm font-normal text-[#718096]">（{memberActivity.session_count}回登壇）</span>
          </h3>

          {/* 質問テーマ一覧 */}
          {memberActivity.all_topics.length > 0 && (
            <div className="bg-[#E8EEF7] rounded-lg p-4 mb-4">
              <p className="text-xs font-medium text-[#718096] mb-2">質問テーマ一覧</p>
              <div className="flex flex-wrap gap-1.5">
                {memberActivity.all_topics.map((t) => {
                  const q = encodeURIComponent(`千歳市議会での「${t}」に関する議論を教えてください`);
                  return (
                    <Link
                      key={t}
                      href={`/ai-search?q=${q}`}
                      className="text-xs px-2 py-0.5 bg-white text-[#1B3A6B] border border-[#CBD5E0] rounded-full hover:bg-[#1B3A6B] hover:text-white transition-colors"
                    >
                      {t}
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {/* 定例会ごとの履歴 */}
          <div className="space-y-3">
            {memberActivity.sessions.map((s, i) => (
              <div key={i} className="bg-white rounded-lg border border-[#CBD5E0] px-5 py-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold text-[#1B3A6B]">{s.session}</p>
                  {s.council_id > 0 && (
                    <Link
                      href={`/chitose/minutes/${s.council_id}`}
                      className="text-xs text-[#718096] hover:text-[#1B3A6B] flex items-center gap-0.5 transition-colors"
                    >
                      議事録全文
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
                    </Link>
                  )}
                </div>
                <ul className="space-y-1.5">
                  {s.topics.map((t) => (
                    <li key={t} className="flex items-start gap-2 text-sm group">
                      <span className="text-[#2A5298] shrink-0 mt-0.5" aria-hidden="true">·</span>
                      <div className="flex-1 flex items-start justify-between gap-2">
                        {s.council_id > 0 ? (
                          <Link
                            href={`/chitose/minutes/${s.council_id}?q=${encodeURIComponent(t)}`}
                            className="text-[#2A5298] hover:text-[#1B3A6B] hover:underline transition-colors"
                          >
                            {t}
                          </Link>
                        ) : (
                          <span className="text-[#4A5568]">{t}</span>
                        )}
                        <Link
                          href={`/ai-search?q=${encodeURIComponent(`${member.name}議員の「${t}」に関する質問内容を教えてください`)}`}
                          className="shrink-0 text-xs text-[#A0AEC0] hover:text-[#2A5298] opacity-0 group-hover:opacity-100 transition-opacity"
                          title="AI検索"
                          aria-label={`${t}をAI検索`}
                        >
                          ✦ AI
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
