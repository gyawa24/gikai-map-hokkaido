import fs from "fs";
import path from "path";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { SessionSummary } from "@/types/session";
import { getMunicipality } from "@/lib/municipalities";
import SessionsClient from "@/components/SessionsClient";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string }>;
}): Promise<Metadata> {
  const { city } = await params;
  const municipality = getMunicipality(city);
  const cityName = municipality?.name ?? city;
  return { title: `会議録・速報 | 北海道議会情報マップ - ${cityName}` };
}

function getSessions(city: string): SessionSummary[] {
  const fp = path.join(process.cwd(), "data", city, "sessions", "index.json");
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as SessionSummary[];
  } catch {
    return [];
  }
}

export default async function CitySessionsPage({
  params,
}: {
  params: Promise<{ city: string }>;
}) {
  const { city } = await params;
  const municipality = getMunicipality(city);
  if (!municipality?.features.includes("sessions")) notFound();

  const sessions = getSessions(city);

  // speakers に登場する議員苗字を集計（フィルタUIに使用）
  const allSpeakers = [
    ...new Set(sessions.flatMap((s) => s.speakers ?? [])),
  ].sort();

  return (
    <div className="max-w-2xl mx-auto">
      <section className="mb-6">
        <h2 className="text-xl font-bold text-[#1B3A6B] mb-1">会議録・速報</h2>
        <p className="text-base text-[#4A5568] leading-relaxed mb-3">
          YouTube中継動画の文字起こしと要約を掲載しています。公式議事録の発行（約2ヶ月後）までの速報版です。
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
