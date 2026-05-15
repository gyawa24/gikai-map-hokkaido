"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CityNavConfig } from "./CityHeaderServer";

type NavItem = { href: string; label: string };

function detectCity(pathname: string, cityKeys: string[]): string | null {
  return cityKeys.find((c) => pathname.startsWith(`/${c}`)) ?? null;
}

interface CityHeaderProps {
  allCityNavs: Record<string, CityNavConfig>;
}

function TvIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={className} fill="none">
      <path d="M22 10 10 2m32 8L54 2" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" />
      <rect x="10" y="14" width="44" height="34" rx="5" stroke="currentColor" strokeWidth="4.5" />
      <path d="M23 56h18M27 48v8m10-8v8" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" />
      <circle cx="24" cy="29" r="3.5" fill="currentColor" />
      <circle cx="40" cy="29" r="3.5" fill="currentColor" />
      <path d="M23 37c2.5 2.5 5.5 3.5 9 3.5s6.5-1 9-3.5" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" />
    </svg>
  );
}

export default function CityHeader({ allCityNavs }: CityHeaderProps) {
  const pathname = usePathname();
  const cityKeys = Object.keys(allCityNavs);
  const cityKey = detectCity(pathname, cityKeys);
  const city = cityKey ? allCityNavs[cityKey] : null;
  const globalNavItems: NavItem[] = [
    { href: "/search", label: "検索" },
    { href: "/#municipalities", label: "市町村一覧" },
    { href: "/articles", label: "読みもの" },
    { href: "/sources", label: "出典・このサイトについて" },
  ];

  function renderNavLink(item: NavItem) {
    const isAnchor = item.href.includes("#");
    const isActive = !isAnchor && (pathname === item.href || pathname.startsWith(item.href + "/"));
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={isActive ? "page" : undefined}
        className={`inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-full border px-4 py-2 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298] ${
          isActive
            ? "border-[#1B3A6B] bg-[#E8EEF7] text-[#1B3A6B]"
            : "border-[#D7DEE8] bg-white text-[#475569] hover:border-[#1B3A6B] hover:bg-[#F8FAFC] hover:text-[#1B3A6B]"
        }`}
      >
        {item.label}
      </Link>
    );
  }

  return (
    <header
      data-no-print="true"
      className="border-b border-[#D7DEE8] bg-white"
    >
      <div className="page-shell min-w-0 px-4 py-4">
        <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/"
                className="inline-flex min-h-11 items-center gap-3 rounded-lg border border-[#CBD5E0] bg-white px-3 py-2 text-[#111827] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298] sm:px-4"
              >
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-[#1B3A6B] text-white">
                  <TvIcon className="h-5 w-5" />
                </span>
                <span className="text-lg font-black leading-tight tracking-tight sm:text-xl">
                  {city ? city.name : "地方議会ドットコム"}
                </span>
              </Link>
            </div>

            {!city && (
              <p className="max-w-3xl text-sm font-semibold text-[#4A5568]">
                北海道内の市町村議会の情報を横断的に検索・閲覧できます
              </p>
            )}
          </div>

          <nav className="flex flex-wrap gap-2" aria-label="グローバルナビゲーション">
            {globalNavItems.map(renderNavLink)}
          </nav>
        </div>

        {city && city.nav.length > 0 && (
          <div className="mobile-nav-fade mt-3 border-t border-[#E2E8F0] pt-3">
            <nav className="flex gap-2 overflow-x-auto pb-1 pr-8 md:flex-wrap md:overflow-visible md:pb-0 md:pr-0" aria-label={`${city.name}内ナビゲーション`}>
              {city.nav.map(renderNavLink)}
            </nav>
          </div>
        )}
      </div>
    </header>
  );
}
