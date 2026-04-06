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
      { href: "/schedule", label: "行事予定" },
      { href: "/newsletter", label: "議会だより" },
      { href: "/ai-search", label: "✦ AI検索" },
    ],
  },
  eniwa: {
    name: "恵庭市議会",
    baseHref: "/eniwa",
    nav: [
      { href: "/eniwa", label: "議員一覧" },
      { href: "/eniwa/decisions", label: "議決結果" },
      { href: "/ai-search", label: "✦ AI検索" },
    ],
  },
  tomakomai: {
    name: "苫小牧市議会",
    baseHref: "/tomakomai",
    nav: [
      { href: "/tomakomai", label: "議員一覧" },
      { href: "/tomakomai/decisions", label: "議決結果" },
      { href: "/ai-search", label: "✦ AI検索" },
    ],
  },
};

function detectCity(pathname: string): string | null {
  if (pathname.startsWith("/eniwa")) return "eniwa";
  if (pathname.startsWith("/tomakomai")) return "tomakomai";
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
    <header className="bg-[#1a3a6c] text-white">
      <div className="max-w-5xl mx-auto px-4 pt-5 pb-3">
        <div className="flex items-center gap-3 mb-1">
          <Link
            href="/"
            className="text-xs text-blue-200 hover:text-white transition-colors"
          >
            北海道議会情報マップ
          </Link>
          {city && (
            <>
              <span className="text-blue-400 text-xs">›</span>
              <span className="text-xs text-blue-200">{city.name}</span>
            </>
          )}
        </div>
        <h1 className="text-xl font-bold tracking-tight">
          {city ? city.name : "北海道議会情報マップ"}
        </h1>
        {city && (
          <nav className="flex flex-wrap gap-1 mt-3">
            {city.nav.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`text-sm px-3 py-1 rounded-md transition-colors ${
                    isActive
                      ? "bg-white/20 text-white font-semibold"
                      : "text-blue-100 hover:bg-white/10 hover:text-white"
                  }`}
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
