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

type CitySummary = {
  id: string;
  name: string;
  furigana: string;
  href: string;
  region: string;
  hasMinutes: boolean;
  hasSession: boolean;
  memberCount: number;
  latestSession: string;
  decisionCount: number;
  minutesCount: number;
  minutesUnavailable: boolean;
};

function sectionTag(label: string) {
  return <span className="portal-subhead">{label}</span>;
}

export default function HomePage() {
  const allMunis = getMunicipalities().filter((m) => m.active);
  const prefecture = allMunis.find((m) => m.level === "prefecture");
  const municipalities = allMunis.filter((m) => m.level === "municipality");
  const latestNews = getNews().slice(0, 5);
  const stats = getSiteStats();
  const regionOrder = ["石狩", "空知", "後志", "胆振", "日高", "渡島", "檜山", "上川", "留萌", "宗谷", "オホーツク", "十勝", "釧路", "根室"];
  const cities: CitySummary[] = municipalities.map((m) => ({
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

  const grouped = new Map<string, CitySummary[]>();
  for (const city of cities) {
    const list = grouped.get(city.region) ?? [];
    list.push(city);
    grouped.set(city.region, list);
  }

  const groupedRegions = regionOrder
    .filter((region) => grouped.has(region))
    .map((region) => ({
      region,
      cities: [...(grouped.get(region) ?? [])].sort((a, b) => {
        const aFeatured = a.id === "chitose" ? 1 : 0;
        const bFeatured = b.id === "chitose" ? 1 : 0;
        if (aFeatured !== bFeatured) return bFeatured - aFeatured;
        return a.furigana.localeCompare(b.furigana, "ja");
      }),
    }));

  const featuredCities = [...cities]
    .sort((a, b) => {
      const aScore = (a.hasSession ? 10000 : 0) + a.minutesCount * 3 + a.memberCount;
      const bScore = (b.hasSession ? 10000 : 0) + b.minutesCount * 3 + b.memberCount;
      return bScore - aScore;
    })
    .slice(0, 6);

  const minutesRanking = [...cities]
    .filter((city) => city.minutesCount > 0)
    .sort((a, b) => b.minutesCount - a.minutesCount)
    .slice(0, 5);

  const memberRanking = [...cities]
    .filter((city) => city.memberCount > 0)
    .sort((a, b) => b.memberCount - a.memberCount)
    .slice(0, 5);

  const quickLinks = [
    { href: "/search", title: "横断検索", body: "議題名・政策テーマ・議員名から探す", accent: "bg-[#eef4ff] text-[#1b3a6b]" },
    { href: "/topics", title: "テーマ別", body: "教育、福祉、防災など関心軸で入る", accent: "bg-[#fff6cf] text-[#6b4c11]" },
    { href: "/news", title: "更新情報", body: "追加自治体や機能改善を追う", accent: "bg-[#f0fff4] text-[#276749]" },
    { href: "/schedule", title: "行事予定", body: "公開されている議会日程を確認", accent: "bg-[#f3f4f6] text-[#334155]" },
  ];

  const searchSuggestions = [
    { href: "/search?q=子育て支援", label: "子育て支援" },
    { href: "/search?q=除雪", label: "除雪" },
    { href: "/search?q=議員", label: "議員名" },
    { href: "/search?q=学校給食", label: "学校給食" },
    { href: "/search?q=ラピダス", label: "ラピダス" },
  ];

  const guideCards = [
    {
      title: "まずは市町村を開く",
      body: "地域ごとに自治体を並べ、議員数や議事録件数を見ながら入口を選べます。",
      href: "#municipalities",
      label: "地域別一覧へ",
    },
    {
      title: "気になる語で横断検索",
      body: "子育て、防災、除雪、学校給食などの語で、複数自治体の議事録を一気に追えます。",
      href: "/search",
      label: "検索ページへ",
    },
    {
      title: "更新から追いかける",
      body: "ベータ版の改善や自治体追加をまとめた更新情報から、新しく見られる範囲を確認できます。",
      href: "/news",
      label: "お知らせを見る",
    },
  ];

  return (
    <div className="page-shell space-y-6">
      <section className="portal-section portal-grid-pattern overflow-hidden px-4 py-4 sm:px-6 sm:py-6">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(22rem,0.95fr)]">
          <div className="space-y-4">
            <div className="portal-band overflow-hidden">
              <span className="portal-band-label">NOW PLAYING</span>
              <div className="portal-marquee min-w-0 flex-1 px-3 py-2 text-sm font-bold text-[#334155]">
                <div className="portal-marquee-track">
                  <span>北海道の地方議会を、賑やかに一覧できる公共情報ポータル</span>
                  <span className="text-[#94a3b8]">●</span>
                  <span>議員・議事録・議決・更新情報をひとつの導線に集約</span>
                  <span className="text-[#94a3b8]">●</span>
                  <span>まずは北海道から。今後も自治体と機能を拡張予定</span>
                </div>
              </div>
            </div>

            <div className="portal-title-box px-4 py-5 sm:px-6 sm:py-6">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                {sectionTag("TOP PORTAL")}
                <span className="theme-pill-soft border-[#ecd48b] bg-[#fff6cf] text-[#6b4c11]">公共情報ポータル再解釈</span>
              </div>
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(15rem,0.75fr)]">
                <div>
                  <h1 className="text-[2rem] font-black leading-[1.08] tracking-tight text-[#111827] sm:text-[3.35rem]">
                    地方議会を、
                    <span className="block text-[#1b3a6b]">にぎやかに、でも読みやすく。</span>
                  </h1>
                  <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-[#475569] sm:text-lg">
                    議会の情報は散らばりやすく、見に行くきっかけも作りにくい。
                    地方議会ドットコムは、横断検索、地域別一覧、更新情報、テーマ別導線を
                    ひとつのトップに束ねて、まず入りやすい公共情報ポータルとして整えています。
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link href="/search" className="theme-button theme-button-accent px-4 py-2 text-sm">
                      横断検索を開く
                    </Link>
                    <a href="#municipalities" className="theme-button px-4 py-2 text-sm">
                      市町村一覧を見る
                    </a>
                    <Link href="/topics" className="theme-button px-4 py-2 text-sm">
                      テーマ別に入る
                    </Link>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {searchSuggestions.map((item) => (
                      <Link key={item.href} href={item.href} className="theme-pill-soft bg-white text-[#1b3a6b] hover:border-[#9fb1d2]">
                        {item.label}
                      </Link>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="portal-rail-card p-4">
                    <p className="mb-2 text-xs font-black uppercase tracking-[0.12em] text-[#6b4c11]">ポータルの見どころ</p>
                    <ul className="space-y-2 text-sm font-bold text-[#334155]">
                      <li>地域別一覧から自治体を選べる</li>
                      <li>議題・政策テーマ・議員名で検索できる</li>
                      <li>更新情報やお知らせも同じ画面で追える</li>
                    </ul>
                  </div>
                  <div className="portal-rail-card p-4">
                    <p className="mb-2 text-xs font-black uppercase tracking-[0.12em] text-[#1b3a6b]">速報帯</p>
                    <div className="space-y-2 text-sm text-[#475569]">
                      <p>対象自治体: <span className="font-black text-[#111827]">{stats.municipalityCount.toLocaleString()}</span></p>
                      <p>収録議員: <span className="font-black text-[#111827]">{stats.memberCount.toLocaleString()}名</span></p>
                      <p>議題数: <span className="font-black text-[#111827]">{stats.agendaCount.toLocaleString()}件</span></p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="portal-stat-grid">
              {[
                { label: "対象自治体", value: stats.municipalityCount.toLocaleString(), note: "北海道内で公開中" },
                { label: "議員", value: `${stats.memberCount.toLocaleString()}名`, note: "議員一覧・選挙結果を集約" },
                { label: "会議録", value: `${stats.minutesCount.toLocaleString()}件`, note: "議事録・速報の入口" },
                { label: "議題", value: `${stats.agendaCount.toLocaleString()}件`, note: "横断検索の対象件数" },
              ].map((item) => (
                <div key={item.label} className="portal-stat-box px-4 py-3">
                  <p className="text-[11px] font-black uppercase tracking-[0.12em] text-[#667085]">{item.label}</p>
                  <p className="mt-1 text-[1.7rem] font-black leading-none text-[#111827] sm:text-[2rem]">{item.value}</p>
                  <p className="mt-1 text-xs font-semibold text-[#64748b]">{item.note}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div className="portal-section px-4 py-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="portal-section-heading text-lg">ポータル導線</h2>
                <span className="theme-pill-soft text-[#6b4c11]">入口を増やす</span>
              </div>
              <div className="grid gap-2">
                {quickLinks.map((item) => (
                  <Link key={item.href} href={item.href} className="portal-rank-item px-4 py-3">
                    <span className={`inline-flex h-10 w-10 items-center justify-center rounded-2xl text-xs font-black ${item.accent}`}>GO</span>
                    <span className="min-w-0">
                      <span className="block text-sm font-black text-[#111827]">{item.title}</span>
                      <span className="block text-xs text-[#64748b]">{item.body}</span>
                    </span>
                    <span className="text-lg font-black text-[#8aa3cf]">›</span>
                  </Link>
                ))}
              </div>
            </div>

            <div className="portal-section px-4 py-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="portal-section-heading text-lg">注目の自治体</h2>
                <span className="theme-pill-soft text-[#1b3a6b]">情報量順</span>
              </div>
              <div className="grid gap-2">
                {featuredCities.map((city, index) => (
                  <Link key={city.id} href={city.href} className="portal-rank-item">
                    <span className="portal-rank-no">{index + 1}</span>
                    <span className="min-w-0">
                      <span className="block text-sm font-black text-[#111827]">{city.name}</span>
                      <span className="block text-xs text-[#64748b]">
                        {city.region} / 議員 {city.memberCount}名 / 議事録 {city.minutesCount}件
                      </span>
                    </span>
                    <span className="theme-pill-soft text-[#6b4c11]">{city.hasSession ? "速報あり" : "収録中"}</span>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        {guideCards.map((card) => (
          <Link key={card.title} href={card.href} className="portal-section block px-5 py-5 transition-transform hover:-translate-y-0.5">
            {sectionTag("GUIDE")}
            <h2 className="mt-3 text-xl font-black text-[#111827]">{card.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-[#526072]">{card.body}</p>
            <span className="mt-4 inline-flex text-sm font-black text-[#1b3a6b]">{card.label} ›</span>
          </Link>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <div className="portal-section px-4 py-4 sm:px-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              {sectionTag("NEWS DESK")}
              <h2 className="mt-3 text-2xl font-black text-[#111827]">更新情報とお知らせ</h2>
              <p className="mt-1 text-sm text-[#64748b]">機能追加、改善、自治体追加をまとめて掲載しています。</p>
            </div>
            <Link href="/news" className="theme-button px-4 py-2 text-sm">一覧へ</Link>
          </div>
          <div className="space-y-2">
            {latestNews.map((item) => (
              <Link
                key={`${item.date}-${item.title}`}
                href="/news"
                className="portal-rank-item"
              >
                <span className="theme-pill-soft whitespace-nowrap text-[#475569]">{item.date.replaceAll("-", ".")}</span>
                <span className="min-w-0">
                  <span className={`mb-1 inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold ${categoryClass(item.category)}`}>
                    {item.category}
                  </span>
                  <span className="block text-sm font-black text-[#111827]">{item.title}</span>
                </span>
                <span className="text-lg font-black text-[#8aa3cf]">›</span>
              </Link>
            ))}
          </div>
        </div>

        <div className="grid gap-4">
          <div className="portal-section px-4 py-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="portal-section-heading text-lg">議事録ランキング</h2>
              <span className="theme-pill-soft text-[#1b3a6b]">件数順</span>
            </div>
            <div className="space-y-2">
              {minutesRanking.map((city, index) => (
                <Link key={city.id} href={city.href} className="portal-rank-item">
                  <span className="portal-rank-no">{index + 1}</span>
                  <span className="min-w-0">
                    <span className="block text-sm font-black text-[#111827]">{city.name}</span>
                    <span className="block text-xs text-[#64748b]">{city.region} / 議事録 {city.minutesCount}件</span>
                  </span>
                  <span className="text-sm font-black text-[#1b3a6b]">{city.minutesCount}</span>
                </Link>
              ))}
            </div>
          </div>

          <div className="portal-section px-4 py-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="portal-section-heading text-lg">議員数ランキング</h2>
              <span className="theme-pill-soft text-[#6b4c11]">収録人数順</span>
            </div>
            <div className="space-y-2">
              {memberRanking.map((city, index) => (
                <Link key={city.id} href={city.href} className="portal-rank-item">
                  <span className="portal-rank-no">{index + 1}</span>
                  <span className="min-w-0">
                    <span className="block text-sm font-black text-[#111827]">{city.name}</span>
                    <span className="block text-xs text-[#64748b]">{city.region} / 議員 {city.memberCount}名</span>
                  </span>
                  <span className="text-sm font-black text-[#6b4c11]">{city.memberCount}名</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="municipalities" className="portal-section px-4 py-4 sm:px-5 sm:py-5">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            {sectionTag("CITY INDEX")}
            <h2 className="mt-3 text-[1.8rem] font-black text-[#111827] sm:text-[2.2rem]">市町村議会を地域から選ぶ</h2>
            <p className="mt-1 text-sm text-[#64748b]">
              地域ごとに自治体を整理し、議員数・議事録件数・速報有無がひと目で分かるようにしました。
            </p>
          </div>
          <span className="theme-pill-soft border-[#ecd48b] bg-[#fff6cf] text-[#6b4c11]">石狩地域を初期表示</span>
        </div>

        <div className="space-y-3">
          {groupedRegions.map(({ region, cities: regionCities }) => (
            <details
              key={region}
              open={region === "石狩"}
              className="portal-region-details overflow-hidden rounded-[24px] border-2 border-[#d7deea] bg-[#fbfcfe]"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="theme-pill border-[#1f2937] bg-white text-[#1b3a6b]">{region}</span>
                  <span className="text-sm font-bold text-[#64748b]">{regionCities.length}自治体</span>
                </div>
                <span className="portal-region-chevron text-xl font-black text-[#8aa3cf]">⌄</span>
              </summary>
              <div className="grid gap-3 border-t-2 border-dashed border-[#d7deea] px-4 py-4 sm:grid-cols-2 xl:grid-cols-3">
                {regionCities.map((city) => {
                  const featured = city.id === "chitose";
                  return (
                    <Link
                      key={city.id}
                      href={city.href}
                      className={`block rounded-[22px] border-2 px-4 py-4 transition-transform hover:-translate-y-0.5 ${
                        featured
                          ? "border-[#e6c566] bg-[linear-gradient(180deg,#fffdf1_0%,#fff7d1_100%)] shadow-[0_12px_22px_rgba(239,214,139,0.2)]"
                          : "border-[#d7deea] bg-white shadow-[0_10px_20px_rgba(27,58,107,0.06)] hover:border-[#9fb1d2]"
                      }`}
                    >
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-lg font-black text-[#111827]">{city.name.replace("議会", "")}</p>
                        {featured && <span className="theme-pill-soft border-[#e6c566] bg-[#fff3bf] text-[#6b4c11]">PICK UP</span>}
                      </div>
                      <div className="flex flex-wrap gap-1.5 text-xs font-semibold text-[#64748b]">
                        {city.memberCount > 0 && <span className="theme-pill-soft">{city.memberCount}名</span>}
                        {city.minutesCount > 0 && <span className="theme-pill-soft">議事録 {city.minutesCount}件</span>}
                        {city.decisionCount > 0 && <span className="theme-pill-soft">議決 {city.decisionCount}件</span>}
                        {city.hasSession && <span className="theme-pill-soft bg-[#eef4ff] text-[#1b3a6b]">速報あり</span>}
                        {city.minutesUnavailable && <span className="theme-pill-soft">議事録未公開</span>}
                      </div>
                      {city.latestSession && (
                        <p className="mt-3 line-clamp-2 text-sm font-bold text-[#475569]">
                          最新: {city.latestSession}
                        </p>
                      )}
                    </Link>
                  );
                })}
              </div>
            </details>
          ))}
        </div>
      </section>

      {prefecture && (
        <section className="portal-section px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              {sectionTag("PREFECTURE")}
              <h2 className="mt-3 text-2xl font-black text-[#111827]">北海道議会</h2>
              <p className="mt-1 text-sm text-[#64748b]">道議会の情報も別ページでまとめています。</p>
            </div>
            <Link href={`/${prefecture.slug}`} className="theme-button theme-button-accent px-4 py-2 text-sm">
              {prefecture.council_name}へ
            </Link>
          </div>
        </section>
      )}

      <section className="portal-section px-4 py-4 sm:px-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <div>
            {sectionTag("ABOUT")}
            <h2 className="mt-3 text-2xl font-black text-[#111827]">このサイトについて</h2>
            <p className="mt-2 text-sm leading-relaxed text-[#526072] sm:text-[15px]">
              地方議会ドットコムは、北海道内の市町村議会の情報を横断的に収集・整理する非公式の情報サイトです。
              行政情報サイトとしての読みやすさと、入口としての情報密度を両立させることを目的に設計しています。
              正式な情報確認は各市町村議会の公式サイトをご利用ください。
            </p>
          </div>
          <div className="portal-rail-card p-4">
            <p className="mb-2 text-xs font-black uppercase tracking-[0.12em] text-[#6b4c11]">見る順番の例</p>
            <ol className="space-y-2 text-sm font-bold text-[#334155]">
              <li>1. 地域一覧から自治体を選ぶ</li>
              <li>2. 横断検索で政策テーマを探す</li>
              <li>3. 議員・議決・更新情報まで追う</li>
            </ol>
          </div>
        </div>
      </section>
    </div>
  );
}
