import fs from "fs";
import path from "path";
import Link from "next/link";
import { getMunicipalities } from "@/lib/municipalities";
import { getNews, categoryClass } from "@/lib/news";
import { getSiteStats } from "@/lib/siteStats";
import type { Member } from "@/types/member";
import type { Decision } from "@/types/decision";

function getMemberCount(cityId: string): number {
  try {
    const fp = path.join(process.cwd(), "data", cityId, "members.json");
    const members = JSON.parse(fs.readFileSync(fp, "utf-8")) as Member[];
    return members.length;
  } catch {
    try {
      const fp = path.join(process.cwd(), "data", cityId, "election.json");
      const data = JSON.parse(fs.readFileSync(fp, "utf-8"));
      return (data.candidates ?? []).filter((c: { result: string }) => c.result === "当選").length;
    } catch {
      return 0;
    }
  }
}

function getLatestSession(cityId: string): string {
  try {
    const fp = path.join(process.cwd(), "data", cityId, "decisions.json");
    const decisions = JSON.parse(fs.readFileSync(fp, "utf-8")) as Decision[];
    return decisions[0]?.session ?? "";
  } catch {
    return "";
  }
}

function getDecisionCount(cityId: string): number {
  try {
    const fp = path.join(process.cwd(), "data", cityId, "decisions.json");
    const decisions = JSON.parse(fs.readFileSync(fp, "utf-8")) as Decision[];
    return decisions.length;
  } catch {
    return 0;
  }
}

function getMinutesCount(cityId: string): number {
  try {
    const dir = path.join(process.cwd(), "data", cityId, "minutes");
    const files = fs.readdirSync(dir);
    return files.filter((f) => f.endsWith(".json")).length;
  } catch {
    return 0;
  }
}


export default function HomePage() {
  const allMunis = getMunicipalities().filter((m) => m.active);
  const prefecture = allMunis.find((m) => m.level === "prefecture");
  const municipalities = allMunis.filter((m) => m.level === "municipality");
  const latestNews = getNews().slice(0, 3);
  const stats = getSiteStats();
  const cities = municipalities.map((m) => ({
    id: m.slug,
    name: m.council_name,
    furigana: m.furigana,
    href: `/${m.slug}`,
    region: m.region,
    hasMinutes: m.features.includes("minutes"),
    hasSession: m.features.includes("sessions"),
    memberCount: getMemberCount(m.slug),
    latestSession: getLatestSession(m.slug),
    decisionCount: getDecisionCount(m.slug),
    minutesCount: getMinutesCount(m.slug),
    minutesUnavailable: m.minutes_status === "unavailable",
  }));


  return (
    <div className="max-w-2xl mx-auto relative">
      {/* 背景の薄いグラデーション装飾（入口感） */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-8 h-56 -z-10 rounded-b-3xl"
        style={{
          background:
            "radial-gradient(ellipse at 20% 0%, rgba(232,238,247,0.9) 0%, rgba(255,255,255,0) 60%), radial-gradient(ellipse at 85% 10%, rgba(254,243,199,0.55) 0%, rgba(255,255,255,0) 55%)",
        }}
      />

      {/* ヒーローセクション */}
      <section className="mb-6">
        <p className="text-xs font-semibold text-[#2A5298] tracking-wider mb-2">
          LOCAL COUNCIL INFO · 地方議会ドットコム
        </p>
        <h2 className="text-2xl sm:text-3xl font-bold text-[#1B3A6B] leading-tight mb-3">
          地方議会の「なか」を、<br className="sm:hidden" />わかりやすく。
        </h2>
        <p className="text-base text-[#4A5568] leading-relaxed">
          まずは北海道から。市町村議会の議員・議事録・議決を横断的にまとめて、
          <br className="hidden sm:block" />
          どんな議論が行われているか、だれでもかんたんに追えるようにしています。
        </p>
      </section>

      {/* サイト規模ダッシュボード */}
      <section className="mb-8 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {[
          {
            label: "対象自治体",
            value: stats.municipalityCount,
            unit: "",
            accent: "bg-[#E8EEF7] text-[#1B3A6B]",
            icon: (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 21h18" />
                <path d="M5 21V7l7-4 7 4v14" />
                <path d="M9 9h1M9 12h1M9 15h1M14 9h1M14 12h1M14 15h1" />
              </svg>
            ),
          },
          {
            label: "議員",
            value: stats.memberCount,
            unit: "名",
            accent: "bg-[#FEF3C7] text-[#78451F]",
            icon: (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            ),
          },
          {
            label: "会議録",
            value: stats.minutesCount,
            unit: "件",
            accent: "bg-[#D1FAE5] text-[#065F46]",
            icon: (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
            ),
          },
          {
            label: "議題",
            value: stats.agendaCount,
            unit: "件",
            accent: "bg-[#E0F2FE] text-[#075985]",
            icon: (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M7 8h10M7 12h10M7 16h7" />
                <rect x="3" y="4" width="18" height="16" rx="2" />
              </svg>
            ),
          },
        ].map((card) => (
          <div
            key={card.label}
            className="bg-white rounded-xl border border-[#E2E8F0] px-3 py-3 sm:px-4 sm:py-4 flex items-center gap-3 shadow-sm"
          >
            <div className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${card.accent}`}>
              <span className="w-4 h-4 block">{card.icon}</span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] text-[#718096] leading-tight mb-0.5">{card.label}</p>
              <p className="text-xl sm:text-2xl font-bold text-[#1A202C] leading-none tabular-nums">
                {card.value.toLocaleString()}
                {card.unit && <span className="text-xs font-normal text-[#718096] ml-0.5">{card.unit}</span>}
              </p>
            </div>
          </div>
        ))}
      </section>

      {/* 最新のお知らせ */}
      {latestNews.length > 0 && (
        <section className="mb-6 bg-[#F4F6F9] rounded-lg border border-[#E2E8F0] px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-[#718096] uppercase tracking-wider">お知らせ</h3>
            <Link
              href="/news"
              className="text-xs text-[#2A5298] hover:text-[#1B3A6B] transition-colors"
            >
              すべて見る ›
            </Link>
          </div>
          <ul className="space-y-1.5">
            {latestNews.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="text-xs text-[#718096] shrink-0 mt-1 tabular-nums">
                  {item.date.slice(5).replace("-", "/")}
                </span>
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 mt-0.5 ${categoryClass(item.category)}`}>
                  {item.category}
                </span>
                <Link
                  href="/news"
                  className="text-sm text-[#1A202C] hover:text-[#1B3A6B] transition-colors line-clamp-1"
                >
                  {item.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 北海道議会 */}
      {prefecture && (
        <section className="mb-6">
          <Link
            href={`/${prefecture.slug}`}
            className="group block bg-white rounded-lg border-2 border-[#1B3A6B] hover:bg-[#E8EEF7] px-4 py-4 shadow-sm hover:shadow-md transition-all duration-150"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-base font-bold text-[#1B3A6B] mb-0.5">{prefecture.council_name}</p>
                <div className="flex flex-wrap gap-x-3 text-xs text-[#718096]">
                  {getMemberCount(prefecture.slug) > 0 && <span>{getMemberCount(prefecture.slug)}名</span>}
                  {!prefecture.features.includes("members") && <span>準備中</span>}
                </div>
              </div>
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-[#CBD5E0] group-hover:text-[#1B3A6B] shrink-0 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
            </div>
          </Link>
        </section>
      )}

      {/* 市町村議会を選ぶ（地域別） */}
      <section className="mb-8">
        <h3 className="text-sm font-semibold text-[#718096] uppercase tracking-wider mb-3">市町村議会を選ぶ</h3>
        {(() => {
          const regionOrder = ["石狩", "空知", "後志", "胆振", "日高", "渡島", "檜山", "上川", "留萌", "宗谷", "オホーツク", "十勝", "釧路", "根室"];
          const grouped = new Map<string, typeof cities>();
          for (const city of cities) {
            const list = grouped.get(city.region) ?? [];
            list.push(city);
            grouped.set(city.region, list);
          }
          return regionOrder
            .filter((r) => grouped.has(r))
            .map((region) => (
              <div key={region} className="mb-4">
                <h4 className="text-xs font-bold text-[#2A5298] bg-[#E8EEF7] rounded px-3 py-1.5 mb-2">
                  {region}
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {grouped.get(region)!.map((city) => {
                    const featured = city.id === "chitose";
                    return (
                    <Link
                      key={city.id}
                      href={city.href}
                      className={`group rounded-lg px-3 py-3 shadow-sm hover:shadow-md transition-all duration-150 ${
                        featured
                          ? "bg-[#1B3A6B] border-2 border-[#1B3A6B] hover:bg-[#2A5298] col-span-2 sm:col-span-1"
                          : "bg-white border border-[#CBD5E0] hover:border-[#1B3A6B]"
                      }`}
                    >
                      <p className={`text-sm font-bold leading-snug mb-1 ${
                        featured ? "text-white" : "text-[#1A202C] group-hover:text-[#1B3A6B]"
                      }`}>
                        {city.name.replace("議会", "")}
                        {featured && <span className="ml-1.5 text-[10px] font-normal bg-white/20 text-white/90 rounded px-1.5 py-0.5">議事録・速報・議決</span>}
                      </p>
                      <div className={`flex flex-wrap gap-x-3 gap-y-0.5 text-xs ${featured ? "text-white/70" : "text-[#718096]"}`}>
                        {city.memberCount > 0 && <span>{city.memberCount}名</span>}
                        {city.minutesCount > 0 && <span>議事録{city.minutesCount}件</span>}
                        {city.minutesUnavailable && (
                          <span className={featured ? "text-white/80" : "text-[#A0AEC0]"}>議事録未公開</span>
                        )}
                        {city.hasSession && <span className={featured ? "text-white/90" : "text-[#2A5298]"}>速報</span>}
                      </div>
                    </Link>
                    );
                  })}
                </div>
              </div>
            ));
        })()}
      </section>

      {/* クイックアクセス */}
      <section className="mb-8">
        <h3 className="text-sm font-semibold text-[#718096] uppercase tracking-wider mb-3">クイックアクセス</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Link
            href="/chitose/minutes"
            className="group flex items-center gap-3 bg-white rounded-lg border border-[#CBD5E0] hover:border-[#1B3A6B] px-4 py-3.5 shadow-sm hover:shadow-md transition-all duration-150"
          >
            <div className="w-9 h-9 rounded-lg bg-[#E8EEF7] flex items-center justify-center shrink-0 group-hover:bg-[#1B3A6B] transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-[#1B3A6B] group-hover:text-white transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[#1A202C]">公式議事録</p>
              <p className="text-xs text-[#4A5568]">千歳市 令和6〜7年</p>
            </div>
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-[#CBD5E0] group-hover:text-[#1B3A6B] shrink-0 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
          </Link>

          <Link
            href="/chitose/sessions"
            className="group flex items-center gap-3 bg-white rounded-lg border border-[#CBD5E0] hover:border-[#1B3A6B] px-4 py-3.5 shadow-sm hover:shadow-md transition-all duration-150"
          >
            <div className="w-9 h-9 rounded-lg bg-[#E8EEF7] flex items-center justify-center shrink-0 group-hover:bg-[#1B3A6B] transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-[#1B3A6B] group-hover:text-white transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polygon points="23 7 16 12 23 17 23 7"/>
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[#1A202C]">会議録・速報</p>
              <p className="text-xs text-[#4A5568]">YouTube文字起こし・要約</p>
            </div>
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-[#CBD5E0] group-hover:text-[#1B3A6B] shrink-0 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
          </Link>

          <Link
            href="/eniwa/minutes"
            className="group flex items-center gap-3 bg-white rounded-lg border border-[#CBD5E0] hover:border-[#1B3A6B] px-4 py-3.5 shadow-sm hover:shadow-md transition-all duration-150"
          >
            <div className="w-9 h-9 rounded-lg bg-[#E8EEF7] flex items-center justify-center shrink-0 group-hover:bg-[#1B3A6B] transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-[#1B3A6B] group-hover:text-white transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[#1A202C]">公式議事録</p>
              <p className="text-xs text-[#4A5568]">恵庭市 令和6〜7年</p>
            </div>
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-[#CBD5E0] group-hover:text-[#1B3A6B] shrink-0 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
          </Link>

          <Link
            href="/tomakomai/minutes"
            className="group flex items-center gap-3 bg-white rounded-lg border border-[#CBD5E0] hover:border-[#1B3A6B] px-4 py-3.5 shadow-sm hover:shadow-md transition-all duration-150"
          >
            <div className="w-9 h-9 rounded-lg bg-[#E8EEF7] flex items-center justify-center shrink-0 group-hover:bg-[#1B3A6B] transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-[#1B3A6B] group-hover:text-white transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[#1A202C]">公式議事録</p>
              <p className="text-xs text-[#4A5568]">苫小牧市 令和6〜7年</p>
            </div>
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-[#CBD5E0] group-hover:text-[#1B3A6B] shrink-0 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
          </Link>

          <Link
            href="/search"
            className="group flex items-center gap-3 bg-white rounded-lg border border-[#CBD5E0] hover:border-[#1B3A6B] px-4 py-3.5 shadow-sm hover:shadow-md transition-all duration-150"
          >
            <div className="w-9 h-9 rounded-lg bg-[#E8EEF7] flex items-center justify-center shrink-0 group-hover:bg-[#1B3A6B] transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-[#1B3A6B] group-hover:text-white transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[#1A202C]">議事録検索</p>
              <p className="text-xs text-[#4A5568]">キーワードで議会記録・議員を横断検索</p>
            </div>
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-[#CBD5E0] group-hover:text-[#1B3A6B] shrink-0 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
          </Link>
        </div>
      </section>

      {/* このサイトについて */}
      <section className="bg-[#E8EEF7] rounded-lg p-5">
        <h2 className="text-base font-bold text-[#1B3A6B] mb-2">このサイトについて</h2>
        <p className="text-sm text-[#4A5568] leading-relaxed">
          地方議会ドットコムは、北海道内の市議会情報を横断的に収集・整理する
          非公式の情報サイトです。令和6〜7年の会議録・議決結果を収録しています。
          公式情報は各市議会の公式サイトでご確認ください。
        </p>
      </section>
    </div>
  );
}
