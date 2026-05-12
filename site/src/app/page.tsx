import fs from "fs";
import path from "path";
import Link from "next/link";
import { getMunicipalities } from "@/lib/municipalities";
import { getNews, categoryClass } from "@/lib/news";
import { getLatestArticles, articleCategoryClass, formatArticleDate } from "@/lib/articles";
import { getSiteStats } from "@/lib/siteStats";
import { getAllTags } from "@/lib/topics";
import { buildPageMetadata } from "@/lib/metadata";
import type { Member } from "@/types/member";
import type { Decision } from "@/types/decision";

export const metadata = buildPageMetadata({
  title: "北海道の市町村議会・議事録検索",
  description:
    "北海道の市町村議会と北海道議会の議員名簿、議事録、議決結果を横断して調べられます。自治体別一覧とテーマ別入口から探せます。",
  path: "/",
});

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
  hasSession: boolean;
  memberCount: number;
  latestSession: string;
  decisionCount: number;
  minutesCount: number;
};

export default function HomePage() {
  const allMunis = getMunicipalities().filter((m) => m.active);
  const prefecture = allMunis.find((m) => m.level === "prefecture");
  const municipalities = allMunis.filter((m) => m.level === "municipality");
  const latestNews = getNews().slice(0, 3);
  const latestArticles = getLatestArticles(2);
  const stats = getSiteStats();
  const topTags = getAllTags().slice(0, 12);
  const regionOrder = ["石狩", "空知", "後志", "胆振", "日高", "渡島", "檜山", "上川", "留萌", "宗谷", "オホーツク", "十勝", "釧路", "根室"];

  const cities: CitySummary[] = municipalities.map((m) => ({
    id: m.slug,
    name: m.council_name,
    furigana: m.furigana,
    href: `/${m.slug}`,
    region: m.region,
    hasSession: m.features.includes("sessions"),
    memberCount: getMemberCount(m.slug),
    latestSession: getLatestSession(m.slug),
    decisionCount: getDecisionCount(m.slug),
    minutesCount: getMinutesCount(m.slug),
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
        if (a.id === "chitose") return -1;
        if (b.id === "chitose") return 1;
        return a.furigana.localeCompare(b.furigana, "ja");
      }),
    }));

  return (
    <div className="page-shell min-w-0 max-w-6xl space-y-6">
      <section className="theme-panel mx-auto max-w-5xl rounded-[30px] px-4 py-5 sm:px-6 sm:py-6">
        <h1 className="text-[2.1rem] font-black leading-[1.1] tracking-tight text-[#111827] md:text-[3.1rem] xl:text-[4rem]">
          地方議会の「なか」を、
          <br />
          わかりやすく。
        </h1>
        <p className="mt-4 max-w-4xl text-[15px] leading-relaxed text-[#475569] md:text-[17px] xl:text-lg">
          まずは北海道から。市町村議会の議員・議事録・議決を横断的にまとめて、
          どんな議論が行われているか、だれでもかんたんに追えるようにしています。
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/search" className="theme-button theme-button-accent px-4 py-2 text-sm">
            まとめて検索
          </Link>
          <a href="#municipalities" className="theme-button px-4 py-2 text-sm">
            市町村から見る
          </a>
          <Link href="/sources" className="theme-button px-4 py-2 text-sm">
            掲載情報と出典
          </Link>
          <Link href="/articles" className="theme-button px-4 py-2 text-sm">
            読みもの
          </Link>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { label: "対象自治体", value: stats.municipalityCount.toLocaleString(), unit: "", tone: "border-[#DCE6F5]" },
          { label: "議員", value: stats.memberCount.toLocaleString(), unit: "名", tone: "border-[#F3E3AF]" },
          { label: "会議録", value: stats.minutesCount.toLocaleString(), unit: "件", tone: "border-[#D8F0E4]" },
          { label: "議題", value: stats.agendaCount.toLocaleString(), unit: "件", tone: "border-[#D7E9FB]" },
        ].map((item) => (
          <div
            key={item.label}
            className={`rounded-[18px] border-2 bg-white px-4 py-3 shadow-[0_6px_16px_rgba(27,58,107,0.05)] sm:px-5 ${item.tone}`}
          >
            <p className="text-[12px] font-bold tracking-[0.02em] text-[#667085] sm:text-[13px]">{item.label}</p>
            <p className="mt-1.5 flex items-end gap-1 text-[1.95rem] font-black leading-none text-[#111827] sm:text-[2.15rem]">
              {item.value}
              {item.unit && <span className="pb-1 text-base font-bold text-[#667085] sm:text-lg">{item.unit}</span>}
            </p>
          </div>
        ))}
      </section>

      {latestNews.length > 0 && (
        <section className="mx-auto max-w-[68rem] border-t border-[#D8DEE8] px-1 pt-1">
          <div className="mb-3 flex items-center justify-between gap-3 px-3 pt-3 sm:px-4">
            <h2 className="text-xl font-black text-[#111827]">更新情報</h2>
            <Link href="/news" className="text-sm font-black text-[#1B3A6B]">
              すべて見る ›
            </Link>
          </div>
          <div className="divide-y divide-[#E5E7EB] border-y border-[#E5E7EB] bg-white">
            {latestNews.map((item) => (
              <Link
                key={`${item.date}-${item.title}`}
                href="/news"
                className="block px-4 py-4 transition-colors hover:bg-[#FAFBFD] sm:px-5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-[#64748B]">{item.date}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${categoryClass(item.category)}`}>
                    {item.category}
                  </span>
                </div>
                <p className="mt-2 text-sm font-black text-[#111827]">{item.title}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {latestArticles.length > 0 && (
        <section className="mx-auto max-w-[68rem] border-t border-[#D8DEE8] pt-6">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-[1.7rem] font-black leading-tight text-[#111827] sm:text-[2rem]">読みもの</h2>
              <p className="mt-1 text-sm text-[#64748B]">
                議会質問の背景や、質問した議員へのインタビューを読む入口です。
              </p>
            </div>
            <Link href="/articles" className="text-sm font-black text-[#1B3A6B]">
              すべての記事を見る ›
            </Link>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {latestArticles.map((article) => (
              <Link
                key={article.slug}
                href={`/articles/${article.slug}`}
                className="rounded-[22px] border-2 border-[#D8DEE8] bg-white px-4 py-4 shadow-[0_6px_14px_rgba(27,58,107,0.06)] transition-transform hover:-translate-y-0.5 hover:border-[#1B3A6B]"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${articleCategoryClass(article.category)}`}>
                    {article.category}
                  </span>
                  <time dateTime={article.date} className="text-xs font-bold text-[#64748B]">
                    {formatArticleDate(article.date)}
                  </time>
                </div>
                <h3 className="text-lg font-black leading-snug text-[#111827]">{article.title}</h3>
                <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-[#475569]">{article.summary}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {topTags.length > 0 && (
        <section className="mx-auto max-w-[68rem] border-t border-[#D8DEE8] pt-6">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-[1.7rem] font-black leading-tight text-[#111827] sm:text-[2rem]">よく探されるテーマ</h2>
              <p className="mt-1 text-sm text-[#64748B]">
                検索のきっかけになる代表テーマです。市町村をまたいで、関連する議事録へ進めます。
              </p>
            </div>
            <Link href="/topics" className="text-sm font-black text-[#1B3A6B]">
              すべてのテーマを見る ›
            </Link>
          </div>

          <div className="flex flex-wrap gap-2">
            {topTags.map(({ tag, count }) => (
              <Link
                key={tag}
                href={`/topics/${encodeURIComponent(tag)}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-[#D8DEE8] bg-white px-3 py-2 text-sm font-bold text-[#1B3A6B] transition-colors hover:border-[#1B3A6B] hover:bg-[#E8EEF7]"
              >
                <span>{tag}</span>
                <span className="text-xs text-[#64748B]">{count}件</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section id="municipalities" className="mx-auto min-w-0 max-w-[68rem] border-t border-[#D8DEE8] pt-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[1.7rem] font-black leading-tight text-[#111827] sm:text-[2rem]">市町村議会を選ぶ</h2>
            <p className="mt-1 text-sm text-[#64748B]">
              地域ごとに整理しました。初期状態では石狩地域だけ開いています。
            </p>
          </div>
          <span className="theme-pill-soft px-4 py-2 text-sm text-[#6B4C11]">クリックで開閉</span>
        </div>

        <div className="space-y-3">
          {groupedRegions.map(({ region, cities: regionCities }) => (
            <details
              key={region}
              open={region === "石狩"}
              className="overflow-hidden border-b border-[#D8DEE8] bg-transparent pb-3"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="theme-pill px-4 py-2 text-sm text-[#1B3A6B]">{region}</span>
                  <span className="text-sm font-bold text-[#64748B]">{regionCities.length}自治体</span>
                </div>
                <span className="text-xl font-black text-[#8AA3CF]">⌄</span>
              </summary>
              <div className="grid gap-3 border-t border-dashed border-[#D8DEE8] pt-4 sm:grid-cols-2 2xl:grid-cols-3">
                {regionCities.map((city) => {
                  const featured = city.id === "chitose";
                  return (
                    <Link
                      key={city.id}
                      href={city.href}
                      className={`rounded-[22px] border-2 px-4 py-4 transition-transform hover:-translate-y-0.5 ${
                        featured
                          ? "border-[#E6C566] bg-[#FFF9DD] shadow-[0_10px_18px_rgba(239,214,139,0.18)]"
                          : "border-[#D8DEE8] bg-white shadow-[0_6px_14px_rgba(27,58,107,0.06)]"
                      }`}
                    >
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-lg font-black text-[#111827]">{city.name.replace("議会", "")}</p>
                        {featured && <span className="theme-pill-soft px-3 py-1 text-xs text-[#6B4C11]">OPEN</span>}
                      </div>
                      <div className="flex flex-wrap gap-1.5 text-xs font-bold text-[#64748B]">
                        {city.memberCount > 0 && <span className="theme-pill-soft">{city.memberCount}名</span>}
                        {city.minutesCount > 0 && <span className="theme-pill-soft">議事録 {city.minutesCount}件</span>}
                        {city.decisionCount > 0 && <span className="theme-pill-soft">議決 {city.decisionCount}件</span>}
                        {city.hasSession && <span className="theme-pill-soft bg-[#EEF4FF] text-[#1B3A6B]">速報あり</span>}
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
        <section className="theme-card mx-auto max-w-[68rem] rounded-[26px] px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-black text-[#111827]">北海道議会</h2>
              <p className="mt-1 text-sm text-[#64748B]">道議会の情報も別ページでまとめています。</p>
            </div>
            <Link href={`/${prefecture.slug}`} className="theme-button theme-button-accent px-4 py-2 text-sm">
              {prefecture.council_name}へ
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
