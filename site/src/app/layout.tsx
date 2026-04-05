import type { Metadata } from "next";
import NavLink from "@/components/NavLink";
import "./globals.css";

export const metadata: Metadata = {
  title: "北海道議会情報マップ - 千歳市",
  description: "北海道内の市町村議会情報を横断的に収集・整理する情報サイト",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body className="min-h-screen flex flex-col antialiased">
        <header className="bg-[#1a3a6c] text-white">
          <div className="max-w-5xl mx-auto px-4 pt-5 pb-3">
            <p className="text-xs text-blue-200 mb-1 tracking-wide">
              北海道議会情報マップ
            </p>
            <h1 className="text-xl font-bold tracking-tight">千歳市議会</h1>
            <nav className="flex flex-wrap gap-1 mt-3">
              <NavLink href="/">議員一覧</NavLink>
              <NavLink href="/decisions">議決結果</NavLink>
              <NavLink href="/schedule">行事予定</NavLink>
              <NavLink href="/newsletter">議会だより</NavLink>
              <NavLink href="/ai-search">✦ AI検索</NavLink>
            </nav>
          </div>
        </header>

        <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-8">
          {children}
        </main>

        <footer className="border-t border-gray-200 mt-8">
          <div className="max-w-5xl mx-auto px-4 py-5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
            <span>データ出典:</span>
            <a
              href="https://www.city.chitose.lg.jp/docs/30520.html"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-gray-600"
            >
              千歳市議会公式サイト
            </a>
            <span>·</span>
            <a
              href="https://github.com/gyawa24/gikai-map-hokkaido"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-gray-600"
            >
              GitHub
            </a>
          </div>
        </footer>
      </body>
    </html>
  );
}
