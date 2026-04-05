"use client";

import { useState, useRef } from "react";
import type { FormEvent } from "react";

const EXAMPLE_QUESTIONS = [
  "小川陽平議員の会派と所属委員会を教えてください",
  "自民党議員会に所属している議員は何名いますか？",
  "令和7年第4回定例会の議決結果PDFはどこで見られますか？",
  "最新の市議会だよりは何号ですか？",
  "4月2日の行事予定を教えてください",
];

export default function AISearchPage() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [remaining, setRemaining] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || loading) return;

    // Reset state
    setAnswer("");
    setError("");
    setLoading(true);

    abortRef.current = new AbortController();

    try {
      const res = await fetch("/api/ai-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
        signal: abortRef.current.signal,
      });

      const rem = res.headers.get("X-RateLimit-Remaining");
      if (rem !== null) setRemaining(Number(rem));

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "エラーが発生しました。");
        return;
      }

      // Stream response
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

  return (
    <div className="max-w-2xl">
      {/* ページ見出し */}
      <div className="mb-6">
        <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
          <span className="text-xl">✦</span>
          AI検索
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          千歳市議会のデータをもとに、Claude AI が質問に回答します。
        </p>
      </div>

      {/* 質問フォーム */}
      <form onSubmit={handleSubmit} className="mb-5">
        <div className="flex flex-col gap-2">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="質問を入力してください（例: 自民党議員会に所属する議員は？）"
            rows={3}
            disabled={loading}
            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm shadow-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#1a3a6c] disabled:opacity-60"
          />
          <div className="flex items-center gap-2">
            {loading ? (
              <button
                type="button"
                onClick={handleStop}
                className="px-5 py-2 rounded-lg bg-red-50 text-red-600 border border-red-200 text-sm font-medium hover:bg-red-100 transition-colors"
              >
                中止
              </button>
            ) : (
              <button
                type="submit"
                disabled={!question.trim()}
                className="px-5 py-2 rounded-lg bg-[#1a3a6c] text-white text-sm font-medium hover:bg-[#254d8f] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                質問する
              </button>
            )}
            {remaining !== null && (
              <span className="text-xs text-gray-400 ml-auto">
                本日の残り利用回数: {remaining} 回
              </span>
            )}
          </div>
        </div>
      </form>

      {/* 質問例 */}
      {!answer && !loading && (
        <div className="mb-6">
          <p className="text-xs text-gray-400 mb-2">質問例</p>
          <div className="flex flex-col gap-1.5">
            {EXAMPLE_QUESTIONS.map((q) => (
              <button
                key={q}
                onClick={() => setQuestion(q)}
                className="text-left text-sm text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg px-3 py-1.5 transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* エラー */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 mb-4">
          {error}
        </div>
      )}

      {/* 回答 */}
      {(answer || loading) && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-semibold text-[#1a3a6c] bg-blue-50 rounded-full px-2.5 py-0.5">
              AI の回答
            </span>
            {loading && (
              <span className="flex gap-1 ml-1">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce [animation-delay:300ms]" />
              </span>
            )}
          </div>
          <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
            {answer}
            {loading && <span className="inline-block w-0.5 h-4 bg-gray-400 animate-pulse ml-0.5 align-text-bottom" />}
          </p>
        </div>
      )}

      {/* 注意書き */}
      <p className="mt-6 text-xs text-gray-400">
        ※ 回答はデータ収集時点の情報に基づきます。最新情報は
        <a
          href="https://www.city.chitose.lg.jp"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-gray-600"
        >
          千歳市公式サイト
        </a>
        でご確認ください。1日あたり {10} 回まで利用できます。
      </p>
    </div>
  );
}
