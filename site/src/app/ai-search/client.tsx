"use client";

import { useState, useRef, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import type { FormEvent } from "react";

type City = { slug: string; name: string; region: string };

type Props = {
  cities: City[];
  themes: string[];
};

const REGION_ORDER = [
  "石狩", "空知", "後志", "胆振", "日高", "渡島", "檜山",
  "上川", "留萌", "宗谷", "オホーツク", "十勝", "釧路", "根室",
];

function AISearchInner({ cities, themes }: Props) {
  const searchParams = useSearchParams();
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [selectedTheme, setSelectedTheme] = useState<string>("");
  const [freeText, setFreeText] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [remaining, setRemaining] = useState<number | null>(null);
  const [showAllCities, setShowAllCities] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const q = searchParams.get("q");
    if (q) setFreeText(q);
  }, [searchParams]);

  function toggleCity(slug: string) {
    setSelectedCities((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]
    );
  }

  function buildQuestion(): string {
    if (freeText.trim()) return freeText.trim();

    const cityNames = selectedCities
      .map((s) => cities.find((c) => c.slug === s)?.name)
      .filter(Boolean);

    if (cityNames.length > 0 && selectedTheme) {
      if (cityNames.length === 1) {
        return `${cityNames[0]}議会で「${selectedTheme}」についてどのような議論がありましたか？`;
      }
      return `${cityNames.join("・")}の議会で「${selectedTheme}」について、各市の取り組みや議論を比較してください。`;
    }
    if (cityNames.length > 0) {
      if (cityNames.length === 1) {
        return `${cityNames[0]}議会の最近の議論の概要を教えてください。`;
      }
      return `${cityNames.join("・")}の議会の取り組みを比較してください。`;
    }
    if (selectedTheme) {
      return `北海道内の市町村議会で「${selectedTheme}」についてどのような議論がありましたか？`;
    }
    return "";
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const q = buildQuestion();
    if (!q || loading) return;

    setAnswer("");
    setError("");
    setLoading(true);
    abortRef.current = new AbortController();

    const compareMode = selectedCities.length >= 2 || (!freeText.trim() && selectedCities.length === 0 && selectedTheme);

    try {
      const res = await fetch("/api/ai-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, compareMode, cities: selectedCities.length > 0 ? selectedCities : undefined }),
        signal: abortRef.current.signal,
      });

      const rem = res.headers.get("X-RateLimit-Remaining");
      if (rem !== null) setRemaining(Number(rem));

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "エラーが発生しました。");
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        setAnswer((prev) => prev + decoder.decode(value, { stream: true }));
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "AbortError") {
        setError("通信エラーが発生しました。再度お試しください。");
      }
    } finally {
      setLoading(false);
    }
  }

  function handleStop() {
    abortRef.current?.abort();
    setLoading(false);
  }

  // 地域別グループ化
  const grouped = new Map<string, City[]>();
  for (const city of cities) {
    const list = grouped.get(city.region) ?? [];
    list.push(city);
    grouped.set(city.region, list);
  }

  const question = buildQuestion();
  const visibleCities = showAllCities ? cities : cities.slice(0, 12);

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-[#1B3A6B] flex items-center gap-2 mb-1">
          <span aria-hidden="true">✦</span>
          AI検索
        </h2>
        <p className="text-base text-[#4A5568]">
          市町村とテーマを選んで、議事録データをAIで横断検索・比較できます。
        </p>
      </div>

      {/* 市町村選択 */}
      <div className="mb-4">
        <p className="text-xs font-semibold text-[#718096] uppercase tracking-wider mb-2">市町村を選ぶ（複数可）</p>
        <div className="flex flex-wrap gap-1.5">
          {visibleCities.map((city) => {
            const selected = selectedCities.includes(city.slug);
            return (
              <button
                key={city.slug}
                type="button"
                onClick={() => toggleCity(city.slug)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  selected
                    ? "bg-[#1B3A6B] text-white border-[#1B3A6B]"
                    : "bg-white text-[#4A5568] border-[#CBD5E0] hover:border-[#2A5298] hover:text-[#2A5298]"
                }`}
              >
                {city.name}
              </button>
            );
          })}
          {!showAllCities && cities.length > 12 && (
            <button
              type="button"
              onClick={() => setShowAllCities(true)}
              className="text-xs px-2.5 py-1 rounded-full border border-dashed border-[#CBD5E0] text-[#718096] hover:text-[#2A5298] hover:border-[#2A5298] transition-colors"
            >
              +{cities.length - 12}市町村
            </button>
          )}
        </div>
        {selectedCities.length > 0 && (
          <button
            type="button"
            onClick={() => setSelectedCities([])}
            className="mt-1.5 text-[11px] text-[#718096] hover:text-red-500 transition-colors"
          >
            選択をクリア
          </button>
        )}
      </div>

      {/* テーマ選択 */}
      <div className="mb-4">
        <p className="text-xs font-semibold text-[#718096] uppercase tracking-wider mb-2">テーマを選ぶ</p>
        <div className="flex flex-wrap gap-1.5">
          {themes.map((theme) => (
            <button
              key={theme}
              type="button"
              onClick={() => setSelectedTheme(selectedTheme === theme ? "" : theme)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                selectedTheme === theme
                  ? "bg-[#2A5298] text-white border-[#2A5298]"
                  : "bg-[#E8EEF7] text-[#2A5298] border-transparent hover:bg-[#d4dff0]"
              }`}
            >
              {theme}
            </button>
          ))}
        </div>
      </div>

      {/* 自由記述 */}
      <form onSubmit={handleSubmit} className="mb-5">
        <div className="flex flex-col gap-2">
          <textarea
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            placeholder={
              selectedCities.length > 0 || selectedTheme
                ? "自由記述で補足（省略可）"
                : "質問を入力してください（例: 千歳市の除雪対応について教えて）"
            }
            rows={2}
            disabled={loading}
            className="w-full rounded-lg border border-[#CBD5E0] bg-white px-4 py-3 text-sm text-[#1A202C] shadow-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#2A5298] focus:border-[#2A5298] disabled:opacity-60"
          />

          {/* 生成される質問プレビュー */}
          {!freeText.trim() && question && (
            <p className="text-xs text-[#718096] bg-[#F4F6F9] rounded px-3 py-2">
              質問: {question}
            </p>
          )}

          <div className="flex items-center gap-2">
            {loading ? (
              <button
                type="button"
                onClick={handleStop}
                className="px-5 py-2 rounded-lg bg-red-50 text-red-700 border border-red-200 text-sm font-medium hover:bg-red-100 transition-colors"
              >
                中止
              </button>
            ) : (
              <button
                type="submit"
                disabled={!question}
                className="px-5 py-2 rounded-lg bg-[#1B3A6B] text-white text-sm font-medium hover:bg-[#2A5298] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {selectedCities.length >= 2 ? "比較する" : "質問する"}
              </button>
            )}
            {remaining !== null && (
              <span className="text-sm text-[#718096] ml-auto">
                残り: {remaining}回
              </span>
            )}
          </div>
        </div>
      </form>

      {/* エラー */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-base text-red-700 mb-4">
          {error}
        </div>
      )}

      {/* 回答 */}
      {(answer || loading) && (
        <div className="bg-white rounded-lg border border-[#CBD5E0] shadow-sm p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm font-semibold text-[#1B3A6B] bg-[#E8EEF7] rounded px-2.5 py-0.5">
              {selectedCities.length >= 2 ? "比較結果" : "AI の回答"}
            </span>
            {loading && (
              <span className="flex gap-1 ml-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#2A5298] animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-[#2A5298] animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-[#2A5298] animate-bounce [animation-delay:300ms]" />
              </span>
            )}
          </div>
          <p className="text-base text-[#1A202C] leading-relaxed whitespace-pre-wrap">
            {answer}
            {loading && (
              <span className="inline-block w-0.5 h-4 bg-[#718096] animate-pulse ml-0.5 align-text-bottom" />
            )}
          </p>
        </div>
      )}

      <p className="mt-6 text-sm text-[#718096]">
        ※ 回答はデータ収集時点の情報に基づきます。1日あたり10回まで利用できます。
      </p>
    </div>
  );
}

export default function AISearchClient(props: Props) {
  return (
    <Suspense>
      <AISearchInner {...props} />
    </Suspense>
  );
}
