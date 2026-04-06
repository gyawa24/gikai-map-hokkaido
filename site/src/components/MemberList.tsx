"use client";

import { useState, useMemo } from "react";
import type { Member } from "@/types/member";

const FACTION_STYLES: Record<string, { badge: string }> = {
  "自民党議員会":              { badge: "bg-amber-100 text-amber-800" },
  "自民の会":                  { badge: "bg-yellow-100 text-yellow-800" },
  "公明党議員団":              { badge: "bg-blue-100 text-blue-800" },
  "ちとせ未来クラブ":          { badge: "bg-green-100 text-green-800" },
  "日本共産党":                { badge: "bg-red-100 text-red-800" },
  "日本共産党市議団":          { badge: "bg-red-100 text-red-800" },
  "参政党":                    { badge: "bg-purple-100 text-purple-800" },
  "無所属クラブ（維新・市民）": { badge: "bg-cyan-100 text-cyan-800" },
  "自由民主党議員団（翡翠会）": { badge: "bg-amber-100 text-amber-800" },
  "民主・春風の会":            { badge: "bg-sky-100 text-sky-800" },
  "市民と歩む会":              { badge: "bg-teal-100 text-teal-800" },
  "諸派":                      { badge: "bg-gray-100 text-gray-700" },
  "新緑":                      { badge: "bg-lime-100 text-lime-800" },
  "民主クラブ":                { badge: "bg-sky-100 text-sky-800" },
  "改革フォーラム":            { badge: "bg-orange-100 text-orange-800" },
  "会派市民":                  { badge: "bg-teal-100 text-teal-800" },
  "無所属":                    { badge: "bg-slate-100 text-slate-600" },
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
  return FACTION_STYLES[faction]?.badge ?? "bg-slate-100 text-slate-600";
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
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-6">
        {hasParties && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 whitespace-nowrap">政党</span>
            <select
              value={partyFilter}
              onChange={(e) => setPartyFilter(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
            >
              <option value="">すべて</option>
              {parties.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
        )}

        {factions.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 whitespace-nowrap">会派</span>
            <select
              value={factionFilter}
              onChange={(e) => setFactionFilter(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
            >
              <option value="">すべて</option>
              {factions.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>
        )}

        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500 whitespace-nowrap">並び順</span>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
          >
            <option value="seat">議席番号順</option>
            <option value="party">政党順</option>
            <option value="kana">五十音順</option>
          </select>
        </div>

        <span className="ml-auto text-sm text-gray-400">{filtered.length} 名</span>
      </div>

      {/* カードグリッド */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((member) => (
          <div
            key={member.seat_number}
            className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-150"
          >
            {/* 議席番号 + 氏名 */}
            <div className="flex items-start gap-3 mb-4">
              <span className="mt-0.5 text-xs text-gray-400 bg-gray-50 rounded px-2 py-0.5 whitespace-nowrap">
                {member.seat_number}番
              </span>
              <div>
                <p className="text-base font-bold text-gray-900 leading-snug">
                  {member.name}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">{member.furigana}</p>
              </div>
            </div>

            {/* 政党 */}
            {member.party && (
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs text-gray-400 w-8 shrink-0">政党</span>
                <span className="text-xs text-gray-700">{member.party}</span>
              </div>
            )}

            {/* 会派 */}
            {member.faction && (
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs text-gray-400 w-8 shrink-0">会派</span>
                <span
                  className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${factionBadgeClass(member.faction)}`}
                >
                  {member.faction}
                </span>
              </div>
            )}

            {/* 委員会 */}
            <div className="flex items-start gap-2">
              <span className="text-xs text-gray-400 w-8 shrink-0 pt-0.5">委員会</span>
              <div className="flex flex-wrap gap-1.5">
                {member.committees.length > 0 ? (
                  member.committees.map((c) => (
                    <span
                      key={c}
                      className="text-xs bg-blue-50 text-blue-700 rounded px-2 py-0.5"
                    >
                      {c}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-gray-300">―</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="text-center text-gray-400 py-16">該当する議員が見つかりません</p>
      )}
    </>
  );
}
