import fs from "fs";
import path from "path";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import type { Metadata } from "next";
import type { MinutesSession, MinutesIndexItem, MinutesEnriched } from "@/types/minutes";
import MinutesDetailClient from "@/components/MinutesDetailClient";
import { getMunicipality } from "@/lib/municipalities";
import { buildPageMetadata } from "@/lib/metadata";
import { hasStructuredMinutes } from "@/lib/structured-minutes/loadStructuredMinutes";

// Build時は recent N councils のみ static generate（generateStaticParams）。
// それ以外の URL は ISR で初回アクセス時にレンダリングし、Vercel エッジでキャッシュ。
// データソースは local（ある場合）→ GitHub Raw URL（fallback）。
// 過去の URL を 404 にしないことで SEO を維持しつつ、build 時間を大幅短縮する。
export const dynamicParams = true;
export const revalidate = 86400; // 1 日

const RECENT_PRERENDER_COUNT = 5;
const REPO_OWNER = process.env.GIKAI_REPO_OWNER ?? "gyawa24";
const REPO_NAME = process.env.GIKAI_REPO_NAME ?? "gikai-map-hokkaido";
const REPO_BRANCH = process.env.GIKAI_REPO_BRANCH ?? "main";
const RAW_BASE = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${REPO_BRANCH}`;

async function fetchRawJson<T>(remotePath: string): Promise<T | null> {
  try {
    const res = await fetch(`${RAW_BASE}/${remotePath}`, {
      next: { revalidate: 86400 },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function getSession(city: string, id: string): Promise<MinutesSession | null> {
  // 1) Local read（build時の SSG / Function バンドルにデータがある場合）
  const localCandidates = [
    path.join(/*turbopackIgnore: true*/ process.cwd(), "data", city, "minutes", `${id}.json`),
    path.join(/*turbopackIgnore: true*/ process.cwd(), "data", city, `${id}.json`),
  ];
  for (const fp of localCandidates) {
    try {
      return JSON.parse(
        fs.readFileSync(/*turbopackIgnore: true*/ fp, "utf-8")
      ) as MinutesSession;
    } catch {
      // try next
    }
  }
  // 2) GitHub Raw fallback（ISR時にデータが Function バンドルに無い場合）
  const remoteCandidates = [
    `site/data/${city}/minutes/${id}.json`,
    `site/data/${city}/${id}.json`,
  ];
  for (const remotePath of remoteCandidates) {
    const data = await fetchRawJson<MinutesSession>(remotePath);
    if (data) return data;
  }
  return null;
}

async function getEnriched(city: string, id: string): Promise<MinutesEnriched | null> {
  const fp = path.join(
    /*turbopackIgnore: true*/ process.cwd(),
    "data",
    city,
    "minutes",
    "enriched",
    `${id}.json`
  );
  try {
    return JSON.parse(
      fs.readFileSync(/*turbopackIgnore: true*/ fp, "utf-8")
    ) as MinutesEnriched;
  } catch {
    // ISR fallback to GitHub Raw（enriched は欠損許容なので失敗で null）
    return await fetchRawJson<MinutesEnriched>(
      `site/data/${city}/minutes/enriched/${id}.json`
    );
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string; id: string }>;
}): Promise<Metadata> {
  const { city, id } = await params;
  const municipality = getMunicipality(city);
  const cityName = municipality?.name ?? city;
  const session = await getSession(city, id);
  const enriched = await getEnriched(city, id);

  const title = session
    ? `${session.name} - ${cityName}議会`
    : `議事録 - ${cityName}議会`;
  const description = enriched?.summary
    ? enriched.summary.slice(0, 100)
    : session
    ? `${session.type_label}（${session.japanese_year}）`
    : `${cityName}議会の議事録`;

  return buildPageMetadata({
    title,
    description,
    path: `/${city}/minutes/${id}`,
  });
}

export async function generateStaticParams() {
  const { getMunicipalities } = await import("@/lib/municipalities");
  const params: { city: string; id: string }[] = [];
  for (const m of getMunicipalities()) {
    if (!m.active) continue;
    // minutes/index.json が基本形。ない場合は city 直下の index.json を見る。
    const candidates = [
      path.join(/*turbopackIgnore: true*/ process.cwd(), "data", m.slug, "minutes", "index.json"),
      path.join(/*turbopackIgnore: true*/ process.cwd(), "data", m.slug, "index.json"),
    ];
    for (const fp of candidates) {
      try {
        const index = JSON.parse(
          fs.readFileSync(/*turbopackIgnore: true*/ fp, "utf-8")
        ) as MinutesIndexItem[];
        if (!Array.isArray(index)) continue;
        // council_id 降順で最新 N 件のみ static generate（残りは ISR）
        const recent = [...index]
          .sort((a, b) => Number(b.council_id ?? 0) - Number(a.council_id ?? 0))
          .slice(0, RECENT_PRERENDER_COUNT);
        for (const item of recent) params.push({ city: m.slug, id: String(item.council_id) });
        break;
      } catch {
        // try next
      }
    }
  }
  return params;
}

function typeCategory(typeLabel: string): string {
  if (
    typeLabel.includes("定例会") &&
    !typeLabel.includes("補正") &&
    !typeLabel.includes("委員会")
  )
    return "定例会";
  if (typeLabel.includes("臨時会")) return "臨時会";
  if (typeLabel.includes("委員会")) return "委員会";
  return "";
}

export default async function CityMinutesDetailPage({
  params,
}: {
  params: Promise<{ city: string; id: string }>;
}) {
  const { city, id } = await params;
  const municipality = getMunicipality(city);
  const cityName = municipality?.name ?? city;

  const session = await getSession(city, id);
  if (!session) notFound();

  const restricted = municipality?.minutes_access === "restricted";
  if (restricted) {
    const note = municipality?.minutes_access_note;
    return (
      <div className="page-shell max-w-6xl">
        <nav className="text-sm text-[#718096] mb-5 flex items-center gap-1.5">
          <a href={`/${city}`} className="hover:text-[#1B3A6B] transition-colors">
            {cityName}議会
          </a>
          <span aria-hidden="true">›</span>
          <a
            href={`/${city}/minutes`}
            className="hover:text-[#1B3A6B] transition-colors"
          >
            議事録
          </a>
        </nav>
        <div className="theme-alert px-5 py-5">
          <p className="text-base font-semibold text-[#7A5A00] mb-2">本サイトでの全文閲覧は一時停止中です</p>
          <p className="text-sm text-[#5A4500] leading-relaxed">
            {note ?? `${cityName}公式サイトの著作権ポリシーで複製・転用に事前許可を要する旨が明記されているため、許諾確認が取れるまで本サイトでの全文閲覧を停止しています。データは保管しており、許諾後に公開を再開します。`}
          </p>
          <p className="text-sm text-[#5A4500] leading-relaxed mt-3">
            会議録本体は{cityName}議会事務局の公式ページからご覧ください。
          </p>
          <p className="text-xs text-[#7A5A00] mt-4">
            <a href={`/${city}/minutes`} className="underline hover:text-[#5A4500]">
              ← {cityName}議事録一覧に戻る
            </a>
          </p>
        </div>
      </div>
    );
  }

  const enriched = await getEnriched(city, id);
  const category = typeCategory(session.type_label);
  const canReadStructuredMinutes = await hasStructuredMinutes(city, id);

  const totalSpeeches = session.schedules.reduce(
    (acc, s) =>
      acc + s.minutes.filter((m) => m.minute_type !== "名簿").length,
    0
  );

  return (
    <div className="page-shell max-w-6xl">
      <nav className="text-sm text-[#718096] mb-5 flex items-center gap-1.5">
        <a href={`/${city}`} className="hover:text-[#1B3A6B] transition-colors">
          {cityName}議会
        </a>
        <span aria-hidden="true">›</span>
        <a
          href={`/${city}/minutes`}
          className="hover:text-[#1B3A6B] transition-colors"
        >
          議事録
        </a>
        <span aria-hidden="true">›</span>
        <span className="text-[#1A202C]" aria-current="page">
          {session.name.slice(0, 20)}
        </span>
      </nav>

      <section className="mb-5">
        <div className="flex items-center gap-2 mb-2">
          {category && (
            <span className="theme-pill-soft text-[#2A5298]">
              {category}
            </span>
          )}
          <span className="text-xs text-[#718096]">{session.japanese_year}</span>
        </div>
        <h2 className="theme-section-title mb-2 text-2xl leading-snug">
          {session.name}
        </h2>
        <div className="flex flex-wrap gap-4 text-sm text-[#4A5568]">
          <span className="inline-flex items-center gap-1.5">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-4 h-4 text-[#2A5298]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            {session.schedules.length}日程
          </span>
          <span className="inline-flex items-center gap-1.5">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-4 h-4 text-[#2A5298]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            {totalSpeeches}件の発言・議題
          </span>
        </div>
      </section>

      {canReadStructuredMinutes && (
        <section className="mb-5 rounded-2xl border border-[#C5D0E6] bg-white px-4 py-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-bold text-[#1B3A6B]">
                この議事録を発言・質問項目別に読む
              </p>
              <p className="mt-1 text-sm leading-relaxed text-[#4A5568]">
                公式会議録の原文をもとに、発言単位・質問者別・質問項目別に整理した試験版ビューです。
                正式な内容は公式会議録をご確認ください。
              </p>
            </div>
            <a
              href={`/${city}/minutes/${id}/turns`}
              className="inline-flex shrink-0 items-center justify-center rounded-full border border-[#C5D0E6] bg-[#E8EEF7] px-4 py-2 text-sm font-bold text-[#1B3A6B] transition-colors hover:bg-[#DCE7F6]"
            >
              発言・質問項目別に読む
            </a>
          </div>
        </section>
      )}

      <Suspense>
        <MinutesDetailClient session={session} enriched={enriched} cityName={cityName} slug={city} />
      </Suspense>
    </div>
  );
}
