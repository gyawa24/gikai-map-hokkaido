import type { Metadata } from "next";
import Link from "next/link";
import CityHeaderServer from "@/components/CityHeaderServer";
import JsonLd from "@/components/JsonLd";
import { ToastProvider } from "@/components/Toast";
import { getSearchIndexGeneratedAt, formatJaDate } from "@/lib/dataFreshness";
import {
  DEFAULT_DESCRIPTION,
  DEFAULT_OG_IMAGE,
  OWNER_X_URL,
  SITE_DISPLAY_NAME,
  SITE_NAME,
  SITE_X_URL,
  SITE_URL,
} from "@/lib/metadata";
import { buildSiteStructuredData } from "@/lib/structuredData";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    shortcut: ["/favicon.ico"],
    apple: ["/icon.svg"],
  },
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
        alt: SITE_DISPLAY_NAME,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: DEFAULT_DESCRIPTION,
    images: [DEFAULT_OG_IMAGE],
    site: "@chihougikai",
    creator: "@chihougikai",
  },
  manifest: "/site.webmanifest",
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
  const structuredData = buildSiteStructuredData();

  return (
    <html lang="ja">
      <body className="min-h-screen overflow-x-hidden antialiased">
        <JsonLd data={structuredData} />
        <ToastProvider>
          <div className="flex min-h-screen flex-col">
            <CityHeaderServer />

            <div
              data-no-print="true"
              className="border-b border-[#D7DEE8] bg-[#F7F8FA]"
            >
              <div className="page-shell flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm font-bold text-[#475569]">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="gamma-version-mark">γ</span>
                  <span>試験公開中。引用・数字は公式資料で確認してください。</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Link href="/news" prefetch={false} className="underline decoration-[#CBD5E0] underline-offset-2 hover:text-[#1b3a6b]">
                    更新情報
                  </Link>
                  <a href="mailto:ogawayohei.hkd@gmail.com" className="underline decoration-[#CBD5E0] underline-offset-2 hover:text-[#1b3a6b]">
                    フィードバック
                  </a>
                </div>
              </div>
            </div>

            <main className="flex-1 px-4 py-6 sm:py-8">
              {children}
            </main>

            <footer data-no-print="true" className="mt-10 border-t border-[#203a66] bg-[linear-gradient(180deg,#143055_0%,#0f2548_100%)] text-white">
              <div className="page-shell px-4 py-8">
                <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                  <div>
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <span className="portal-subhead border-white/25 bg-white/10 text-white">{SITE_DISPLAY_NAME}</span>
                    </div>
                    <p className="max-w-3xl text-sm leading-relaxed text-[#d5def0]">
                      北海道内の市町村議会の議員情報・議事録・議決結果を、横断的に見つけやすく整理する非公式の情報サイトです。
                      情報の入口としての見やすさを重視しつつ、公共サイトとしての信頼感も保つよう設計しています。
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold text-[#c7d5eb]">
                      <Link href="/" prefetch={false} className="theme-pill-soft border-white/15 bg-white/10 text-white">収録自治体一覧</Link>
                      <Link href="/about" prefetch={false} className="theme-pill-soft border-white/15 bg-white/10 text-white">地方議会ドットコムとは</Link>
                      <Link href="/news" prefetch={false} className="theme-pill-soft border-white/15 bg-white/10 text-white">お知らせ</Link>
                      <Link href="/articles" prefetch={false} className="theme-pill-soft border-white/15 bg-white/10 text-white">読みもの</Link>
                      <Link href="/sources" prefetch={false} className="theme-pill-soft border-white/15 bg-white/10 text-white">掲載情報と出典</Link>
                      <Link href="/methodology" prefetch={false} className="theme-pill-soft border-white/15 bg-white/10 text-white">算出方法と中立性</Link>
                      <Link href="/privacy" prefetch={false} className="theme-pill-soft border-white/15 bg-white/10 text-white">プライバシーポリシー</Link>
                      <Link href="/terms" prefetch={false} className="theme-pill-soft border-white/15 bg-white/10 text-white">利用規約</Link>
                      <a href={SITE_X_URL} target="_blank" rel="noopener noreferrer" className="theme-pill-soft border-white/15 bg-white/10 text-white">公式X</a>
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="rounded-[22px] border border-white/10 bg-white/6 p-4">
                      <p className="mb-2 text-xs font-black uppercase tracking-[0.12em] text-[#ffd54f]">データ出典</p>
                      <p className="text-sm text-[#dbe7ff]">北海道内の各市町村議会 公式ウェブサイト</p>
                      {updatedLabel && (
                        <p className="mt-2 text-xs text-[#a9bbd8]">データ最終更新: {updatedLabel}</p>
                      )}
                    </div>
                    <div className="rounded-[22px] border border-white/10 bg-white/6 p-4">
                      <p className="mb-2 text-xs font-black uppercase tracking-[0.12em] text-[#ffd54f]">運営</p>
                      <p className="text-sm text-[#dbe7ff]">千歳市議会議員</p>
                      <p className="text-xs text-[#a9bbd8]">小川陽平</p>
                      <div className="mt-2 space-y-1 text-xs">
                        <a href="mailto:ogawayohei.hkd@gmail.com" className="block text-[#dbe7ff] underline decoration-white/30">ogawayohei.hkd@gmail.com</a>
                        <a href={SITE_X_URL} target="_blank" rel="noopener noreferrer" className="block text-[#dbe7ff] underline decoration-white/30">公式X @chihougikai</a>
                        <a href={OWNER_X_URL} target="_blank" rel="noopener noreferrer" className="block text-[#dbe7ff] underline decoration-white/30">運営者X @yoheiogawa_DPFP</a>
                        <a href="https://github.com/gyawa24/gikai-map-hokkaido" target="_blank" rel="noopener noreferrer" className="block text-[#dbe7ff] underline decoration-white/30">GitHub</a>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </footer>
          </div>
        </ToastProvider>
      </body>
    </html>
  );
}
