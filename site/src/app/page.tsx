import fs from "fs";
import path from "path";
import Link from "next/link";
import { getMunicipalities } from "@/lib/municipalities";
import { getNews, categoryClass } from "@/lib/news";
import { getLatestArticles, articleCategoryClass, formatArticleDate } from "@/lib/articles";
import { getSiteStats } from "@/lib/siteStats";
import { getCitizenTopics } from "@/lib/topics";
import { slugForTag } from "@/lib/topicAliases";
import { getCityCapabilities, getCityCapability } from "@/lib/cityCapabilities";
import { buildPageMetadata } from "@/lib/metadata";
import HomeMunicipalityExplorer from "@/components/HomeMunicipalityExplorer";
import type { Member } from "@/types/member";
import type { Decision } from "@/types/decision";
import type { MinutesIndexItem } from "@/types/minutes";

export const metadata = buildPageMetadata({
  title: "地方議会ドットコム | 北海道の市町村議会・議事録検索",
  description:
    "北海道の市町村議会と北海道議会の議員名簿、議事録、議決結果を横断して調べられます。自治体別一覧とテーマ別入口から探せます。",
  path: "/",
});

export const revalidate = 86400;

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

function getMinutesIndex(cityId: string): MinutesIndexItem[] {
  const candidates = [
    path.join(/*turbopackIgnore: true*/ process.cwd(), "data", cityId, "minutes", "index.json"),
    path.join(/*turbopackIgnore: true*/ process.cwd(), "data", cityId, "index.json"),
  ];
  for (const fp of candidates) {
    try {
      const items = JSON.parse(
        fs.readFileSync(/*turbopackIgnore: true*/ fp, "utf-8")
      ) as MinutesIndexItem[];
      if (Array.isArray(items)) return items;
    } catch {
      // try next index location
    }
  }
  return [];
}

function getLatestDecisionSession(cityId: string): string {
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

function getMinutesCount(cityId: string, index: MinutesIndexItem[]): number {
  if (index.length > 0) return index.length;
  try {
    const dir = path.join(process.cwd(), "data", cityId, "minutes");
    const files = fs.readdirSync(dir);
    return files.filter((f) => /^\d+\.json$/.test(f)).length;
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
  hasMinutes: boolean;
  hasBudgets: boolean;
  hasThemes: boolean;
};

export default async function HomePage() {
  const allMunis = getMunicipalities().filter((m) => m.active);
  const prefecture = allMunis.find((m) => m.level === "prefecture");
  const municipalities = allMunis.filter((m) => m.level === "municipality");
  const latestNews = getNews().slice(0, 3);
  const latestArticles = await getLatestArticles(2);
  const stats = getSiteStats();
  const topTags = getCitizenTopics().slice(0, 12);
  const capabilitiesBySlug = getCityCapabilities();
  const regionOrder = ["石狩", "空知", "後志", "胆振", "日高", "渡島", "檜山", "上川", "留萌", "宗谷", "オホーツク", "十勝", "釧路", "根室"];

  const cities: CitySummary[] = municipalities.map((m) => {
    const capability = capabilitiesBySlug[m.slug] ?? getCityCapability(m.slug);
    const minutesIndex = getMinutesIndex(m.slug);
    return {
      id: m.slug,
      name: m.council_name,
      furigana: m.furigana,
      href: `/${m.slug}`,
      region: m.region,
      hasSession: capability.capabilities.sessions,
      hasMinutes: capability.capabilities.minutes,
      hasBudgets: capability.capabilities.budgets,
      hasThemes: capability.capabilities.themes,
      memberCount: getMemberCount(m.slug),
      latestSession: minutesIndex[0]?.name ?? getLatestDecisionSession(m.slug),
      decisionCount: getDecisionCount(m.slug),
      minutesCount: getMinutesCount(m.slug, minutesIndex),
    };
  });

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
    <div className="page-shell min-w-0 max-w-6xl space-y-4 sm:space-y-6">
      <section className="theme-panel mx-auto max-w-5xl rounded-[22px] px-4 py-5 sm:rounded-[30px] sm:px-6 sm:py-6">
        <h1 className="text-[1.95rem] font-black leading-[1.12] tracking-tight text-[#111827] md:text-[3.1rem] xl:text-[4rem]">
          地方議会の「なか」を、
          <br />
          わかりやすく。
        </h1>
        <p className="mt-3 max-w-4xl text-[15px] leading-relaxed text-[#475569] sm:mt-4 md:text-[17px] xl:text-lg">
          まずは北海道から。市町村議会の議員・議事録・議決を横断的にまとめています。
          <span className="hidden sm:inline">どんな議論が行われているか、だれでもかんたんに追えるようにしています。</span>
        </p>

        <form action="/search" className="mt-5 max-w-3xl">
          <label htmlFor="home-search" className="sr-only">
            議員名、議題、キーワードで検索
          </label>
          <div className="flex flex-col gap-2 rounded-[20px] border-2 border-[#CBD5E0] bg-white p-2 sm:flex-row">
            <input
              id="home-search"
              name="q"
              type="search"
              placeholder="除雪、給食無償化、ラピダス、議員名で検索"
              className="min-h-12 flex-1 rounded-2xl border-0 bg-[#F8FAFC] px-4 text-base font-bold text-[#111827] outline-none placeholder:text-[#718096] focus:bg-white focus:ring-2 focus:ring-[#2A5298]"
            />
            <button type="submit" className="theme-button theme-button-accent min-h-12 px-5 text-base">
              検索する
            </button>
          </div>
        </form>
      </section>

      <section className="mx-auto max-w-5xl border-l-4 border-[#F7C948] px-4 py-2 sm:px-5">
        <p className="text-sm font-black tracking-[0.08em] text-[#1B3A6B]">地方議会ドットコムとは</p>
        <p className="mt-1 text-base leading-relaxed text-[#4A5568]">
          地方議会ドットコムは、北海道内の市町村議会と北海道議会の議員情報・議事録・議決結果を横断して探せる非公式の市民向け情報サイトです。
        </p>
        <Link href="/about" prefetch={false} className="mt-2 inline-flex text-sm font-black text-[#2A5298] hover:underline">
          くわしく見る
        </Link>
      </section>

      <section className="mx-auto max-w-5xl">
        <div className="mb-2 sm:mb-3">
          <h2 className="text-lg font-black text-[#111827] sm:text-xl">検索以外の入口</h2>
          <p className="mt-1 hidden text-base leading-relaxed text-[#4A5568] sm:block">
            自治体・テーマ・予算・読みものは、一覧からたどれます。
          </p>
        </div>
        <div className="grid gap-2 sm:gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "市町村から見る", href: "#municipalities", body: "自治体ごとの議員・議事録・予算へ" },
            { label: "テーマから見る", href: "/topics", body: "福祉、予算、教育などの議論へ" },
            { label: "予算書を見る", href: "/sources", body: "掲載状況と原本確認の入口へ" },
            { label: "読みもの", href: "/articles", body: "質問の背景や比較記事を読む" },
          ].map((item) => (
            <Link
              key={item.label}
              href={item.href}
              prefetch={false}
              className="motion-surface flex min-h-12 items-center rounded-lg border border-[#CBD5E0] bg-white px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298] sm:block sm:min-h-0 sm:py-4"
            >
              <h3 className="text-base font-black text-[#1B3A6B]">{item.label}</h3>
              <p className="mt-2 hidden text-sm leading-relaxed text-[#4A5568] sm:block">{item.body}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-5xl">
        <dl className="grid grid-cols-4 divide-x divide-[#E2E8F0] rounded-lg border border-[#CBD5E0] bg-white px-2 py-2 text-center sm:hidden">
          {[
            { label: "自治体", value: stats.municipalityCount.toLocaleString(), unit: "" },
            { label: "議員", value: stats.memberCount.toLocaleString(), unit: "名" },
            { label: "会議録", value: stats.minutesCount.toLocaleString(), unit: "件" },
            { label: "議題", value: stats.agendaCount.toLocaleString(), unit: "件" },
          ].map((item) => (
            <div key={item.label} className="px-1">
              <dt className="text-[10px] font-medium text-[#718096]">{item.label}</dt>
              <dd className="mt-0.5 text-sm font-black leading-tight text-[#1B3A6B]">
                {item.value}
                {item.unit && <span className="ml-0.5 text-[10px] text-[#718096]">{item.unit}</span>}
              </dd>
            </div>
          ))}
        </dl>
        <div className="hidden grid-cols-2 gap-3 sm:grid xl:grid-cols-4">
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
        </div>
      </section>

      {latestNews.length > 0 && (
        <section className="mx-auto max-w-[68rem] border-t border-[#D8DEE8] px-1 pt-1">
          <div className="mb-3 flex items-center justify-between gap-3 px-3 pt-3 sm:px-4">
            <h2 className="text-xl font-black text-[#111827]">更新情報</h2>
            <Link href="/news" prefetch={false} className="text-sm font-black text-[#1B3A6B]">
              すべて見る ›
            </Link>
          </div>
          <div className="divide-y divide-[#E5E7EB] border-y border-[#E5E7EB] bg-white">
            {latestNews.map((item) => (
              <Link
                key={`${item.date}-${item.title}`}
                href="/news"
                prefetch={false}
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
        <section className="mx-auto max-w-[68rem] border-t border-[#D8DEE8] pt-4 sm:pt-6">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-black leading-tight text-[#111827] sm:text-[2rem]">読みもの</h2>
              <p className="mt-1 hidden text-sm text-[#64748B] sm:block">
                議会質問の背景や、質問した議員へのインタビューを読む入口です。
              </p>
            </div>
            <Link href="/articles" prefetch={false} className="text-sm font-black text-[#1B3A6B]">
              すべての記事を見る ›
            </Link>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {latestArticles.map((article) => (
              <Link
                key={article.slug}
                href={`/articles/${article.slug}`}
                prefetch={false}
                className="motion-surface rounded-lg border border-[#D8DEE8] bg-white px-4 py-3 sm:rounded-[22px] sm:border-2 sm:py-4 sm:shadow-[0_6px_14px_rgba(27,58,107,0.06)]"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${articleCategoryClass(article.category)}`}>
                    {article.category}
                  </span>
                  <time dateTime={article.date} className="text-xs font-bold text-[#64748B]">
                    {formatArticleDate(article.date)}
                  </time>
                </div>
                <h3 className="text-base font-black leading-snug text-[#111827] sm:text-lg">{article.title}</h3>
                <p className="mt-2 hidden line-clamp-3 text-sm leading-relaxed text-[#475569] sm:block">{article.summary}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {topTags.length > 0 && (
        <section className="mx-auto max-w-[68rem] border-t border-[#D8DEE8] pt-4 sm:pt-6">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-black leading-tight text-[#111827] sm:text-[2rem]">よく探されるテーマ</h2>
              <p className="mt-1 hidden text-sm text-[#64748B] sm:block">
                検索のきっかけになる代表テーマです。市町村をまたいで、関連する議事録へ進めます。
              </p>
            </div>
            <Link href="/topics" prefetch={false} className="text-sm font-black text-[#1B3A6B]">
              すべてのテーマを見る ›
            </Link>
          </div>

          <div className="flex flex-wrap gap-2">
            {topTags.map(({ tag, count }, index) => (
              <Link
                key={tag}
                href={`/topics/${slugForTag(tag)}`}
                prefetch={false}
                className={`motion-surface items-center gap-1.5 rounded-full border border-[#D8DEE8] bg-white px-3 py-2 text-sm font-bold text-[#1B3A6B] ${
                  index >= 6 ? "hidden sm:inline-flex" : "inline-flex"
                }`}
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
            <p className="mt-1 text-base leading-relaxed text-[#4A5568]">
              地域ごとに市町村議会ページへ進めます。
            </p>
          </div>
        </div>
        <HomeMunicipalityExplorer groupedRegions={groupedRegions} />
      </section>

      {prefecture && (
        <section className="theme-card mx-auto max-w-[68rem] rounded-[26px] px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-black text-[#111827]">北海道議会</h2>
              <p className="mt-1 text-sm text-[#64748B]">道議会の情報も別ページでまとめています。</p>
            </div>
            <Link href={`/${prefecture.slug}`} prefetch={false} className="theme-button theme-button-accent px-4 py-2 text-sm">
              {prefecture.council_name}へ
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
