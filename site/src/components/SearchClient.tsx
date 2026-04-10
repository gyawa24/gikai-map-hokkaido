"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { SearchSession, SearchMember } from "@/app/search/page";

function highlight(text: string, query: string): string {
  if (!query) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(escaped, "gi"), (m) => `<mark>${m}</mark>`);
}

function excerpt(text: string, query: string, radius = 60): string {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text.slice(0, radius * 2);
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + query.length + radius);
  return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}

function formatDate(d: string) {
  const dt = new Date(d);
  return `${dt.getFullYear()}年${dt.getMonth() + 1}月${dt.getDate()}日`;
}

export default function SearchClient({
  sessions, members,
}: { sessions: SearchSession[]; members: SearchMember[] }) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"sessions" | "members">("sessions");

  const q = query.trim();

  const sessionResults = useMemo(() => {
    if (!q) return [];
    return sessions.flatMap((s) => {
      const hits: { session: SearchSession; segIndex: number; label: string; startTime: string; context: string; field: string }[] = [];
      for (const seg of s.segments) {
        const fields = [
          { text: seg.summary, field: "要約" },
          { text: seg.topics.join(" "), field: "トピック" },
          { text: seg.transcript, field: "全文" },
        ];
        for (const { text, field } of fields) {
          if (text.toLowerCase().includes(q.toLowerCase())) {
            hits.push({
              session: s,
              segIndex: seg.index,
              label: seg.label,
              startTime: seg.start_time,
              context: excerpt(text, q),
              field,
            });
            break; // 同セグメントは1件だけ
          }
        }
      }
      // タイトル・委員会名マッチ
      if (!hits.length && (s.title + s.committee).toLowerCase().includes(q.toLowerCase())) {
        hits.push({ session: s, segIndex: 0, label: "", startTime: "", context: s.committee, field: "会議名" });
      }
      return hits;
    });
  }, [q, sessions]);

  const memberResults = useMemo(() => {
    if (!q) return [];
    return members.filter((m) =>
      [m.name, m.furigana, m.party, m.faction, ...m.committees]
        .join(" ").toLowerCase().includes(q.toLowerCase())
    );
  }, [q, members]);

  const totalResults = tab === "sessions" ? sessionResults.length : memberResults.length;

  return (
    <div className="flex flex-col gap-4">
      {/* 検索ボックス */}
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#718096]"
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="キーワードを入力（例: プール授業、市営住宅）"
          className="w-full pl-9 pr-4 py-3 border border-[#CBD5E0] rounded-lg text-base focus:outline-none focus:border-[#1B3A6B] focus:ring-1 focus:ring-[#1B3A6B]"
        />
        {query && (
          <button onClick={() => setQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#718096] hover:text-[#1A202C]">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        )}
      </div>

      {/* タブ */}
      <div className="flex border-b border-[#E2E8F0]">
        {(["sessions", "members"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? "border-[#1B3A6B] text-[#1B3A6B]"
                : "border-transparent text-[#718096] hover:text-[#1A202C]"
            }`}
          >
            {t === "sessions" ? "議会記録" : "議員"}
            {q && (
              <span className="ml-1.5 text-xs bg-[#E8EEF7] text-[#1B3A6B] px-1.5 py-0.5 rounded-full">
                {t === "sessions" ? sessionResults.length : memberResults.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 結果 */}
      {!q && (
        <p className="text-sm text-[#718096] text-center py-8">キーワードを入力してください</p>
      )}

      {q && totalResults === 0 && (
        <p className="text-sm text-[#718096] text-center py-8">「{q}」の検索結果はありませんでした</p>
      )}

      {/* 議会記録結果 */}
      {tab === "sessions" && q && sessionResults.length > 0 && (
        <div className="flex flex-col gap-3">
          {sessionResults.map((r, i) => (
            <Link
              key={i}
              href={r.session.href}
              className="block bg-white border border-[#CBD5E0] rounded-lg px-4 py-3 hover:border-[#1B3A6B] hover:shadow-sm transition-all"
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs text-[#718096]">{formatDate(r.session.date)}</span>
                {r.session.committee && (
                  <span className="text-xs bg-[#E8EEF7] text-[#1B3A6B] px-1.5 py-0.5 rounded">{r.session.committee}</span>
                )}
                {r.label && (
                  <span className="text-xs bg-[#F4F6F9] text-[#4A5568] px-1.5 py-0.5 rounded">{r.label}{r.startTime ? ` ${r.startTime}〜` : ""}</span>
                )}
                <span className="text-xs text-[#718096] ml-auto">{r.field}</span>
              </div>
              <p className="text-sm font-medium text-[#1B3A6B] mb-1">{r.session.title}</p>
              <p
                className="text-xs text-[#4A5568] leading-relaxed [&_mark]:bg-yellow-200 [&_mark]:text-[#1A202C] [&_mark]:rounded"
                dangerouslySetInnerHTML={{ __html: highlight(r.context, q) }}
              />
            </Link>
          ))}
        </div>
      )}

      {/* 議員結果 */}
      {tab === "members" && q && memberResults.length > 0 && (
        <div className="flex flex-col gap-2">
          {memberResults.map((m, i) => (
            <Link
              key={i}
              href={m.href}
              className="block bg-white border border-[#CBD5E0] rounded-lg px-4 py-3 hover:border-[#1B3A6B] hover:shadow-sm transition-all"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <div>
                    <span
                      className="font-bold text-[#1B3A6B] text-base [&_mark]:bg-yellow-200 [&_mark]:text-[#1A202C] [&_mark]:rounded"
                      dangerouslySetInnerHTML={{ __html: highlight(m.name, q) }}
                    />
                    <span className="text-xs text-[#718096] ml-1.5">{m.furigana}</span>
                  </div>
                </div>
                <span className="text-xs text-[#718096] flex-shrink-0">{m.cityName}</span>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {m.party && (
                  <span className="text-xs px-2 py-0.5 bg-[#F4F6F9] border border-[#CBD5E0] text-[#4A5568] rounded-full"
                    dangerouslySetInnerHTML={{ __html: highlight(m.party, q) }} />
                )}
                {m.faction && m.faction !== m.party && (
                  <span className="text-xs px-2 py-0.5 bg-[#F4F6F9] border border-[#CBD5E0] text-[#4A5568] rounded-full"
                    dangerouslySetInnerHTML={{ __html: highlight(m.faction, q) }} />
                )}
                {m.committees.map((c) => (
                  <span key={c} className="text-xs px-2 py-0.5 bg-[#E8EEF7] text-[#1B3A6B] rounded-full"
                    dangerouslySetInnerHTML={{ __html: highlight(c, q) }} />
                ))}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
