import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getSessionSummaries } from "@/lib/cityData";
import { getMunicipality } from "@/lib/municipalities";
import { buildPageMetadata } from "@/lib/metadata";
import SessionsClient from "@/components/SessionsClient";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string }>;
}): Promise<Metadata> {
  const { city } = await params;
  const municipality = getMunicipality(city);
  const cityName = municipality?.name ?? city;
  return buildPageMetadata({
    title: `会議録・速報 - ${cityName}`,
    description: `${cityName}議会の会議録・速報版です。議会中継動画や録画配信の文字起こし、要約、発言ごとの話題を確認できます。`,
    path: `/${city}/sessions`,
  });
}

export default async function CitySessionsPage({
  params,
}: {
  params: Promise<{ city: string }>;
}) {
  const { city } = await params;
  const municipality = getMunicipality(city);
  if (!municipality?.features.includes("sessions")) notFound();

  const sessions = getSessionSummaries(city);

  // speakers に登場する議員苗字を集計（フィルタUIに使用）
  const allSpeakers = [
    ...new Set(sessions.flatMap((s) => s.speakers ?? [])),
  ].sort();

  return (
    <div className="max-w-2xl mx-auto">
      <section className="mb-6">
        <h2 className="text-xl font-bold text-[#1B3A6B] mb-1">会議録・速報</h2>
        <p className="text-base text-[#4A5568] leading-relaxed mb-3">
          議会中継動画や録画配信の文字起こしと要約を掲載しています。公式議事録の発行までの速報版です。
        </p>
        <Link
          href={`/${city}/minutes`}
          className="inline-flex items-center gap-1.5 text-sm text-[#2A5298] hover:text-[#1B3A6B] transition-colors"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          公式議事録はこちら
        </Link>
      </section>

      {sessions.length === 0 ? (
        <div className="bg-white rounded-lg border border-[#CBD5E0] p-8 text-center text-[#718096]">
          現在、掲載されている動画はありません。
        </div>
      ) : (
        <SessionsClient sessions={sessions} city={city} allSpeakers={allSpeakers} />
      )}
    </div>
  );
}
