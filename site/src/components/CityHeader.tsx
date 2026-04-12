"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = { href: string; label: string };

const CITY_CONFIG: Record<
  string,
  { name: string; baseHref: string; nav: NavItem[] }
> = {
  chitose: {
    name: "千歳市議会",
    baseHref: "/chitose",
    nav: [
      { href: "/chitose", label: "議員一覧" },
      { href: "/decisions", label: "議決結果" },
      { href: "/chitose/minutes", label: "議事録" },
      { href: "/chitose/sessions", label: "会議録・速報" },
      { href: "/schedule", label: "行事予定" },
      { href: "/newsletter", label: "議会だより" },
      { href: "/chitose/plan", label: "総合計画" },
      { href: "/ai-search", label: "✦ AI検索" },
    ],
  },
  eniwa: {
    name: "恵庭市議会",
    baseHref: "/eniwa",
    nav: [
      { href: "/eniwa", label: "議員一覧" },
      { href: "/eniwa/decisions", label: "議決結果" },
      { href: "/eniwa/minutes", label: "議事録" },
      { href: "/eniwa/schedule", label: "行事予定" },
      { href: "/eniwa/newsletter", label: "議会だより" },
      { href: "/ai-search", label: "✦ AI検索" },
    ],
  },
  tomakomai: {
    name: "苫小牧市議会",
    baseHref: "/tomakomai",
    nav: [
      { href: "/tomakomai", label: "議員一覧" },
      { href: "/tomakomai/decisions", label: "議決結果" },
      { href: "/tomakomai/minutes", label: "議事録" },
      { href: "/tomakomai/schedule", label: "行事予定" },
      { href: "/tomakomai/newsletter", label: "議会報告" },
      { href: "/ai-search", label: "✦ AI検索" },
    ],
  },
  asahikawa: {
    name: "旭川市議会",
    baseHref: "/asahikawa",
    nav: [
      { href: "/asahikawa", label: "議員一覧" },
      { href: "/asahikawa/minutes", label: "議事録" },
    ],
  },
  hakodate: {
    name: "函館市議会",
    baseHref: "/hakodate",
    nav: [
      { href: "/hakodate", label: "議員一覧" },
      { href: "/hakodate/minutes", label: "議事録" },
    ],
  },
  muroran: {
    name: "室蘭市議会",
    baseHref: "/muroran",
    nav: [
      { href: "/muroran", label: "議員一覧" },
      { href: "/muroran/minutes", label: "議事録" },
    ],
  },
  kushiro: {
    name: "釧路市議会",
    baseHref: "/kushiro",
    nav: [
      { href: "/kushiro", label: "議員一覧" },
      { href: "/kushiro/minutes", label: "議事録" },
    ],
  },
};

function detectCity(pathname: string): string | null {
  if (pathname.startsWith("/eniwa")) return "eniwa";
  if (pathname.startsWith("/tomakomai")) return "tomakomai";
  if (pathname.startsWith("/asahikawa")) return "asahikawa";
  if (pathname.startsWith("/hakodate")) return "hakodate";
  if (pathname.startsWith("/muroran")) return "muroran";
  if (pathname.startsWith("/kushiro")) return "kushiro";
  if (
    pathname.startsWith("/chitose") ||
    pathname.startsWith("/decisions") ||
    pathname.startsWith("/schedule") ||
    pathname.startsWith("/newsletter")
  )
    return "chitose";
  return null;
}

export default function CityHeader() {
  const pathname = usePathname();
  const cityKey = detectCity(pathname);
  const city = cityKey ? CITY_CONFIG[cityKey] : null;

  return (
    <header style={{ backgroundColor: "var(--color-primary)" }} className="text-white">
      {/* 上部アクセントライン */}
      <div className="h-1 bg-[#F7C948]" />

      <div className="max-w-5xl mx-auto px-4 py-4">
        {/* サイト名 + パンくず */}
        <div className="flex items-center gap-2 mb-2">
          <Link
            href="/"
            className="text-sm font-medium text-blue-100 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white rounded"
          >
            北海道議会情報マップ
          </Link>
          {city && (
            <>
              <span className="text-blue-300 text-sm" aria-hidden="true">›</span>
              <span className="text-sm text-blue-100">{city.name}</span>
            </>
          )}
        </div>

        {/* メイン見出し */}
        <h1 className="text-xl font-bold tracking-tight leading-snug">
          {city ? city.name : "北海道議会情報マップ"}
        </h1>
        {!city && (
          <p className="text-sm text-blue-200 mt-0.5">
            北海道内の市議会情報を横断的に検索・閲覧できます
          </p>
        )}

        {/* グローバルナビ（トップ・地図ページ） */}
        {!city && (
          <nav className="mt-3 -mb-px flex flex-wrap gap-0.5" aria-label="グローバルナビゲーション">
            {[
              { href: "/", label: "トップ" },
              { href: "/map", label: "地図" },
              { href: "/chitose/sessions", label: "会議録・要約" },
              { href: "/search", label: "検索" },
              { href: "/ai-search", label: "✦ AI検索" },
            ].map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`
                    text-sm px-3 py-2 transition-colors border-b-2 rounded
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white
                    ${isActive
                      ? "border-[#F7C948] text-white font-semibold"
                      : "border-transparent text-blue-100 hover:text-white hover:border-blue-300"
                    }
                  `}
                  aria-current={isActive ? "page" : undefined}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        )}

        {/* 市ページのナビゲーション */}
        {city && (
          <nav className="mt-3 -mb-px flex flex-wrap gap-0.5" aria-label="ページナビゲーション">
            {city.nav.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`
                    text-sm px-3 py-2 transition-colors border-b-2 rounded
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white
                    ${isActive
                      ? "border-[#F7C948] text-white font-semibold"
                      : "border-transparent text-blue-100 hover:text-white hover:border-blue-300"
                    }
                  `}
                  aria-current={isActive ? "page" : undefined}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        )}
      </div>
    </header>
  );
}
