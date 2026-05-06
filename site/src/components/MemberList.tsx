"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import type { Member, MemberActivity } from "@/types/member";
import type { PolicyTag } from "@/lib/planUtils";

const GOAL_BADGE_COLORS: Record<number, string> = {
  1: "bg-amber-100 text-amber-800 border-amber-300",
  2: "bg-green-100 text-green-800 border-green-300",
  3: "bg-red-100 text-red-800 border-red-300",
  4: "bg-purple-100 text-purple-800 border-purple-300",
  5: "bg-blue-100 text-blue-800 border-blue-300",
  6: "bg-slate-100 text-slate-800 border-slate-300",
  7: "bg-teal-100 text-teal-800 border-teal-300",
};

const FACTION_STYLES: Record<string, { badge: string }> = {
  "自民党議員会":              { badge: "bg-amber-50 text-amber-800 border border-amber-200" },
  "自民の会":                  { badge: "bg-amber-50 text-amber-800 border border-amber-200" },
  "公明党議員団":              { badge: "bg-sky-50 text-sky-800 border border-sky-200" },
  "ちとせ未来クラブ":          { badge: "bg-green-50 text-green-800 border border-green-200" },
  "日本共産党":                { badge: "bg-red-50 text-red-800 border border-red-200" },
  "日本共産党市議団":          { badge: "bg-red-50 text-red-800 border border-red-200" },
  "参政党":                    { badge: "bg-purple-50 text-purple-800 border border-purple-200" },
  "無所属クラブ（維新・市民）": { badge: "bg-cyan-50 text-cyan-800 border border-cyan-200" },
  "自由民主党議員団（翡翠会）": { badge: "bg-amber-50 text-amber-800 border border-amber-200" },
  "民主・春風の会":            { badge: "bg-sky-50 text-sky-800 border border-sky-200" },
  "市民と歩む会":              { badge: "bg-teal-50 text-teal-800 border border-teal-200" },
  "諸派":                      { badge: "bg-gray-50 text-gray-700 border border-gray-200" },
  "新緑":                      { badge: "bg-lime-50 text-lime-800 border border-lime-200" },
  "民主クラブ":                { badge: "bg-sky-50 text-sky-800 border border-sky-200" },
  "改革フォーラム":            { badge: "bg-orange-50 text-orange-800 border border-orange-200" },
  "会派市民":                  { badge: "bg-teal-50 text-teal-800 border border-teal-200" },
  "無所属":                    { badge: "bg-gray-50 text-gray-600 border border-gray-200" },
};

const PARTY_ORDER: Record<string, number> = {
  "自由民主党": 1,
  "公明党": 2,
  "立憲民主党": 3,
  "国民民主党": 4,
  "日本維新の会": 5,
  "日本共産党": 6,
  "参政党": 7,
  "NHKから国民を守る党": 8,
  "無所属": 99,
};

function factionBadgeClass(faction: string): string {
  return FACTION_STYLES[faction]?.badge ?? "bg-gray-50 text-gray-600 border border-gray-200";
}

type SortKey = "seat" | "party" | "kana";
const MOBILE_INITIAL_MEMBER_COUNT = 12;

// ---------- MemberCard ----------

function MemberCard({
  member,
  activity,
  factionBadgeClass,
  memberHrefBase,
  minutesHrefBase,
  policyTags,
}: {
  member: Member;
  activity: MemberActivity | undefined;
  factionBadgeClass: (f: string) => string;
  memberHrefBase?: string;
  minutesHrefBase?: string;
  policyTags?: PolicyTag[];
}) {
  const [activityOpen, setActivityOpen] = useState(false);
  const visibleCommittees = member.committees.slice(0, 2);
  const hiddenCommitteeCount = Math.max(0, member.committees.length - visibleCommittees.length);
  const visibleThemes = activity?.themes?.slice(0, 3) ?? [];
  const hiddenThemeCount = Math.max(0, (activity?.themes?.length ?? 0) - visibleThemes.length);

  return (
    <div className="theme-card overflow-hidden transition-all duration-150 hover:-translate-y-0.5 hover:border-[#9FB1D2]">
      <div className="p-4 sm:p-[18px]">
        {/* 写真 */}
        {member.photo_url && (
          <div className="mb-3 flex justify-center sm:mb-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={member.photo_url}
              alt={`${member.name}議員`}
              width={80}
              height={112}
              loading="lazy"
              decoding="async"
              className="h-24 w-[72px] rounded-[16px] border border-[#E2E8F0] object-cover shadow-sm sm:h-28 sm:w-20 sm:rounded-[18px]"
            />
          </div>
        )}
        {/* 議席番号 + 氏名 */}
        <div className="mb-3 flex items-start gap-2.5 sm:mb-4 sm:gap-3">
          <span className="mt-1 shrink-0 whitespace-nowrap rounded-full border border-[#D5DCE6] bg-[#F8FAFC] px-2.5 py-0.5 text-xs font-semibold text-[#2A5298]">
            {member.seat_number}番
          </span>
          <div className="flex-1 min-w-0">
            {memberHrefBase ? (
              <Link
                href={`${memberHrefBase}/${member.seat_number}`}
                className="rounded text-[1.05rem] font-bold leading-snug text-[#1B3A6B] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8AA3CF] sm:text-lg"
              >
                {member.name}
              </Link>
            ) : (
              <p className="text-lg font-bold text-[#1A202C] leading-snug">{member.name}</p>
            )}
            <p className="mt-0.5 text-[11px] text-[#718096] sm:text-xs">{member.furigana}</p>
          </div>
          {activity && (
            <span className="theme-pill-soft shrink-0 whitespace-nowrap px-2 py-1 text-[11px] text-[#2A5298] sm:px-[0.8rem] sm:text-[0.78rem]">
              質問 {activity.session_count}回
            </span>
          )}
        </div>

        <hr className="border-[#E2E8F0] mb-3" />

        {/* 政党 */}
        {member.party && (
          <div className="flex items-start gap-2 mb-2">
            <span className="text-xs font-medium text-[#718096] w-10 shrink-0 pt-0.5">政党</span>
            <span className="text-sm text-[#1A202C]">{member.party}</span>
          </div>
        )}

        {/* 会派 */}
        {member.faction && (
          <div className="flex items-start gap-2 mb-3">
            <span className="text-xs font-medium text-[#718096] w-10 shrink-0 pt-0.5">会派</span>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${factionBadgeClass(member.faction)}`}>
              {member.faction}
            </span>
          </div>
        )}

        {/* 委員会 */}
        <div className="flex items-start gap-2 mb-3">
          <span className="text-xs font-medium text-[#718096] w-10 shrink-0 pt-0.5">委員会</span>
          <div className="flex flex-wrap gap-1">
            {member.committees.length > 0 ? (
              <>
                {member.committees.map((c, idx) => (
                  <span
                    key={c}
                    className={`rounded-full border border-[#E2E8F0] bg-[#F8FAFC] px-2 py-0.5 text-xs text-[#4A5568] ${idx >= 2 ? "hidden sm:inline-flex" : ""}`}
                  >
                    {c}
                  </span>
                ))}
                {hiddenCommitteeCount > 0 && (
                  <span className="rounded-full border border-[#E2E8F0] bg-[#F8FAFC] px-2 py-0.5 text-xs text-[#718096] sm:hidden">
                    +{hiddenCommitteeCount}
                  </span>
                )}
              </>
            ) : (
              <span className="text-sm text-[#A0AEC0]">―</span>
            )}
          </div>
        </div>

        {/* 関心テーマ（大分類タグ） */}
        {activity && (activity.themes?.length > 0) && (
          <div className="flex items-start gap-2 mb-2">
            <span className="text-xs font-medium text-[#718096] w-10 shrink-0 pt-0.5">テーマ</span>
            <div className="flex flex-wrap gap-1">
              {activity.themes.map((t, idx) => (
                <span
                  key={t}
                  className={`rounded-full border border-[#E2E8F0] bg-[#F8FAFC] px-2 py-0.5 text-xs text-[#4A5568] ${idx >= 3 ? "hidden sm:inline-flex" : ""}`}
                >
                  {t}
                </span>
              ))}
              {hiddenThemeCount > 0 && (
                <span className="rounded-full border border-[#E2E8F0] bg-[#F8FAFC] px-2 py-0.5 text-xs text-[#718096] sm:hidden">
                  +{hiddenThemeCount}
                </span>
              )}
            </div>
          </div>
        )}

        {/* 総合計画との対応施策 */}
        {policyTags && policyTags.length > 0 && (
          <div className="mt-3 hidden items-start gap-2 border-t border-[#E2E8F0] pt-3 sm:flex">
            <span className="text-xs font-medium text-[#718096] w-10 shrink-0 pt-0.5">施策</span>
            <div className="flex flex-wrap gap-1">
              {policyTags.map((tag) => (
                <Link
                  key={tag.policyId}
                  href={`${memberHrefBase?.replace("/members", "/plan") ?? "/chitose/plan"}`}
                  className={`text-xs px-2 py-0.5 rounded-full border ${GOAL_BADGE_COLORS[tag.goalId] ?? "bg-gray-100 text-gray-700 border-gray-300"} hover:opacity-80 transition-opacity`}
                  title={`総合計画 基本目標${tag.goalId}: ${tag.goalTitle}`}
                >
                  {tag.policyTitle.length > 16 ? tag.policyTitle.slice(0, 16) + "…" : tag.policyTitle}
                </Link>
              ))}
            </div>
          </div>
        )}

      </div>

      {/* 質問履歴トグル */}
      {activity && (
        <>
          <button
            onClick={() => setActivityOpen((v) => !v)}
            className="w-full flex items-center justify-between border-t border-[#E2E8F0] bg-[#FAFAF8] px-4 py-2.5 text-sm text-[#4A5568] transition-colors hover:bg-[#F5F8FD] hover:text-[#1B3A6B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8AA3CF] sm:px-5"
            aria-expanded={activityOpen}
          >
            <span className="text-xs font-medium">質問履歴を見る</span>
            <svg
              className={`w-4 h-4 transition-transform ${activityOpen ? "rotate-180" : ""}`}
              viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {activityOpen && (
            <div className="space-y-4 border-t border-[#E2E8F0] bg-white px-4 py-4 sm:px-5">
              {activity.sessions.map((s, i) => (
                <div key={i}>
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-xs font-semibold text-[#1B3A6B]">{s.session}</p>
                    {s.council_id > 0 && (
                      <Link
                        href={`${minutesHrefBase}/${s.council_id}`}
                        className="flex items-center gap-0.5 rounded text-xs text-[#718096] transition-colors hover:text-[#1B3A6B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8AA3CF]"
                      >
                        全文
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
                      </Link>
                    )}
                  </div>
                  <ul className="space-y-1">
                    {s.topics.map((t) => (
                      <li key={t} className="flex items-start gap-1.5 text-xs">
                        <span className="text-[#2A5298] shrink-0 mt-0.5">·</span>
                        {s.council_id > 0 ? (
                          <Link
                            href={`${minutesHrefBase}/${s.council_id}?q=${encodeURIComponent(t)}`}
                            className="rounded text-[#2A5298] transition-colors hover:text-[#1B3A6B] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8AA3CF]"
                          >
                            {t}
                          </Link>
                        ) : (
                          <span className="text-[#4A5568]">{t}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------- Props ----------

type Props = {
  members: Member[];
  factions: string[];
  activity?: Record<string, MemberActivity>;
  memberHrefBase?: string;
  minutesHrefBase?: string;
  memberPolicies?: Record<string, PolicyTag[]>;
};

export default function MemberList({ members, factions, activity = {}, memberHrefBase, minutesHrefBase = "/chitose/minutes", memberPolicies = {} }: Props) {
  const [factionFilter, setFactionFilter] = useState<string>("");
  const [partyFilter, setPartyFilter] = useState<string>("");
  const [sortKey, setSortKey] = useState<SortKey>("seat");
  const [isCompactList, setIsCompactList] = useState(false);
  const [showAllMembers, setShowAllMembers] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 639px)");
    const update = () => setIsCompactList(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const parties = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const m of members) {
      if (m.party && !seen.has(m.party)) {
        seen.add(m.party);
        result.push(m.party);
      }
    }
    return result.sort((a, b) => (PARTY_ORDER[a] ?? 50) - (PARTY_ORDER[b] ?? 50));
  }, [members]);

  const hasParties = parties.length > 0;

  const filtered = useMemo(() => {
    let list = members;
    if (factionFilter) list = list.filter((m) => m.faction === factionFilter);
    if (partyFilter) list = list.filter((m) => m.party === partyFilter);

    return [...list].sort((a, b) => {
      if (sortKey === "seat") return a.seat_number - b.seat_number;
      if (sortKey === "kana") return a.furigana.localeCompare(b.furigana, "ja");
      if (sortKey === "party") {
        const pa = PARTY_ORDER[a.party ?? ""] ?? 50;
        const pb = PARTY_ORDER[b.party ?? ""] ?? 50;
        if (pa !== pb) return pa - pb;
        return a.seat_number - b.seat_number;
      }
      return 0;
    });
  }, [members, factionFilter, partyFilter, sortKey]);
  const visibleMembers = isCompactList && !showAllMembers
    ? filtered.slice(0, MOBILE_INITIAL_MEMBER_COUNT)
    : filtered;
  const hiddenMemberCount = Math.max(0, filtered.length - visibleMembers.length);

  return (
    <div className="page-shell max-w-5xl">
      {/* フィルター・ソートバー */}
      <div className="theme-panel mb-4 px-4 py-3 sm:mb-5 sm:px-5 sm:py-4">
        <div className="grid grid-cols-1 gap-3 sm:flex sm:flex-wrap sm:items-end sm:gap-x-6 sm:gap-y-3">
          {hasParties && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-[#4A5568]">政党で絞り込む</label>
              <select
                value={partyFilter}
                onChange={(e) => {
                  setPartyFilter(e.target.value);
                  setShowAllMembers(false);
                }}
                className="theme-select min-w-0 cursor-pointer px-3 py-2 text-base sm:min-w-[9rem]"
              >
                <option value="">すべての政党</option>
                {parties.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
          )}

          {factions.length > 0 && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-[#4A5568]">会派で絞り込む</label>
              <select
                value={factionFilter}
                onChange={(e) => {
                  setFactionFilter(e.target.value);
                  setShowAllMembers(false);
                }}
                className="theme-select min-w-0 cursor-pointer px-3 py-2 text-base sm:min-w-[9rem]"
              >
                <option value="">すべての会派</option>
                {factions.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[#4A5568]">並び順</label>
            <select
              value={sortKey}
              onChange={(e) => {
                setSortKey(e.target.value as SortKey);
                setShowAllMembers(false);
              }}
              className="theme-select min-w-0 cursor-pointer px-3 py-2 text-base sm:min-w-[9rem]"
            >
              <option value="seat">議席番号順</option>
              <option value="party">政党順</option>
              <option value="kana">五十音順</option>
            </select>
          </div>

          <span className="text-right text-sm text-[#4A5568] font-medium sm:ml-auto sm:self-end sm:pb-1 sm:text-base">
            {filtered.length} 名
          </span>
        </div>
      </div>

      {/* カードグリッド */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visibleMembers.map((member) => {
          const nameKey = member.name.replace(/\s/g, "");
          const memberActivity = activity[nameKey];
          return (
            <MemberCard
              key={member.seat_number}
              member={member}
              activity={memberActivity}
              factionBadgeClass={factionBadgeClass}
              memberHrefBase={memberHrefBase}
              minutesHrefBase={minutesHrefBase}
              policyTags={memberPolicies[nameKey]}
            />
          );
        })}
      </div>

      {hiddenMemberCount > 0 && (
        <div className="mt-4 flex justify-center sm:hidden">
          <button
            type="button"
            onClick={() => setShowAllMembers(true)}
            className="theme-button px-4 py-2 text-sm"
          >
            さらに{hiddenMemberCount}名を表示
          </button>
        </div>
      )}

      {filtered.length === 0 && (
        <div className="text-center py-16">
          <p className="text-base text-[#718096]">該当する議員が見つかりません</p>
          <button
            onClick={() => {
              setFactionFilter("");
              setPartyFilter("");
              setShowAllMembers(false);
            }}
            className="mt-3 rounded text-sm text-[#2A5298] underline hover:text-[#1B3A6B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8AA3CF]"
          >
            フィルターをリセットする
          </button>
        </div>
      )}
    </div>
  );
}
