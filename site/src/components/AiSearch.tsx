"use client";

import Link from "next/link";
import { useState } from "react";
import type { AiSearchResponse, AiSearchSource } from "@/app/api/search/route";

type Props = {
  /** 指定すると municipality でフィルタしてベクトル検索する */
  defaultMunicipality?: string;
};

export default function AiSearch({ defaultMunicipality }: Props) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [sources, setSources] = useState<AiSearchSource[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    setAnswer(null);
    setSources([]);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: q,
          ...(defaultMunicipality ? { municipality: defaultMunicipality } : {}),
        }),
      });
      const data = (await res.json()) as Partial<AiSearchResponse> & { error?: string };
      if (!res.ok || data.error) {
        setError(data.error ?? "検索に失敗しました。");
        return;
      }
      setAnswer(data.answer ?? "");
      setSources(data.sources ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "検索に失敗しました。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full">
      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2">
        <label htmlFor="ai-search-query" className="sr-only">
          議事録への質問
        </label>
        <input
          id="ai-search-query"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            defaultMunicipality
              ? `${defaultMunicipality}議会の議事録に質問する`
              : "議事録に質問する（例: 保育料はいつから無償化？）"
          }
          maxLength={500}
          disabled={loading}
          className="flex-1 min-h-[44px] rounded-md border border-[#CBD5E0] bg-white px-3 py-2 text-base text-[#1A202C] placeholder:text-[#718096] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298] focus-visible:border-[#1B3A6B] disabled:bg-[#F4F6F9] disabled:cursor-not-allowed transition-colors"
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="min-h-[44px] rounded-md bg-[#1B3A6B] px-5 py-2 text-sm font-semibold text-white hover:bg-[#2A5298] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#2A5298] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "検索中..." : "AI検索"}
        </button>
      </form>

      {loading && (
        <div className="mt-5 flex items-center gap-2 text-sm text-[#4A5568]" aria-live="polite">
          <span className="inline-flex gap-1" aria-hidden="true">
            <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-[#2A5298] [animation-delay:-0.3s]" />
            <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-[#2A5298] [animation-delay:-0.15s]" />
            <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-[#2A5298]" />
          </span>
          議事録を検索しています...
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mt-5 rounded-lg border border-[#F7C948] bg-[#FFF7E6] px-4 py-3 text-sm text-[#78451F]"
        >
          {error}
        </div>
      )}

      {answer && (
        <section className="mt-6" aria-label="AI回答">
          <h2 className="text-lg font-bold text-[#1B3A6B] mb-2">回答</h2>
          <div className="rounded-lg border border-[#CBD5E0] bg-white p-5 shadow-sm">
            <p className="whitespace-pre-wrap text-base leading-relaxed text-[#1A202C]">
              {answer}
            </p>
          </div>
        </section>
      )}

      {sources.length > 0 && (
        <section className="mt-6" aria-label="参照した議事録">
          <h2 className="text-lg font-bold text-[#1B3A6B] mb-2">
            参照した議事録
            <span className="ml-2 text-xs font-medium text-[#718096] tabular-nums">
              {sources.length}件
            </span>
          </h2>
          <ol className="space-y-3">
            {sources.map((s, i) => (
              <li
                key={`${s.meeting_name}-${i}`}
                className="rounded-lg border border-[#CBD5E0] bg-white p-5 shadow-sm hover:border-[#1B3A6B] hover:shadow-md transition-all duration-150"
              >
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="text-xs font-semibold rounded bg-[#E8EEF7] text-[#2A5298] px-2 py-0.5 tabular-nums">
                    [{i + 1}]
                  </span>
                  {s.municipality && (
                    <span className="text-xs font-semibold rounded bg-[#E8EEF7] text-[#2A5298] px-2 py-0.5">
                      {s.municipality}
                    </span>
                  )}
                  {(s.speaker_name ?? s.speaker) && (
                    <span className="text-xs text-[#4A5568] bg-[#F4F6F9] border border-[#E2E8F0] rounded px-2 py-0.5">
                      {s.speaker_name ?? s.speaker}
                    </span>
                  )}
                  {typeof s.similarity === "number" && (
                    <span className="ml-auto text-xs text-[#718096] tabular-nums">
                      類似度 {(s.similarity * 100).toFixed(1)}%
                    </span>
                  )}
                </div>
                <p className="text-sm font-bold text-[#1A202C] leading-snug mb-1.5">
                  {s.meeting_name}
                </p>
                {s.agenda_title && (
                  <p className="text-xs text-[#718096] mb-1.5">
                    {s.agenda_title}
                  </p>
                )}
                <p className="text-sm leading-relaxed text-[#4A5568] line-clamp-4">
                  {s.content}
                </p>
                {s.href && (
                  <div className="mt-3">
                    <Link
                      href={s.href}
                      className="text-sm font-medium text-[#2A5298] hover:text-[#1B3A6B] transition-colors"
                    >
                      この議事録を見る
                    </Link>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
