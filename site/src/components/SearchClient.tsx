"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import type { SessionHit, MemberHit } from "@/app/api/search/route";

function highlight(text: string, tokens: string[]): string {
  if (!tokens.length) return text;
  const pattern = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return text.replace(new RegExp(pattern, "gi"), (m) => `<mark>${m}</mark>`);
}

function tokenize(query: string): string[] {
  return query.trim().split(/\s+/).filter(Boolean);
}

export default function SearchClient() {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"sessions" | "members">("sessions");
  const [sessionResults, setSessionResults] = useState<SessionHit[]>([]);
  const [memberResults, setMemberResults] = useState<MemberHit[]>([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const q = query.trim();
    if (!q) {
      setSessionResults([]);
      setMemberResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setSessionResults(data.sessionResults ?? []);
        setMemberResults(data.memberResults ?? []);
      } catch {
        setSessionResults([]);
        setMemberResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  }, [query]);

  const tokens = tokenize(query);
  const hasQuery = query.trim().length > 0;
  const totalResults = tab === "sessions" ? sessionResults.length : memberResults.length;

  return (
    <div className="flex flex-col gap-4">
      {/* 検索ボックス */}
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#718096]"
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          aria-hidden="true">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="キーワードを入力（例: プール授業、市営住宅）"
          className="w-full pl-9 pr-4 py-3 border border-[#CBD5E0] rounded-lg text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298] focus-visible:border-[#2A5298]"
        />
        {query && (
          <button onClick={() => setQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#718096] hover:text-[#1A202C] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298] rounded" aria-label="検索をクリア">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4" aria-hidden="true">
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
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298] rounded-t ${
              tab === t
                ? "border-[#1B3A6B] text-[#1B3A6B]"
                : "border-transparent text-[#718096] hover:text-[#1A202C]"
            }`}
            aria-current={tab === t ? "true" : undefined}
          >
            {t === "sessions" ? "議会記録" : "議員"}
            {hasQuery && !loading && (
              <span className="ml-1.5 text-xs bg-[#E8EEF7] text-[#1B3A6B] px-1.5 py-0.5 rounded-full">
                {t === "sessions" ? sessionResults.length : memberResults.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 状態表示 */}
      {!hasQuery && (
        <p className="text-sm text-[#718096] text-center py-8">キーワードを入力してください</p>
      )}

      {hasQuery && loading && (
        <p className="text-sm text-[#718096] text-center py-8">検索中...</p>
      )}

      {hasQuery && !loading && totalResults === 0 && (
        <p className="text-sm text-[#718096] text-center py-8">「{query.trim()}」の検索結果はありませんでした</p>
      )}

      {/* 議会記録結果 */}
      {tab === "sessions" && hasQuery && !loading && sessionResults.length > 0 && (
        <div className="flex flex-col gap-3">
          {sessionResults.map((r, i) => (
            <Link
              key={i}
              href={r.href}
              className="block bg-white border border-[#CBD5E0] rounded-lg px-4 py-3 hover:border-[#1B3A6B] hover:shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298]"
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs text-[#718096]">{r.cityName}</span>
                {r.sourceType === "minutes" ? (
                  <span className="text-xs bg-[#F4F6F9] text-[#4A5568] px-1.5 py-0.5 rounded border border-[#E2E8F0]">公式議事録</span>
                ) : (
                  <span className="text-xs bg-[#E8EEF7] text-[#2A5298] px-1.5 py-0.5 rounded">会議録</span>
                )}
                {r.committee && (
                  <span className="text-xs bg-[#E8EEF7] text-[#1B3A6B] px-1.5 py-0.5 rounded">{r.committee}</span>
                )}
                {r.label && (
                  <span className="text-xs bg-[#F4F6F9] text-[#4A5568] px-1.5 py-0.5 rounded">{r.label}{r.startTime ? ` ${r.startTime}〜` : ""}</span>
                )}
                <span className="text-xs text-[#718096] ml-auto">{r.field}</span>
              </div>
              <p className="text-sm font-medium text-[#1B3A6B] mb-1">{r.title}</p>
              <p
                className="text-xs text-[#4A5568] leading-relaxed [&_mark]:bg-yellow-200 [&_mark]:text-[#1A202C] [&_mark]:rounded"
                dangerouslySetInnerHTML={{ __html: highlight(r.context, tokens) }}
              />
            </Link>
          ))}
        </div>
      )}

      {/* 議員結果 */}
      {tab === "members" && hasQuery && !loading && memberResults.length > 0 && (
        <div className="flex flex-col gap-2">
          {memberResults.map((m, i) => (
            <Link
              key={i}
              href={m.href}
              className="block bg-white border border-[#CBD5E0] rounded-lg px-4 py-3 hover:border-[#1B3A6B] hover:shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298]"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <div>
                    <span
                      className="font-bold text-[#1B3A6B] text-base [&_mark]:bg-yellow-200 [&_mark]:text-[#1A202C] [&_mark]:rounded"
                      dangerouslySetInnerHTML={{ __html: highlight(m.name, tokens) }}
                    />
                    <span className="text-xs text-[#718096] ml-1.5">{m.furigana}</span>
                  </div>
                </div>
                <span className="text-xs text-[#718096] flex-shrink-0">{m.cityName}</span>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {m.party && (
                  <span className="text-xs px-2 py-0.5 bg-[#F4F6F9] border border-[#CBD5E0] text-[#4A5568] rounded-full"
                    dangerouslySetInnerHTML={{ __html: highlight(m.party, tokens) }} />
                )}
                {m.faction && m.faction !== m.party && (
                  <span className="text-xs px-2 py-0.5 bg-[#F4F6F9] border border-[#CBD5E0] text-[#4A5568] rounded-full"
                    dangerouslySetInnerHTML={{ __html: highlight(m.faction, tokens) }} />
                )}
                {m.committees.map((c) => (
                  <span key={c} className="text-xs px-2 py-0.5 bg-[#E8EEF7] text-[#1B3A6B] rounded-full"
                    dangerouslySetInnerHTML={{ __html: highlight(c, tokens) }} />
                ))}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
