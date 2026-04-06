"use client";

import { useState } from "react";
import type { Member } from "@/types/member";

const FACTION_STYLES: Record<string, { badge: string }> = {
  "自民党議員会":              { badge: "bg-amber-100 text-amber-800" },
  "自民の会":                  { badge: "bg-yellow-100 text-yellow-800" },
  "公明党議員団":              { badge: "bg-blue-100 text-blue-800" },
  "ちとせ未来クラブ":          { badge: "bg-green-100 text-green-800" },
  "日本共産党":                { badge: "bg-red-100 text-red-800" },
  "参政党":                    { badge: "bg-purple-100 text-purple-800" },
  "無所属クラブ（維新・市民）": { badge: "bg-cyan-100 text-cyan-800" },
  "無所属":                    { badge: "bg-slate-100 text-slate-600" },
};

function factionBadgeClass(faction: string): string {
  return FACTION_STYLES[faction]?.badge ?? "bg-slate-100 text-slate-600";
}

type Props = {
  members: Member[];
  factions: string[];
};

export default function MemberList({ members, factions }: Props) {
  const [selected, setSelected] = useState<string>("");

  const filtered = selected ? members.filter((m) => m.faction === selected) : members;

  return (
    <>
      {/* フィルターバー */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        {factions.length > 0 && (
          <>
            <span className="text-sm text-gray-500">会派で絞り込み</span>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
            >
              <option value="">すべて</option>
              {factions.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </>
        )}
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
