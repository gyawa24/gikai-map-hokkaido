"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CityNavConfig } from "./CityHeaderServer";

type NavItem = { href: string; label: string };

// Fallback static config used when allCityNavs is not provided
const FALLBACK_CITY_CONFIG: Record<string, CityNavConfig> = {
  chitose: {
    name: "千歳市議会",
    nav: [
      { href: "/chitose", label: "議員一覧" },
      { href: "/chitose/decisions", label: "議決結果" },
      { href: "/chitose/minutes", label: "議事録" },
      { href: "/chitose/sessions", label: "会議録・速報" },
      { href: "/chitose/schedule", label: "行事予定" },
      { href: "/chitose/newsletter", label: "議会だより" },
      { href: "/chitose/plan", label: "総合計画" },
      { href: "/chitose/election", label: "選挙結果" },
      { href: "/ai-search", label: "✦ AI検索" },
    ],
  },
  eniwa: {
    name: "恵庭市議会",
    nav: [
      { href: "/eniwa", label: "議員一覧" },
      { href: "/eniwa/decisions", label: "議決結果" },
      { href: "/eniwa/minutes", label: "議事録" },
      { href: "/eniwa/election", label: "選挙結果" },
      { href: "/eniwa/schedule", label: "行事予定" },
      { href: "/eniwa/newsletter", label: "議会だより" },
      { href: "/ai-search", label: "✦ AI検索" },
    ],
  },
  tomakomai: {
    name: "苫小牧市議会",
    nav: [
      { href: "/tomakomai", label: "議員一覧" },
      { href: "/tomakomai/decisions", label: "議決結果" },
      { href: "/tomakomai/minutes", label: "議事録" },
      { href: "/tomakomai/election", label: "選挙結果" },
      { href: "/tomakomai/schedule", label: "行事予定" },
      { href: "/tomakomai/newsletter", label: "議会報告" },
      { href: "/ai-search", label: "✦ AI検索" },
    ],
  },
  asahikawa: {
    name: "旭川市議会",
    nav: [
      { href: "/asahikawa", label: "議員一覧" },
      { href: "/asahikawa/minutes", label: "議事録" },
    ],
  },
  hakodate: {
    name: "函館市議会",
    nav: [
      { href: "/hakodate", label: "議員一覧" },
      { href: "/hakodate/minutes", label: "議事録" },
    ],
  },
  muroran: {
    name: "室蘭市議会",
    nav: [
      { href: "/muroran", label: "議員一覧" },
      { href: "/muroran/minutes", label: "議事録" },
    ],
  },
  kushiro: {
    name: "釧路市議会",
    nav: [
      { href: "/kushiro", label: "議員一覧" },
      { href: "/kushiro/minutes", label: "議事録" },
    ],
  },
  wakkanai: {
    name: "稚内市議会",
    nav: [
      { href: "/wakkanai", label: "議員一覧" },
      { href: "/wakkanai/minutes", label: "議事録" },
    ],
  },
  kitami: {
    name: "北見市議会",
    nav: [
      { href: "/kitami", label: "議員一覧" },
      { href: "/kitami/minutes", label: "議事録" },
    ],
  },
  obihiro: {
    name: "帯広市議会",
    nav: [
      { href: "/obihiro", label: "議員一覧" },
      { href: "/obihiro/minutes", label: "議事録" },
    ],
  },
  nayoro: {
    name: "名寄市議会",
    nav: [
      { href: "/nayoro", label: "議員一覧" },
      { href: "/nayoro/minutes", label: "議事録" },
    ],
  },
  date: {
    name: "伊達市議会",
    nav: [
      { href: "/date", label: "議員一覧" },
      { href: "/date/minutes", label: "議事録" },
    ],
  },
  fukushima: {
    name: "福島町議会",
    nav: [
      { href: "/fukushima", label: "議員一覧" },
      { href: "/fukushima/minutes", label: "議事録" },
    ],
  },
  hokuto: {
    name: "北斗市議会",
    nav: [
      { href: "/hokuto", label: "議員一覧" },
      { href: "/hokuto/minutes", label: "議事録" },
    ],
  },
  ishikari: {
    name: "石狩市議会",
    nav: [
      { href: "/ishikari", label: "議員一覧" },
      { href: "/ishikari/minutes", label: "議事録" },
    ],
  },
  kitahiroshima: {
    name: "北広島市議会",
    nav: [
      { href: "/kitahiroshima", label: "議員一覧" },
      { href: "/kitahiroshima/minutes", label: "議事録" },
    ],
  },
  nemuro: {
    name: "根室市議会",
    nav: [
      { href: "/nemuro", label: "議員一覧" },
      { href: "/nemuro/minutes", label: "議事録" },
    ],
  },
  noboribetsu: {
    name: "登別市議会",
    nav: [
      { href: "/noboribetsu", label: "議員一覧" },
      { href: "/noboribetsu/minutes", label: "議事録" },
    ],
  },
  ashibetsu: {
    name: "芦別市議会",
    nav: [
      { href: "/ashibetsu", label: "議員一覧" },
      { href: "/ashibetsu/minutes", label: "議事録" },
    ],
  },
  memuro: {
    name: "芽室町議会",
    nav: [
      { href: "/memuro", label: "議員一覧" },
      { href: "/memuro/minutes", label: "議事録" },
    ],
  },
  kamikawa: {
    name: "上川町議会",
    nav: [
      { href: "/kamikawa", label: "議員一覧" },
      { href: "/kamikawa/minutes", label: "議事録" },
    ],
  },
  nakagawa: {
    name: "中川町議会",
    nav: [
      { href: "/nakagawa", label: "議員一覧" },
      { href: "/nakagawa/minutes", label: "議事録" },
    ],
  },
  esashi: {
    name: "江差町議会",
    nav: [
      { href: "/esashi", label: "議員一覧" },
      { href: "/esashi/minutes", label: "議事録" },
    ],
  },
};

const CITY_KEYS = [
  "eniwa",
  "tomakomai",
  "asahikawa",
  "hakodate",
  "muroran",
  "kushiro",
  "wakkanai",
  "kitami",
  "obihiro",
  "nayoro",
  "date",
  "fukushima",
  "hokuto",
  "ishikari",
  "kitahiroshima",
  "nemuro",
  "noboribetsu",
  "ashibetsu",
  "memuro",
  "kamikawa",
  "nakagawa",
  "kutchan",
  "ikeda",
  "esashi",
  "chitose",
];

function detectCity(pathname: string): string | null {
  return CITY_KEYS.find((c) => pathname.startsWith(`/${c}`)) ?? null;
}

interface CityHeaderProps {
  allCityNavs?: Record<string, CityNavConfig>;
}

export default function CityHeader({ allCityNavs }: CityHeaderProps) {
  const pathname = usePathname();
  const cityKey = detectCity(pathname);
  const navConfigs = allCityNavs ?? FALLBACK_CITY_CONFIG;
  const city = cityKey ? (navConfigs[cityKey] ?? null) : null;

  function renderNavLink(item: NavItem) {
    const isActive =
      item.href === "/ai-search"
        ? pathname === item.href
        : pathname === item.href || pathname.startsWith(item.href + "/");
    return (
      <Link
        key={item.href}
        href={item.href}
        className={`
          text-sm px-3 py-2 transition-colors border-b-2 rounded
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white
          ${
            isActive
              ? "border-[#F7C948] text-white font-semibold"
              : "border-transparent text-blue-100 hover:text-white hover:border-blue-300"
          }
        `}
        aria-current={isActive ? "page" : undefined}
      >
        {item.label}
      </Link>
    );
  }

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
              { href: "/topics", label: "テーマ別" },
              { href: "/chitose/sessions", label: "会議録・要約" },
              { href: "/search", label: "検索" },
              { href: "/ai-search", label: "✦ AI検索" },
            ].map(renderNavLink)}
          </nav>
        )}

        {/* 市ページのナビゲーション */}
        {city && (
          <nav className="mt-3 -mb-px flex flex-wrap gap-0.5" aria-label="ページナビゲーション">
            {city.nav.map(renderNavLink)}
          </nav>
        )}
      </div>
    </header>
  );
}
