import type { Metadata } from "next";
import CityHeader from "@/components/CityHeader";
import "./globals.css";

export const metadata: Metadata = {
  title: "北海道議会情報マップ",
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
        <CityHeader />

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
              千歳市議会
            </a>
            <span>·</span>
            <a
              href="https://www.city.eniwa.hokkaido.jp/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-gray-600"
            >
              恵庭市議会
            </a>
            <span>·</span>
            <a
              href="https://www.city.tomakomai.hokkaido.jp/gikai/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-gray-600"
            >
              苫小牧市議会
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
