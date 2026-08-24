import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import HashTargetScroller from "@/components/structured-minutes/HashTargetScroller";
import SourceNotice from "@/components/structured-minutes/SourceNotice";
import StructuredMinutesTabs from "@/components/structured-minutes/StructuredMinutesTabs";
import { getMunicipality } from "@/lib/municipalities";
import { buildPageMetadata } from "@/lib/metadata";
import { getPublishedMinutesIndexItem } from "@/lib/minutesPublication";
import { getStructuredMinutes } from "@/lib/structured-minutes/loadStructuredMinutes";

type View = "turns" | "questions" | "topics";

type Props = {
  params: Promise<{ city: string; id: string }>;
  searchParams?: Promise<{ page?: string; view?: string }>;
};

function normalizeView(value: string | undefined): View {
  if (value === "turns" || value === "questions" || value === "topics") return value;
  return "questions";
}

function normalizePage(value: string | undefined): number {
  const page = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { city, id } = await params;
  const municipality = getMunicipality(city);
  const cityName = municipality?.name ?? city;
  if (
    municipality?.minutes_access === "restricted"
    || !(await getPublishedMinutesIndexItem(city, id))
  ) {
    return buildPageMetadata({
      title: `議事録 - ${cityName}議会`,
      description: `${cityName}議会の議事録`,
      path: `/${city}/minutes/${id}/turns`,
    });
  }
  return buildPageMetadata({
    title: `構造化議事録ビュー - ${cityName}議会`,
    description: `${cityName}議会の議事録を発言単位・質問者別・質問項目別に整理した試験版ビューです。`,
    path: `/${city}/minutes/${id}/turns`,
  });
}

export default async function StructuredMinutesPage({ params, searchParams }: Props) {
  const { city, id } = await params;
  const { page: rawPage, view: rawView } = (await searchParams) ?? {};
  const view = normalizeView(rawView);
  const page = normalizePage(rawPage);
  const municipality = getMunicipality(city);
  const cityName = municipality?.name ?? city;
  if (
    municipality?.minutes_access === "restricted"
    || !(await getPublishedMinutesIndexItem(city, id))
  ) {
    notFound();
  }
  const data = await getStructuredMinutes(city, id);
  if (!data) notFound();

  const publicTopicCount = data.topic_blocks.filter((topic) => topic.public_visible).length;
  const basePath = `/${city}/minutes/${id}/turns`;

  return (
    <div className="page-shell max-w-6xl">
      <HashTargetScroller />
      <nav className="mb-5 flex items-center gap-1.5 text-sm text-[#718096]">
        <Link href={`/${city}`} className="transition-colors hover:text-[#1B3A6B]">
          {cityName}議会
        </Link>
        <span aria-hidden="true">›</span>
        <Link href={`/${city}/minutes`} className="transition-colors hover:text-[#1B3A6B]">
          議事録
        </Link>
        <span aria-hidden="true">›</span>
        <Link href={`/${city}/minutes/${id}`} className="transition-colors hover:text-[#1B3A6B]">
          議事録詳細
        </Link>
        <span aria-hidden="true">›</span>
        <span className="text-[#1A202C]">構造化議事録ビュー</span>
      </nav>

      <header className="mb-5 rounded-lg border border-[#CBD5E0] bg-white p-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-[#E6C566] bg-[#FFF7D6] px-2 py-0.5 text-xs font-bold text-[#6B4C11]">
            試験版
          </span>
          <span className="text-xs text-[#718096]">{data.source_document.meeting_date}</span>
          <a
            href={data.source_document.official_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-bold text-[#1B3A6B] underline underline-offset-2"
          >
            公式URL
          </a>
        </div>
        <h1 className="text-2xl font-bold leading-tight text-[#1B3A6B]">
          {cityName}議会 構造化議事録ビュー
        </h1>
        <p className="mt-3 text-base leading-relaxed text-[#4A5568]">
          {data.source_document.title}を、公式会議録の原文に戻れる形で、発言単位・質問者別・質問項目別に整理した試験版です。
          発言本文と原文抜粋は公式会議録の原文を使っています。
        </p>
      </header>

      <SourceNotice sourceDocument={data.source_document} />

      <section className="mb-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-[#CBD5E0] bg-white p-4 shadow-sm">
          <p className="text-xs font-bold text-[#718096]">発言単位</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-[#1B3A6B]">
            {data.turns.length}
          </p>
        </div>
        <div className="rounded-lg border border-[#CBD5E0] bg-white p-4 shadow-sm">
          <p className="text-xs font-bold text-[#718096]">質問者別</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-[#1B3A6B]">
            {data.question_blocks.length}
          </p>
        </div>
        <div className="rounded-lg border border-[#CBD5E0] bg-white p-4 shadow-sm">
          <p className="text-xs font-bold text-[#718096]">公開質問項目</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-[#1B3A6B]">
            {publicTopicCount}
          </p>
        </div>
      </section>

      <StructuredMinutesTabs data={data} view={view} page={page} basePath={basePath} />
    </div>
  );
}
