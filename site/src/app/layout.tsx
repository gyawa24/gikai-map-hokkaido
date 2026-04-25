import type { Metadata } from "next";
import Link from "next/link";
import { Noto_Sans_JP } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import CityHeaderServer from "@/components/CityHeaderServer";
import { ToastProvider } from "@/components/Toast";
import { getSearchIndexGeneratedAt, formatJaDate } from "@/lib/dataFreshness";
import {
  DEFAULT_DESCRIPTION,
  DEFAULT_OG_IMAGE,
  SITE_NAME,
  SITE_URL,
} from "@/lib/metadata";
import "./globals.css";

// next/font/google は build 時にフォントをダウンロードし同一オリジンから配信するため
// CSP の font-src 'self' のまま使える（外部フェッチなし）。
const notoSansJP = Noto_Sans_JP({
  subsets: ["latin"],
  weight: ["400", "500", "700", "800"],
  display: "swap",
  variable: "--font-noto-sans-jp",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_NAME,
    template: `%s | ${SITE_NAME}`,
  },
  applicationName: SITE_NAME,
  description: DEFAULT_DESCRIPTION,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: SITE_NAME,
    description: DEFAULT_DESCRIPTION,
    type: "website",
    locale: "ja_JP",
    siteName: SITE_NAME,
    url: SITE_URL,
    images: [
      {
        url: DEFAULT_OG_IMAGE,
        width: 1200,
        height: 630,
        alt: SITE_NAME,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: DEFAULT_DESCRIPTION,
    images: [DEFAULT_OG_IMAGE],
  },
  manifest: "/site.webmanifest",
  icons: {
    icon: "/favicon.ico",
  },
  robots: {
    index: true,
    follow: true,
  },
  verification: {
    google: "cXOlXYosbqTtvyKLnsrfkvG6L_FAkrFcRf46FV8LrY4",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const updatedAt = getSearchIndexGeneratedAt();
  const updatedLabel = formatJaDate(updatedAt);
  return (
    <html lang="ja" className={notoSansJP.variable}>
      <body className="min-h-screen flex flex-col antialiased">
        <ToastProvider>
          <CityHeaderServer />

        {/* ベータ公開バナー */}
        <div data-no-print="true" className="bg-[#FFF7E6] border-b border-[#F7C948]">
          <div className="max-w-5xl mx-auto px-4 py-2 text-xs text-[#78451F] flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
            <span className="font-bold bg-[#F7C948] text-[#1B3A6B] rounded px-1.5 py-0.5 tracking-wide">
              β
            </span>
            <span>ベータ公開中 — 機能追加・仕様変更があります</span>
            <span aria-hidden="true" className="text-[#CBB46B]">·</span>
            <Link href="/news" className="underline hover:text-[#1B3A6B]">
              更新情報
            </Link>
          </div>
        </div>

        <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-8">
          {children}
        </main>

        <footer data-no-print="true" style={{ backgroundColor: "var(--color-primary)" }} className="text-white mt-8">
          <div className="max-w-5xl mx-auto px-4 py-6">
            <p className="text-sm font-medium text-blue-100 mb-3">
              地方議会ドットコム
              <span className="ml-2 text-[10px] font-bold bg-[#F7C948] text-[#1B3A6B] rounded px-1.5 py-0.5 align-middle">
                β
              </span>
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-blue-200 mb-4">
              <span className="text-blue-300">データ出典:</span>
              <span className="text-blue-100">
                北海道内の各市町村議会 公式ウェブサイト
              </span>
              <Link
                href="/"
                className="hover:text-white transition-colors underline decoration-blue-400"
              >
                収録自治体一覧
              </Link>
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
              本サイトは非公式の情報サイトです。公式情報は各市町村議会の公式サイトでご確認ください。
            </p>
            {updatedLabel && (
              <p className="text-xs text-blue-300 mb-2">
                データ最終更新: {updatedLabel} 時点（以降の議事録は各市町村議会の公式サイトをご覧ください）
              </p>
            )}
            <div className="text-xs text-blue-400 space-y-1">
              <p>運営: 株式会社オガワヤ（代表: 小川陽平 / 千歳市議会議員）</p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <a
                  href="mailto:ogawayohei.hkd@gmail.com"
                  className="hover:text-white transition-colors underline decoration-blue-500"
                >
                  ogawayohei.hkd@gmail.com
                </a>
                <a
                  href="https://x.com/yoheiogawa_DPFP"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-white transition-colors underline decoration-blue-500"
                >
                  X @yoheiogawa_DPFP
                </a>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
                <Link
                  href="/news"
                  className="hover:text-white transition-colors underline decoration-blue-500"
                >
                  お知らせ
                </Link>
                <Link
                  href="/privacy"
                  className="hover:text-white transition-colors underline decoration-blue-500"
                >
                  プライバシーポリシー
                </Link>
                <Link
                  href="/terms"
                  className="hover:text-white transition-colors underline decoration-blue-500"
                >
                  利用規約
                </Link>
              </div>
            </div>
          </div>
        </footer>
        </ToastProvider>
        <Analytics />
      </body>
    </html>
  );
}
