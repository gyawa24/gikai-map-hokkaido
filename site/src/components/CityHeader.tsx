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

function NiconicoTvIcon({ className = "h-5 w-5" }: { className?: string }) {
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
  const city = cityKey ? (allCityNavs[cityKey] ?? null) : null;
  const cityCount = cityKeys.length;
  const navItems = city
    ? city.nav
    : [
        { href: "/", label: "トップ" },
        { href: "/search", label: "横断検索" },
        { href: "/news", label: "更新情報" },
        { href: "/schedule", label: "行事予定" },
        { href: "/decisions", label: "議決一覧" },
        { href: "/topics", label: "テーマ別" },
      ];
  const tickerItems = city
    ? [
        `${city.name}の議員・議事録・議決をまとめて表示`,
        "横断検索からキーワードでも追えます",
        "更新情報とあわせて議会の動きを確認できます",
      ]
    : [
        `北海道 ${cityCount} 自治体を収録`,
        "議員・議事録・議決を横断検索",
        "ニュース・行事予定・テーマ別導線を集約",
      ];

  function renderNavLink(item: NavItem) {
    const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
    return (
      <Link
        key={item.href}
        href={item.href}
        className={`portal-tab px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFD54F] ${
          isActive ? "portal-tab-active" : ""
        }`}
        aria-current={isActive ? "page" : undefined}
      >
        {item.label}
      </Link>
    );
  }

  return (
    <header
      data-no-print="true"
      className="relative overflow-hidden border-b border-[#d3dae5] bg-[linear-gradient(180deg,#fffdf6_0%,#f6f8fb_100%)] text-[#111111]"
    >
      <div className="h-1.5 bg-[linear-gradient(90deg,#1B3A6B_0%,#2A5298_42%,#FFD54F_100%)]" />

      <div className="border-b border-[#dde3eb] bg-[#0f2548] text-white">
        <div className="page-shell flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-[11px] font-bold tracking-[0.08em] sm:text-xs">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="rounded-full border border-white/20 bg-white/10 px-2.5 py-1">PUBLIC INFO PORTAL</span>
            <span>議会の入口を、もっと見やすく。</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[#dbe7ff]">
            <Link href="/search" className="hover:text-white">横断検索</Link>
            <Link href="/news" className="hover:text-white">更新情報</Link>
            <span>ドメイン: chihougikai.com</span>
          </div>
        </div>
      </div>

      <div className="page-shell relative px-4 py-4 sm:py-5">
        <div className="portal-chrome px-4 py-4 sm:px-6 sm:py-5">
          <div className="relative z-10 flex flex-col gap-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="portal-subhead">議会ポータル</span>
                  <span className="theme-pill-soft border-[#ecd48b] bg-[#fff6cf] text-[#6b4c11]">BETA</span>
                  <span className="theme-pill-soft text-[#1b3a6b]">北海道 {cityCount} 自治体</span>
                  {city && <span className="theme-pill-soft bg-[#edf4ff] text-[#1b3a6b]">{city.name}</span>}
                </div>

                <div className="portal-title-box px-4 py-4 sm:px-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <Link
                        href="/"
                        className="group inline-flex items-center gap-3 text-[#111111] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFD54F]"
                      >
                        <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[#111827] text-white shadow-[0_8px_18px_rgba(15,37,72,0.18)] transition-transform group-hover:scale-105">
                          <NiconicoTvIcon className="h-6 w-6" />
                        </span>
                        <span className="block">
                          <span className="block text-[1.7rem] font-black leading-none tracking-tight sm:text-[2.2rem]">
                            {city ? city.name : "地方議会ドットコム"}
                          </span>
                          <span className="mt-1 block text-sm font-bold text-[#516072] sm:text-[15px]">
                            {city
                              ? "地域の議会情報をまとめて追える公共ポータル"
                              : "議会の情報がにぎやかに見つかる公共情報ポータル"}
                          </span>
                        </span>
                      </Link>
                    </div>

                    <div className="grid grid-cols-2 gap-2 sm:w-auto sm:min-w-[19rem]">
                      <Link href="/search" className="theme-card-soft px-3 py-2.5 text-left transition-transform hover:-translate-y-0.5">
                        <p className="text-[11px] font-black uppercase tracking-[0.12em] text-[#667085]">Search</p>
                        <p className="text-sm font-black text-[#1b3a6b]">議題・議員を探す</p>
                      </Link>
                      <Link href="/topics" className="theme-card-soft px-3 py-2.5 text-left transition-transform hover:-translate-y-0.5">
                        <p className="text-[11px] font-black uppercase tracking-[0.12em] text-[#667085]">Topics</p>
                        <p className="text-sm font-black text-[#1b3a6b]">テーマで追う</p>
                      </Link>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-3 lg:w-[25rem] lg:grid-cols-1">
                <div className="portal-rail-card px-3 py-3">
                  <p className="mb-1 text-[11px] font-black uppercase tracking-[0.12em] text-[#6b4c11]">注目導線</p>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { href: "/search?q=子育て支援", label: "子育て支援" },
                      { href: "/search?q=除雪", label: "除雪" },
                      { href: "/search?q=議員", label: "議員検索" },
                    ].map((item) => (
                      <Link key={item.href} href={item.href} className="theme-pill-soft bg-[#fffaf0] text-[#6b4c11] hover:border-[#e6c566]">
                        {item.label}
                      </Link>
                    ))}
                  </div>
                </div>
                <div className="portal-rail-card px-3 py-3">
                  <p className="mb-1 text-[11px] font-black uppercase tracking-[0.12em] text-[#1b3a6b]">収録情報</p>
                  <p className="text-sm font-bold text-[#475569]">
                    {city
                      ? "議員一覧、議事録、議決結果、関連ページを上部タブから移動できます。"
                      : "トップから地域別一覧、横断検索、更新情報へ素早く移動できます。"}
                  </p>
                </div>
              </div>
            </div>

            <div className="portal-band overflow-hidden">
              <span className="portal-band-label">{city ? "CITY GUIDE" : "PICK UP"}</span>
              <div className="portal-marquee min-w-0 flex-1 px-3 py-2 text-sm font-bold text-[#334155]">
                <div className="portal-marquee-track">
                  {tickerItems.map((item) => (
                    <span key={item} className="inline-flex items-center gap-3">
                      <span>{item}</span>
                      <span className="text-[#94a3b8]">●</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="mobile-nav-fade">
              <nav className="flex gap-2 overflow-x-auto pb-1 pr-8 sm:flex-wrap sm:overflow-visible sm:pb-0 sm:pr-0" aria-label="グローバルナビゲーション">
                {navItems.map(renderNavLink)}
              </nav>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
