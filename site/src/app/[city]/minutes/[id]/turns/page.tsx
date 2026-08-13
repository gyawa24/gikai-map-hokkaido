import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { notFound } from "next/navigation";
import HashTargetScroller from "@/components/structured-minutes/HashTargetScroller";
import SourceNotice from "@/components/structured-minutes/SourceNotice";
import StructuredMinutesTabs from "@/components/structured-minutes/StructuredMinutesTabs";
import { formatMeetingDate } from "@/components/structured-minutes/formatMeetingDate";
import { getMunicipality } from "@/lib/municipalities";
import { buildPageMetadata } from "@/lib/metadata";
import { getStructuredMinutes } from "@/lib/structured-minutes/loadStructuredMinutes";

type View = "turns" | "questions" | "topics";

type Props = {
  params: Promise<{ city: string; id: string }>;
  searchParams?: Promise<{
    page?: string | string[];
    view?: string | string[];
    q?: string | string[];
  }>;
};

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeView(value: string | string[] | undefined): View {
  value = firstValue(value);
  if (value === "turns" || value === "questions" || value === "topics") return value;
  return "questions";
}

function normalizePage(value: string | string[] | undefined): number {
  value = firstValue(value);
  const page = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

function normalizeQuery(value: string | string[] | undefined): string {
  return (firstValue(value) ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
}

function clearSearchHref(basePath: string, view: View): string {
  const params = new URLSearchParams({ view });
  return `${basePath}?${params.toString()}`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { city, id } = await params;
  const municipality = getMunicipality(city);
  const cityName = municipality?.name ?? city;
  return buildPageMetadata({
    title: `構造化議事録ビュー - ${cityName}議会`,
    description: `${cityName}議会の議事録を発言単位・質問者別・質問項目別に整理した試験版ビューです。`,
    path: `/${city}/minutes/${id}/turns`,
  });
}

export default async function StructuredMinutesPage({ params, searchParams }: Props) {
  const { city, id } = await params;
  const { page: rawPage, view: rawView, q: rawQuery } = (await searchParams) ?? {};
  const view = normalizeView(rawView);
  const page = normalizePage(rawPage);
  const query = normalizeQuery(rawQuery);
  const municipality = getMunicipality(city);
  const cityName = municipality?.name ?? city;
  const data = await getStructuredMinutes(city, id);
  if (!data) notFound();

  const publicTopicCount = data.topic_blocks.filter((topic) => topic.public_visible).length;
  const basePath = `/${city}/minutes/${id}/turns`;
  const meetingDates = [...new Set(data.turns.map((turn) => turn.meeting_date).filter(Boolean))]
    .sort();
  const meetingDateLabel = meetingDates.length > 1
    ? `${formatMeetingDate(meetingDates[0])}〜${formatMeetingDate(meetingDates.at(-1) ?? meetingDates[0])}`
    : formatMeetingDate(meetingDates[0] ?? data.source_document.meeting_date);

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
          <span className="text-xs text-[#718096]">開催期間: {meetingDateLabel}</span>
          <a
            href={data.source_document.official_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-bold text-[#1B3A6B] underline underline-offset-2"
          >
            公式会議録（初日・代表ページ）
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

      <Form
        action={basePath}
        className="mb-5 rounded-lg border border-[#CBD5E0] bg-white p-4 shadow-sm"
      >
        <input type="hidden" name="view" value={view} />
        <label htmlFor="structured-minutes-query" className="text-sm font-bold text-[#1B3A6B]">
          この会議録内を検索
        </label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input
            id="structured-minutes-query"
            name="q"
            type="search"
            maxLength={100}
            defaultValue={query}
            placeholder="発言者名、質問項目、本文の語句"
            className="min-h-11 min-w-0 flex-1 rounded-lg border border-[#CBD5E0] bg-white px-3 py-2 text-base text-[#1A202C] outline-none transition-colors placeholder:text-[#A0AEC0] focus:border-[#1B3A6B] focus:ring-2 focus:ring-[#C5D0E6]"
          />
          <button
            type="submit"
            className="min-h-11 rounded-full bg-[#1B3A6B] px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-[#142D54] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8AA3CF] focus-visible:ring-offset-2"
          >
            検索
          </button>
          {query && (
            <Link
              href={clearSearchHref(basePath, view)}
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-[#CBD5E0] bg-white px-4 py-2 text-sm font-bold text-[#1B3A6B] transition-colors hover:bg-[#E8EEF7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8AA3CF] focus-visible:ring-offset-2"
            >
              検索を解除
            </Link>
          )}
        </div>
        <p className="mt-2 text-sm leading-relaxed text-[#718096]">
          発言者・本文・質問タイトル・質問項目・分類タグ・原文抜粋を対象に検索します。
        </p>
      </Form>

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

      <StructuredMinutesTabs
        data={data}
        view={view}
        page={page}
        basePath={basePath}
        query={query}
      />
    </div>
  );
}
