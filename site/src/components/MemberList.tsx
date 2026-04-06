"use client";

import { useState, useMemo } from "react";
import type { Member } from "@/types/member";

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

type Props = {
  members: Member[];
  factions: string[];
};

export default function MemberList({ members, factions }: Props) {
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
        {filtered.map((member) => (
          <div
            key={member.seat_number}
            className="bg-white rounded-lg border border-[#CBD5E0] hover:border-[#1B3A6B] p-5 shadow-sm hover:shadow-md transition-all duration-150"
          >
            {/* 議席番号 + 氏名 */}
            <div className="flex items-start gap-3 mb-4">
              <span className="mt-1 text-xs font-medium text-[#2A5298] bg-[#E8EEF7] rounded px-2 py-0.5 whitespace-nowrap shrink-0">
                {member.seat_number}番
              </span>
              <div>
                <p className="text-lg font-bold text-[#1A202C] leading-snug">
                  {member.name}
                </p>
                <p className="text-xs text-[#718096] mt-0.5">{member.furigana}</p>
              </div>
            </div>

            {/* 区切り線 */}
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
                <span
                  className={`text-xs font-medium px-2 py-0.5 rounded ${factionBadgeClass(member.faction)}`}
                >
                  {member.faction}
                </span>
              </div>
            )}

            {/* 委員会 */}
            <div className="flex items-start gap-2">
              <span className="text-xs font-medium text-[#718096] w-10 shrink-0 pt-0.5">委員会</span>
              <div className="flex flex-wrap gap-1">
                {member.committees.length > 0 ? (
                  member.committees.map((c) => (
                    <span
                      key={c}
                      className="text-xs text-[#4A5568] bg-[#F4F6F9] border border-[#E2E8F0] rounded px-2 py-0.5"
                    >
                      {c}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-[#A0AEC0]">―</span>
                )}
              </div>
            </div>
          </div>
        ))}
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
