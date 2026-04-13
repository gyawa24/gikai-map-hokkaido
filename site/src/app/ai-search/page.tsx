"use client";

import { useState, useRef, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import type { FormEvent } from "react";

const NORMAL_EXAMPLES = [
  "小川陽平議員の会派と所属委員会を教えてください",
  "自民党議員会に所属している議員は何名いますか？",
  "令和7年第4回定例会の議決結果PDFはどこで見られますか？",
  "最新の市議会だよりは何号ですか？",
  "4月2日の行事予定を教えてください",
];

const COMPARE_EXAMPLES = [
  "除雪対応の違いを比較して",
  "子育て支援の予算規模を比較して",
  "公共交通への取り組みを比較して",
  "高齢者福祉サービスへの取り組みを比較して",
  "財政健全化の方針を比較して",
];

type Mode = "normal" | "compare";

function AISearchPageInner() {
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<Mode>("normal");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [remaining, setRemaining] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // URLパラメータ ?q= から初期値をセット
  useEffect(() => {
    const q = searchParams.get("q");
    if (q) setQuestion(q);
  }, [searchParams]);

  function handleModeChange(next: Mode) {
    setMode(next);
    setQuestion("");
    setAnswer("");
    setError("");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || loading) return;

    setAnswer("");
    setError("");
    setLoading(true);

    abortRef.current = new AbortController();

    try {
      const res = await fetch("/api/ai-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, compareMode: mode === "compare" }),
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

  const examples = mode === "compare" ? COMPARE_EXAMPLES : NORMAL_EXAMPLES;
  const placeholder =
    mode === "compare"
      ? "比較したいテーマを入力してください（例: 除雪対応の違いを比較して）"
      : "質問を入力してください（例: 自民党議員会に所属する議員は？）";

  return (
    <div className="max-w-2xl">
      {/* ページ見出し */}
      <div className="mb-6">
        <h2 className="text-xl font-bold text-[#1B3A6B] flex items-center gap-2 mb-1">
          <span aria-hidden="true">✦</span>
          AI検索
        </h2>
        <p className="text-base text-[#4A5568]">
          {mode === "compare"
            ? "北海道内24市町の議事録データを横断比較します。Claude AI が各市の方針・議論を構造化して回答します。"
            : "千歳市の議員・議決・スケジュールデータをもとに Claude AI が回答します。"}
        </p>
      </div>

      {/* モードトグル */}
      <div className="flex gap-0 mb-5 rounded-lg border border-[#CBD5E0] p-1 bg-white w-fit">
        <button
          type="button"
          onClick={() => handleModeChange("normal")}
          className={`px-5 py-2 rounded text-sm font-medium transition-colors ${
            mode === "normal"
              ? "bg-[#1B3A6B] text-white"
              : "text-[#4A5568] hover:text-[#1A202C]"
          }`}
        >
          通常検索
        </button>
        <button
          type="button"
          onClick={() => handleModeChange("compare")}
          className={`px-5 py-2 rounded text-sm font-medium transition-colors flex items-center gap-1.5 ${
            mode === "compare"
              ? "bg-[#1B3A6B] text-white"
              : "text-[#4A5568] hover:text-[#1A202C]"
          }`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="18" y1="20" x2="18" y2="10" />
            <line x1="12" y1="20" x2="12" y2="4" />
            <line x1="6" y1="20" x2="6" y2="14" />
          </svg>
          横断比較
        </button>
      </div>

      {/* モード説明 */}
      {mode === "compare" && (
        <div className="bg-[#E8EEF7] border border-[#CBD5E0] rounded-lg px-4 py-3 mb-5">
          <p className="text-sm text-[#1B3A6B] font-medium mb-1">横断比較モード</p>
          <p className="text-sm text-[#4A5568]">
            北海道内24市町（千歳・恵庭・苫小牧・旭川・芦別・伊達・福島・函館・北斗・池田・石狩・上川・北広島・北見・釧路・倶知安・芽室・室蘭・中川・名寄・根室・登別・帯広・稚内）の議事録データを横断比較します。
            テーマを入力すると、各市の方針・予算・議会での議論を構造化して表示します。
          </p>
        </div>
      )}

      {/* 質問フォーム */}
      <form onSubmit={handleSubmit} className="mb-5">
        <div className="flex flex-col gap-2">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={placeholder}
            rows={3}
            disabled={loading}
            className="w-full rounded-lg border border-[#CBD5E0] bg-white px-4 py-3 text-base text-[#1A202C] shadow-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#2A5298] focus:border-[#2A5298] disabled:opacity-60"
          />
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
                disabled={!question.trim()}
                className="px-5 py-2 rounded-lg bg-[#1B3A6B] text-white text-sm font-medium hover:bg-[#2A5298] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {mode === "compare" ? "比較する" : "質問する"}
              </button>
            )}
            {remaining !== null && (
              <span className="text-sm text-[#718096] ml-auto">
                本日の残り: {remaining} 回
              </span>
            )}
          </div>
        </div>
      </form>

      {/* 質問例 */}
      {!answer && !loading && (
        <div className="mb-6">
          <p className="text-xs font-medium text-[#718096] mb-2">
            {mode === "compare" ? "比較の例" : "質問の例"}
          </p>
          <div className="flex flex-col gap-1.5">
            {examples.map((q) => (
              <button
                key={q}
                onClick={() => setQuestion(q)}
                className="text-left text-sm text-[#2A5298] bg-[#E8EEF7] hover:bg-[#d4dff0] rounded px-3 py-2 transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

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
              {mode === "compare" ? "比較結果" : "AI の回答"}
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

      {/* 注意書き */}
      <p className="mt-6 text-sm text-[#718096]">
        ※ 回答はデータ収集時点の情報に基づきます。1日あたり {10} 回まで利用できます。
      </p>
    </div>
  );
}

export default function AISearchPage() {
  return (
    <Suspense>
      <AISearchPageInner />
    </Suspense>
  );
}
