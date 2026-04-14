import type { Metadata } from "next";
import CityHeaderServer from "@/components/CityHeaderServer";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "北海道議会情報マップ",
    template: "%s | 北海道議会情報マップ",
  },
  description:
    "北海道内の市町村議会の議員情報・議事録・議決結果を横断的に公開する市民向け情報サイトです。",
  openGraph: {
    title: "北海道議会情報マップ",
    description:
      "北海道内の市町村議会の議員情報・議事録・議決結果を横断的に公開する市民向け情報サイトです。",
    type: "website",
    locale: "ja_JP",
    siteName: "北海道議会情報マップ",
  },
  twitter: {
    card: "summary",
    title: "北海道議会情報マップ",
    description:
      "北海道内の市町村議会の議員情報・議事録・議決結果を横断的に公開する市民向け情報サイトです。",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body className="min-h-screen flex flex-col antialiased">
        <CityHeaderServer />

        <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-8">
          {children}
        </main>

        <footer style={{ backgroundColor: "var(--color-primary)" }} className="text-white mt-8">
          <div className="max-w-5xl mx-auto px-4 py-6">
            <p className="text-sm font-medium text-blue-100 mb-3">北海道議会情報マップ</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-blue-200 mb-4">
              <span className="text-blue-300">データ出典:</span>
              <a
                href="https://www.city.chitose.lg.jp/docs/30520.html"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-white transition-colors underline decoration-blue-400"
              >
                千歳市議会
              </a>
              <span className="text-blue-400" aria-hidden="true">·</span>
              <a
                href="https://www.city.eniwa.hokkaido.jp/"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-white transition-colors underline decoration-blue-400"
              >
                恵庭市議会
              </a>
              <span className="text-blue-400" aria-hidden="true">·</span>
              <a
                href="https://www.city.tomakomai.hokkaido.jp/gikai/"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-white transition-colors underline decoration-blue-400"
              >
                苫小牧市議会
              </a>
              <span className="text-blue-400" aria-hidden="true">·</span>
              <a
                href="https://github.com/gyawa24/gikai-map-hokkaido"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-white transition-colors underline decoration-blue-400"
              >
                GitHub
              </a>
            </div>
            <p className="text-xs text-blue-300 mb-2">
              本サイトは非公式の情報サイトです。公式情報は各市議会の公式サイトでご確認ください。
            </p>
            <p className="text-xs text-blue-400">
              制作・運営: 小川陽平（千歳市議会議員）
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
