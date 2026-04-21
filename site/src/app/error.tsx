"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 本番ではここで Sentry など外部ログに送信する想定
    console.error(error);
  }, [error]);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white rounded-lg border border-[#CBD5E0] shadow-sm overflow-hidden">
        <div className="h-1 bg-[#F7C948]" />

        <div className="p-8 text-center">
          <p className="text-6xl font-bold text-[#E8EEF7] leading-none mb-2" aria-hidden="true">
            Error
          </p>

          <h1 className="text-xl font-bold text-[#1B3A6B] mb-3">
            問題が発生しました
          </h1>

          <p className="text-base text-[#4A5568] leading-relaxed mb-2">
            申し訳ありません。ページの表示中にエラーが発生しました。
          </p>
          <p className="text-sm text-[#718096] mb-8">
            繰り返し発生する場合は、お問い合わせ窓口までご連絡ください。
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center mb-4">
            <button
              onClick={reset}
              className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg
                         bg-[#1B3A6B] text-white text-sm font-semibold
                         hover:bg-[#2A5298] transition-colors
                         focus-visible:ring-2 focus-visible:ring-[#2A5298] focus-visible:outline-none"
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
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
              もう一度試す
            </button>

            <Link
              href="/"
              className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg
                         bg-white text-[#1B3A6B] text-sm font-semibold
                         border border-[#CBD5E0] hover:border-[#1B3A6B] hover:bg-[#E8EEF7]
                         transition-colors
                         focus-visible:ring-2 focus-visible:ring-[#2A5298] focus-visible:outline-none"
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
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
              トップページに戻る
            </Link>
          </div>

          {error.digest && (
            <p className="text-xs text-[#A0AEC0] mt-6">
              エラーID: <code className="bg-[#F4F6F9] px-1.5 py-0.5 rounded">{error.digest}</code>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
