"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { Member, MemberActivity } from "@/types/member";

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

// ---------- MemberCard ----------

function MemberCard({
  member,
  activity,
  factionBadgeClass,
  memberHrefBase,
}: {
  member: Member;
  activity: MemberActivity | undefined;
  factionBadgeClass: (f: string) => string;
  memberHrefBase?: string;
}) {
  const [activityOpen, setActivityOpen] = useState(false);

  return (
    <div className="bg-white rounded-lg border border-[#CBD5E0] hover:border-[#1B3A6B] shadow-sm hover:shadow-md transition-all duration-150 overflow-hidden">
      <div className="p-5">
        {/* 写真 */}
        {member.photo_url && (
          <div className="mb-4 flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={member.photo_url}
              alt={`${member.name}議員`}
              className="w-20 h-28 object-cover rounded-lg border border-[#E2E8F0] shadow-sm"
            />
          </div>
        )}
        {/* 議席番号 + 氏名 */}
        <div className="flex items-start gap-3 mb-4">
          <span className="mt-1 text-xs font-medium text-[#2A5298] bg-[#E8EEF7] rounded px-2 py-0.5 whitespace-nowrap shrink-0">
            {member.seat_number}番
          </span>
          <div className="flex-1 min-w-0">
            {memberHrefBase ? (
              <Link
                href={`${memberHrefBase}/${member.seat_number}`}
                className="text-lg font-bold text-[#1B3A6B] hover:underline leading-snug"
              >
                {member.name}
              </Link>
            ) : (
              <p className="text-lg font-bold text-[#1A202C] leading-snug">{member.name}</p>
            )}
            <p className="text-xs text-[#718096] mt-0.5">{member.furigana}</p>
          </div>
          {activity && (
            <span className="shrink-0 text-xs font-medium text-[#2A5298] bg-[#E8EEF7] rounded-full px-2 py-0.5 whitespace-nowrap">
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
            <span className={`text-xs font-medium px-2 py-0.5 rounded ${factionBadgeClass(member.faction)}`}>
              {member.faction}
            </span>
          </div>
        )}

        {/* 委員会 */}
        <div className="flex items-start gap-2 mb-3">
          <span className="text-xs font-medium text-[#718096] w-10 shrink-0 pt-0.5">委員会</span>
          <div className="flex flex-wrap gap-1">
            {member.committees.length > 0 ? (
              member.committees.map((c) => (
                <span key={c} className="text-xs text-[#4A5568] bg-[#F4F6F9] border border-[#E2E8F0] rounded px-2 py-0.5">{c}</span>
              ))
            ) : (
              <span className="text-sm text-[#A0AEC0]">―</span>
            )}
          </div>
        </div>

        {/* 関心テーマ（トップ3） */}
        {activity && activity.top_topics.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {activity.top_topics.slice(0, 3).map((t) => (
              <span key={t} className="text-xs px-2 py-0.5 bg-[#F4F6F9] text-[#4A5568] border border-[#E2E8F0] rounded-full">{t}</span>
            ))}
            {activity.top_topics.length > 3 && (
              <span className="text-xs text-[#718096]">+{activity.top_topics.length - 3}</span>
            )}
          </div>
        )}
      </div>

      {/* 質問履歴トグル */}
      {activity && (
        <>
          <button
            onClick={() => setActivityOpen((v) => !v)}
            className="w-full flex items-center justify-between px-5 py-2.5 bg-[#F4F6F9] border-t border-[#E2E8F0] text-sm text-[#4A5568] hover:bg-[#E8EEF7] hover:text-[#1B3A6B] transition-colors"
          >
            <span className="text-xs font-medium">質問履歴を見る</span>
            <svg
              className={`w-4 h-4 transition-transform ${activityOpen ? "rotate-180" : ""}`}
              viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {activityOpen && (
            <div className="border-t border-[#E2E8F0] bg-white px-5 py-4 space-y-4">
              {activity.sessions.map((s, i) => (
                <div key={i}>
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-xs font-semibold text-[#1B3A6B]">{s.session}</p>
                    {s.council_id > 0 && (
                      <Link
                        href={`/chitose/minutes/${s.council_id}`}
                        className="text-xs text-[#718096] hover:text-[#1B3A6B] flex items-center gap-0.5 transition-colors"
                      >
                        全文
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                      </Link>
                    )}
                  </div>
                  <ul className="space-y-1">
                    {s.topics.map((t) => (
                      <li key={t} className="flex items-start gap-1.5 text-xs">
                        <span className="text-[#2A5298] shrink-0 mt-0.5">·</span>
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
};

export default function MemberList({ members, factions, activity = {}, memberHrefBase }: Props) {
  const [factionFilter, setFactionFilter] = useState<string>("");
  const [partyFilter, setPartyFilter] = useState<string>("");
  const [sortKey, setSortKey] = useState<SortKey>("seat");

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

  return (
    <>
      {/* フィルター・ソートバー */}
      <div className="bg-white rounded-lg border border-[#CBD5E0] px-5 py-4 mb-6 shadow-sm">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          {hasParties && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-[#4A5568]">政党で絞り込む</label>
              <select
                value={partyFilter}
                onChange={(e) => setPartyFilter(e.target.value)}
                className="text-base border border-[#CBD5E0] rounded px-3 py-1.5 bg-white text-[#1A202C] focus:outline-none focus:ring-2 focus:ring-[#2A5298] focus:border-[#2A5298] cursor-pointer min-w-[9rem]"
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
                onChange={(e) => setFactionFilter(e.target.value)}
                className="text-base border border-[#CBD5E0] rounded px-3 py-1.5 bg-white text-[#1A202C] focus:outline-none focus:ring-2 focus:ring-[#2A5298] focus:border-[#2A5298] cursor-pointer min-w-[9rem]"
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
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="text-base border border-[#CBD5E0] rounded px-3 py-1.5 bg-white text-[#1A202C] focus:outline-none focus:ring-2 focus:ring-[#2A5298] focus:border-[#2A5298] cursor-pointer min-w-[9rem]"
            >
              <option value="seat">議席番号順</option>
              <option value="party">政党順</option>
              <option value="kana">五十音順</option>
            </select>
          </div>

          <span className="ml-auto text-base text-[#4A5568] font-medium self-end pb-1">
            {filtered.length} 名
          </span>
        </div>
      </div>

      {/* カードグリッド */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((member) => {
          const memberActivity = activity[member.name.replace(/\s/g, "")];
          return (
            <MemberCard
              key={member.seat_number}
              member={member}
              activity={memberActivity}
              factionBadgeClass={factionBadgeClass}
              memberHrefBase={memberHrefBase}
            />
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-16">
          <p className="text-base text-[#718096]">該当する議員が見つかりません</p>
          <button
            onClick={() => { setFactionFilter(""); setPartyFilter(""); }}
            className="mt-3 text-sm text-[#2A5298] hover:text-[#1B3A6B] underline"
          >
            フィルターをリセットする
          </button>
        </div>
      )}
    </>
  );
}
