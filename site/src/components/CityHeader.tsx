"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CityNavConfig } from "./CityHeaderServer";

type NavItem = { href: string; label: string };

function detectCity(
  pathname: string,
  cityKeys: string[]
): string | null {
  return cityKeys.find((c) => pathname.startsWith(`/${c}`)) ?? null;
}

interface CityHeaderProps {
  allCityNavs: Record<string, CityNavConfig>;
}

export default function CityHeader({ allCityNavs }: CityHeaderProps) {
  const pathname = usePathname();
  const cityKeys = Object.keys(allCityNavs);
  const cityKey = detectCity(pathname, cityKeys);
  const city = cityKey ? (allCityNavs[cityKey] ?? null) : null;

  function renderNavLink(item: NavItem) {
    const isActive =
      pathname === item.href || pathname.startsWith(item.href + "/");
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
    <header
      data-no-print="true"
      className="text-white relative overflow-hidden"
      style={{
        backgroundImage:
          "linear-gradient(135deg, #0F1A2F 0%, #1B3A6B 45%, #243B6B 100%)",
      }}
    >
      {/* 上部ストライプアクセント（ゴールド + わずかに細いライン） */}
      <div className="flex">
        <div className="h-1.5 bg-[#F7C948] flex-1" />
        <div className="h-1.5 bg-[#FFB142] w-12" />
        <div className="h-1.5 bg-[#F7C948] flex-1" />
      </div>

      {/* 装飾的な背景ドット（ニコニコ風のテクスチャ感） */}
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-[0.04] pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
          backgroundSize: "20px 20px",
        }}
      />

      <div className="relative max-w-5xl mx-auto px-4 py-4">
        {/* サイト名 + パンくず */}
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <Link
            href="/"
            className="group text-sm font-medium text-blue-100 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white rounded inline-flex items-center gap-1.5"
          >
            {/* メガホン × スマイルアイコン */}
            <span
              aria-hidden="true"
              className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#F7C948] text-[#1B3A6B] shadow-sm group-hover:scale-110 transition-transform"
            >
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="currentColor">
                <path d="M3 11v2a1 1 0 0 0 1 1h1l3 4h2v-12h-2l-3 4h-1a1 1 0 0 0-1 1z" />
                <path d="M14 8.5a3.5 3.5 0 0 1 0 7" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
                <path d="M16.5 6a6 6 0 0 1 0 12" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
              </svg>
            </span>
            地方議会ドットコム
            <span className="text-[10px] font-bold bg-[#F7C948] text-[#1B3A6B] rounded px-1.5 py-0.5 shadow-sm">
              β
            </span>
          </Link>
          {city && (
            <>
              <span className="text-blue-300 text-sm" aria-hidden="true">›</span>
              <span className="text-sm text-blue-100">{city.name}</span>
            </>
          )}
        </div>

        {/* メイン見出し */}
        <h1 className="text-2xl sm:text-3xl font-black tracking-tight leading-tight flex items-center gap-2 flex-wrap drop-shadow-sm">
          {city ? (
            <span className="bg-gradient-to-r from-white to-blue-100 bg-clip-text text-transparent">
              {city.name}
            </span>
          ) : (
            <>
              <span className="bg-gradient-to-r from-white via-[#FFE9A8] to-[#F7C948] bg-clip-text text-transparent">
                地方議会ドットコム
              </span>
              <span className="text-xs font-bold bg-[#F7C948] text-[#1B3A6B] rounded px-2 py-0.5 align-middle shadow-md">
                β
              </span>
            </>
          )}
        </h1>
        {!city && (
          <p className="text-sm text-blue-200 mt-1 font-medium">
            <span className="text-[#F7C948]">●</span>{" "}
            北海道内の市町村議会の情報を、横断的に。
          </p>
        )}

        {/* グローバルナビ（トップ・地図ページ） */}
        {!city && (
          <nav className="mt-3 -mb-px flex flex-wrap gap-0.5" aria-label="グローバルナビゲーション">
            {[
              { href: "/", label: "トップ" },
              { href: "/search", label: "検索" },
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
