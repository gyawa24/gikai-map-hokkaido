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
    <header data-no-print="true" style={{ backgroundColor: "var(--color-primary)" }} className="text-white">
      {/* 上部アクセントライン */}
      <div className="h-1 bg-[#F7C948]" />

      <div className="max-w-5xl mx-auto px-4 py-4">
        {/* サイト名 + パンくず */}
        <div className="flex items-center gap-2 mb-2">
          <Link
            href="/"
            className="text-sm font-medium text-blue-100 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white rounded inline-flex items-center gap-1.5"
          >
            地方議会ドットコム
            <span className="text-[10px] font-bold bg-[#F7C948] text-[#1B3A6B] rounded px-1.5 py-0.5">
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
        <h1 className="text-xl font-bold tracking-tight leading-snug flex items-center gap-2 flex-wrap">
          {city ? (
            city.name
          ) : (
            <>
              地方議会ドットコム
              <span className="text-xs font-bold bg-[#F7C948] text-[#1B3A6B] rounded px-2 py-0.5 align-middle">
                β
              </span>
            </>
          )}
        </h1>
        {!city && (
          <p className="text-sm text-blue-200 mt-0.5">
            北海道内の市町村議会の情報を横断的に検索・閲覧できます
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
