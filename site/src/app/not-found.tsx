import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "ページが見つかりません",
  robots: {
    index: false,
    follow: false,
  },
};

export default function NotFound() {
  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white rounded-lg border border-[#CBD5E0] shadow-sm overflow-hidden">
        {/* アクセントライン */}
        <div className="h-1 bg-[#F7C948]" />

        <div className="p-8 text-center">
          {/* 404 数字 */}
          <p className="text-6xl font-bold text-[#E8EEF7] leading-none mb-2" aria-hidden="true">
            404
          </p>

          <h1 className="text-xl font-bold text-[#1B3A6B] mb-3">
            ページが見つかりません
          </h1>

          <p className="text-base text-[#4A5568] leading-relaxed mb-8">
            お探しのページは存在しないか、移動・削除された可能性があります。
            <br className="hidden sm:block" />
            URLをご確認いただくか、以下のリンクからお探しください。
          </p>

          {/* 誘導ボタン */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/"
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
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
              トップページに戻る
            </Link>

            <Link
              href="/search"
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
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              議事録を検索する
            </Link>
          </div>
        </div>

        {/* よく見られるページ */}
        <div className="border-t border-[#E2E8F0] px-8 py-5">
          <p className="text-xs font-semibold text-[#718096] uppercase tracking-wider mb-3">
            よく見られるページ
          </p>
          <div className="flex flex-wrap gap-2">
            {[
              { href: "/chitose", label: "千歳市議会" },
              { href: "/eniwa", label: "恵庭市議会" },
              { href: "/tomakomai", label: "苫小牧市議会" },
              { href: "/chitose/minutes", label: "千歳市 議事録" },
              { href: "/eniwa/minutes", label: "恵庭市 議事録" },
            ].map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm text-[#2A5298] bg-[#E8EEF7] hover:bg-[#1B3A6B] hover:text-white
                           px-3 py-1.5 rounded transition-colors
                           focus-visible:ring-2 focus-visible:ring-[#2A5298] focus-visible:outline-none"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
