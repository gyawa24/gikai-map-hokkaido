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
  const stats = getSiteStats();
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
    <div className="page-shell space-y-6">
      <section className="theme-panel rounded-[30px] px-4 py-5 sm:px-6 sm:py-6">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="theme-pill-soft px-4 py-2 text-[11px] font-black tracking-[0.12em] text-[#334155]">LOCAL COUNCIL INFO</span>
          <span className="theme-pill-soft px-4 py-2 text-sm font-black text-[#1B3A6B]">地方議会ドットコム</span>
          <span className="rounded-lg bg-[#FFF3BF] px-3 py-2 text-base font-medium text-[#6B4C11]">β</span>
        </div>

        <h1 className="text-[2.2rem] font-black leading-[1.1] tracking-tight text-[#111827] sm:text-[4rem]">
          地方議会の「なか」を、
          <br />
          わかりやすく。
        </h1>
        <p className="mt-4 max-w-4xl text-[15px] leading-relaxed text-[#475569] sm:text-lg">
          まずは北海道から。市町村議会の議員・議事録・議決を横断的にまとめて、
          どんな議論が行われているか、だれでもかんたんに追えるようにしています。
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <span className="theme-pill-soft px-4 py-2 text-sm">北海道</span>
          <span className="theme-pill-soft px-4 py-2 text-sm">議員</span>
          <span className="theme-pill-soft px-4 py-2 text-sm">議事録</span>
          <span className="theme-pill-soft px-4 py-2 text-sm">議決</span>
          <span className="theme-pill-soft px-4 py-2 text-sm">検索できます</span>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "対象自治体", value: stats.municipalityCount.toLocaleString(), unit: "", tone: "bg-[#E8EEF7] text-[#1B3A6B]" },
          { label: "議員", value: stats.memberCount.toLocaleString(), unit: "名", tone: "bg-[#FFF3BF] text-[#6B4C11]" },
          { label: "会議録", value: stats.minutesCount.toLocaleString(), unit: "件", tone: "bg-[#DDF8E9] text-[#16624A]" },
          { label: "議題", value: stats.agendaCount.toLocaleString(), unit: "件", tone: "bg-[#E3F2FF] text-[#18507C]" },
        ].map((item) => (
          <div key={item.label} className="theme-card rounded-[24px] px-4 py-4 sm:px-5 sm:py-5">
            <div className={`mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl text-base font-black ${item.tone}`}>
              {item.label.slice(0, 1)}
            </div>
            <p className="text-sm font-black text-[#475569]">{item.label}</p>
            <p className="mt-1 text-[2rem] font-black leading-none text-[#111827] sm:text-[2.4rem]">
              {item.value}
              {item.unit && <span className="ml-1 text-lg text-[#475569]">{item.unit}</span>}
            </p>
          </div>
        ))}
      </section>

      {latestNews.length > 0 && (
        <section className="theme-card rounded-[28px] px-4 py-4 sm:px-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-xl font-black text-[#111827]">更新情報</h2>
            <Link href="/news" className="text-sm font-black text-[#1B3A6B]">
              すべて見る ›
            </Link>
          </div>
          <div className="space-y-2">
            {latestNews.map((item) => (
              <Link
                key={`${item.date}-${item.title}`}
                href="/news"
                className="block rounded-[20px] border border-[#E5E7EB] bg-[#FAFAFA] px-4 py-3 transition-colors hover:border-[#CBD5E0]"
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

      <section id="municipalities" className="theme-card rounded-[28px] px-4 py-4 sm:px-5 sm:py-5">
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
              className="overflow-hidden rounded-[24px] border-2 border-[#D8DEE8] bg-[#FBFCFE]"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="theme-pill px-4 py-2 text-sm text-[#1B3A6B]">{region}</span>
                  <span className="text-sm font-bold text-[#64748B]">{regionCities.length}自治体</span>
                </div>
                <span className="text-xl font-black text-[#8AA3CF]">⌄</span>
              </summary>
              <div className="grid gap-3 border-t border-dashed border-[#D8DEE8] px-4 py-4 sm:grid-cols-2 xl:grid-cols-3">
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
        <section className="theme-card rounded-[26px] px-4 py-4 sm:px-5">
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
