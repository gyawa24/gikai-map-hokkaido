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

  const navItems = city
    ? city.nav
    : [
        { href: "/", label: "トップ" },
        { href: "/search", label: "検索" },
      ];

  const mobileQuickLinks = city
    ? []
    : [
        { href: "/search", label: "検索する" },
        { href: "/#municipalities", label: "市町村一覧" },
      ];

  function renderNavLink(item: NavItem) {
    const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={isActive ? "page" : undefined}
        className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border-2 px-4 py-2 text-sm font-black transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFD54F] ${
          isActive
            ? "border-[#9FB1D2] bg-[#FFF3BF] text-[#1B3A6B]"
            : "border-[#D7DEE8] bg-white text-[#475569] hover:border-[#BFC9D9] hover:text-[#1B3A6B]"
        }`}
      >
        {item.label}
      </Link>
    );
  }

  return (
    <header
      data-no-print="true"
      className="relative overflow-hidden border-b border-[#d7dee8] bg-[linear-gradient(180deg,#fffdf9_0%,#f8fafc_100%)]"
      style={{
        backgroundImage:
          "radial-gradient(circle at 1px 1px, rgba(27,58,107,0.12) 1px, transparent 0), linear-gradient(180deg, #fffdf9 0%, #f8fafc 100%)",
        backgroundSize: "18px 18px, 100% 100%",
      }}
    >
      <div className="page-shell min-w-0 px-4 py-4 sm:py-5">
        <div className="mb-4 flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/"
                className="inline-flex items-center gap-3 rounded-[28px] border-[4px] border-[#1F2937] bg-white px-4 py-3 text-[#111827] shadow-[0_12px_22px_rgba(27,58,107,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFD54F] sm:px-5 sm:py-4"
              >
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-[#1F2937] text-white sm:h-12 sm:w-12">
                  <TvIcon className="h-6 w-6 sm:h-7 sm:w-7" />
                </span>
                <span className="text-[1.2rem] font-black leading-none tracking-tight sm:text-[2rem]">
                  {city ? city.name : "地方議会ドットコム"}
                </span>
              </Link>
              <span className="inline-flex items-center rounded-2xl border-2 border-[#E6C566] bg-[#FFF3BF] px-3 py-2 text-base font-medium text-[#6B4C11]">
                β
              </span>
            </div>

            {!city && (
              <p className="max-w-3xl text-sm font-bold text-[#6B4C11] sm:text-[15px]">
                北海道内の市町村議会の情報を横断的に検索・閲覧できます
              </p>
            )}

            {!city && mobileQuickLinks.length > 0 && (
              <div className="flex gap-2 sm:hidden">
                {mobileQuickLinks.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`inline-flex flex-1 items-center justify-center rounded-full border-2 px-4 py-3 text-sm font-black ${
                      item.label === "検索する"
                        ? "border-[#E6C566] bg-[#FFF3BF] text-[#6B4C11]"
                        : "border-[#D7DEE8] bg-white text-[#475569]"
                    }`}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            )}
          </div>

          {!city && (
            <nav className="hidden flex-wrap justify-start gap-2 xl:flex xl:justify-end" aria-label="上部ナビゲーション">
              {[
                { href: "/search?q=議員", label: "議員" },
                { href: "/search?q=議事録", label: "議事録" },
                { href: "/search", label: "検索" },
              ].map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="inline-flex items-center rounded-full border-2 border-[#D7DEE8] bg-white px-4 py-2 text-sm font-black text-[#475569] hover:border-[#BFC9D9] hover:text-[#1B3A6B]"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          )}
        </div>

        <div className="mobile-nav-fade">
          <nav className="flex gap-2 overflow-x-auto pb-1 pr-8 md:flex-wrap md:overflow-visible md:pb-0 md:pr-0" aria-label="メインナビゲーション">
            {navItems.map(renderNavLink)}
          </nav>
        </div>
      </div>
    </header>
  );
}
