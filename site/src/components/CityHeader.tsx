"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import LogoIcon from "./LogoIcon";
import type { CityNavConfig } from "./CityHeaderServer";

type NavItem = { href: string; label: string };

function detectCity(pathname: string, cityKeys: string[]): string | null {
  return cityKeys.find((c) => pathname.startsWith(`/${c}`)) ?? null;
}

interface CityHeaderProps {
  allCityNavs: Record<string, CityNavConfig>;
}

export default function CityHeader({ allCityNavs }: CityHeaderProps) {
  const pathname = usePathname();
  const cityKeys = Object.keys(allCityNavs);
  const cityKey = detectCity(pathname, cityKeys);
  const city = cityKey ? allCityNavs[cityKey] : null;
  const globalNavItems: NavItem[] = [
    { href: "/search", label: "検索" },
    { href: "/#municipalities", label: "市町村" },
    { href: "/articles", label: "読みもの" },
    { href: "/sources", label: "出典" },
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
          <Link
            href="/"
            aria-label="地方議会ドットコム（γ） トップページへ"
            className="inline-flex min-h-11 min-w-0 self-start items-center gap-3 px-1 py-1 text-[#111827] focus-visible:rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298]"
          >
            <span className="site-brand-icon">
              <LogoIcon decorative className="h-5 w-5" />
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block text-[1.05rem] font-black tracking-normal text-[#111827] sm:text-xl">
                地方議会ドットコム（γ）
              </span>
              <span className="site-brand-subcopy">
                CHIHOU GIKAI DOTTOKOMU
              </span>
            </span>
          </Link>

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
