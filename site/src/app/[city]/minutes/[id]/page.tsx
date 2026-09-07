import fs from "fs";
import path from "path";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import type { Metadata } from "next";
import type { MinutesSession, MinutesEnriched } from "@/types/minutes";
import MinutesDetailClient from "@/components/MinutesDetailClient";
import MinutesHeading from "@/components/MinutesHeading";
import MinutesSourceLink from "@/components/MinutesSourceLink";
import { getMinutesCatalogSource } from "@/lib/minutesSource";
import { isMinutesSession } from "@/lib/minutesSessionValidation";
import RemoteMinutesDetailClient from "@/components/RemoteMinutesDetailClient";
import StructuredMinutesCallout from "@/components/StructuredMinutesCallout";
import { getMunicipality } from "@/lib/municipalities";
import { buildPageMetadata } from "@/lib/metadata";
import {
  countMinutesContent,
  minutesContentLabel,
  minutesScheduleUnit,
  visibleMinutesEnriched,
} from "@/lib/minutesPresentation";
import { hasStructuredMinutes } from "@/lib/structured-minutes/loadStructuredMinutes";
import { getPublishedMinutesIndexItem, getPublishedMinutesIndexResult } from "@/lib/minutesPublication";

// Cloudflare Workers の静的アセットキャッシュは読み取り専用。
// 未生成の議事録ページは request-time render にして、ISR キャッシュ書き込みを避ける。
// データソースは local（ある場合）→ GitHub Raw URL（fallback）。
export const dynamicParams = true;
export const dynamic = "force-dynamic";

const REPO_OWNER = process.env.GIKAI_REPO_OWNER ?? "gyawa24";
const REPO_NAME = process.env.GIKAI_REPO_NAME ?? "gikai-map-hokkaido";
const REPO_BRANCH = process.env.GIKAI_REPO_BRANCH ?? "main";
const RAW_BASE = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${REPO_BRANCH}`;
const LOCAL_SESSION_PARSE_FILE_SIZE_THRESHOLD = 1_000_000;
const REMOTE_RENDER_SPEECH_THRESHOLD = 500;
const REMOTE_RENDER_TEXT_LENGTH_THRESHOLD = 300_000;

type SessionCandidate = {
  localPath: string;
  remotePath: string;
};

function rawUrl(remotePath: string): string {
  return `${RAW_BASE}/${remotePath}`;
}

async function fetchRawJson<T>(remotePath: string): Promise<T | null> {
  try {
    const res = await fetch(rawUrl(remotePath), { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function getSessionCandidates(city: string, id: string): SessionCandidate[] {
  return [
    {
      localPath: path.join(
        /*turbopackIgnore: true*/ process.cwd(),
        "data",
        city,
        "minutes",
        `${id}.json`
      ),
      remotePath: `site/data/${city}/minutes/${id}.json`,
    },
    {
      localPath: path.join(
        /*turbopackIgnore: true*/ process.cwd(),
        "data",
        city,
        `${id}.json`
      ),
      remotePath: `site/data/${city}/${id}.json`,
    },
  ];
}

function getLocalSessionCandidate(city: string, id: string): SessionCandidate | null {
  for (const candidate of getSessionCandidates(city, id)) {
    try {
      if (fs.existsSync(/*turbopackIgnore: true*/ candidate.localPath)) return candidate;
    } catch {
      // try next
    }
  }
  return null;
}

function isLargeLocalSession(candidate: SessionCandidate): boolean {
  try {
    return (
      fs.statSync(/*turbopackIgnore: true*/ candidate.localPath).size >
      LOCAL_SESSION_PARSE_FILE_SIZE_THRESHOLD
    );
  } catch {
    return false;
  }
}

function getLocalSession(city: string, id: string): MinutesSession | null {
  const candidate = getLocalSessionCandidate(city, id);
  if (!candidate) return null;
  try {
    const data: unknown = JSON.parse(
      fs.readFileSync(/*turbopackIgnore: true*/ candidate.localPath, "utf-8")
    );
    return isMinutesSession(data, id) ? data : null;
  } catch {
    return null;
  }
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
    // GitHub Raw fallback（enriched は欠損許容なので失敗で null）
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
  if (municipality?.minutes_access === "restricted") {
    return buildPageMetadata({
      title: `議事録 - ${cityName}議会`,
      description: `${cityName}議会の議事録`,
      path: `/${city}/minutes/${id}`,
    });
  }
  const indexItem = await getPublishedMinutesIndexItem(city, id);
  if (!indexItem) {
    return buildPageMetadata({
      title: `議事録 - ${cityName}議会`,
      description: `${cityName}議会の議事録`,
      path: `/${city}/minutes/${id}`,
    });
  }

  return buildPageMetadata({
    title: `${indexItem.name} - ${cityName}議会`,
    description: `${indexItem.type_label}（${indexItem.japanese_year}）。収録本文と公式原典を確認できます。`,
    path: `/${city}/minutes/${id}`,
  });
}

function MinutesPageShell({ city, cityName, children }: { city: string; cityName: string; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <nav aria-label="パンくず" className="mb-5 flex flex-wrap items-center gap-1.5 text-sm text-[#4A5568]">
        <a href={`/${city}`} className="underline hover:text-[#1B3A6B]">{cityName}議会</a>
        <span aria-hidden="true">›</span>
        <a href={`/${city}/minutes`} className="underline hover:text-[#1B3A6B]">議事録</a>
        <span aria-hidden="true">›</span>
        <span aria-current="page">会議録本文</span>
      </nav>
      {children}
    </div>
  );
}

function sessionTextLength(session: MinutesSession): number {
  return session.schedules.reduce(
    (scheduleTotal, schedule) =>
      scheduleTotal +
      schedule.minutes.reduce((minuteTotal, minute) => minuteTotal + minute.text.length, 0),
    0
  );
}

function shouldRenderClientLoadedSession(session: MinutesSession): boolean {
  return (
    countMinutesContent(session) > REMOTE_RENDER_SPEECH_THRESHOLD ||
    sessionTextLength(session) > REMOTE_RENDER_TEXT_LENGTH_THRESHOLD
  );
}

export default async function CityMinutesDetailPage({
  params,
}: {
  params: Promise<{ city: string; id: string }>;
}) {
  const { city, id } = await params;
  const municipality = getMunicipality(city);
  if (!municipality || !/^\d+$/u.test(id)) notFound();
  const cityName = municipality.name;

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
        <h1 className="theme-section-title mb-4 text-2xl leading-snug">
          {cityName}議会 議事録
        </h1>
        <div className="theme-alert px-5 py-5">
          <p className="text-base font-semibold text-[#7A5A00] mb-2">本サイトでの全文閲覧は一時停止中です</p>
          <p className="text-sm text-[#5A4500] leading-relaxed">
            {note ?? `${cityName}公式サイトの著作権ポリシーで複製・転用に事前許可を要する旨が明記されているため、許諾確認が取れるまで本サイトでの全文閲覧を停止しています。データは保管しており、許諾後に公開を再開します。`}
          </p>
          <p className="text-sm text-[#5A4500] leading-relaxed mt-3">
            {municipality?.minutes_official_url ? (
              <>
                会議録本体は{" "}
                <a
                  href={municipality.minutes_official_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-[#7A5A00]"
                >
                  {cityName}議会の公式ページ
                </a>
                からご覧ください。
              </>
            ) : (
              <>会議録本体は{cityName}議会の公式サイトからご覧ください。</>
            )}
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

  const publication = await getPublishedMinutesIndexResult(city, id);
  if (publication.status === "absent") notFound();
  const officialSource = getMinutesCatalogSource(municipality);
  if (publication.status !== "available") {
    return (
      <MinutesPageShell city={city} cityName={cityName}>
        <h1 className="mb-4 text-2xl font-bold text-[#1B3A6B]">{cityName}議会 議事録</h1>
        <div role="status" className="rounded-lg border border-[#F7C948] bg-[#FFF7E6] p-5 text-sm text-[#78451F]">
          <p>公開状況を一時的に確認できません。未掲載という意味ではありません。</p>
          <a href={`/${city}/minutes/${id}`} className="mt-3 inline-flex min-h-11 items-center font-semibold underline">再読み込み</a>
        </div>
        <MinutesSourceLink source={officialSource} />
      </MinutesPageShell>
    );
  }
  const indexItem = publication.item;
  const structuredMinutesHref = await hasStructuredMinutes(city, id)
    ? `/${city}/minutes/${id}/turns`
    : undefined;
  const localCandidate = getLocalSessionCandidate(city, id);
  const session = localCandidate && !isLargeLocalSession(localCandidate) ? getLocalSession(city, id) : null;
  if (!session || shouldRenderClientLoadedSession(session)) {
    return (
      <MinutesPageShell city={city} cityName={cityName}>
        <Suspense>
          <RemoteMinutesDetailClient
            cityName={cityName}
            sessionUrl={rawUrl(localCandidate?.remotePath ?? `site/data/${city}/minutes/${id}.json`)}
            fallbackSessionUrl={localCandidate ? undefined : rawUrl(`site/data/${city}/${id}.json`)}
            enrichedUrl={rawUrl(`site/data/${city}/minutes/enriched/${id}.json`)}
            initialSession={indexItem}
            structuredMinutesHref={structuredMinutesHref}
            officialSource={officialSource}
          />
        </Suspense>
      </MinutesPageShell>
    );
  }
  const enriched = visibleMinutesEnriched(session, await getEnriched(city, id));
  return (
    <MinutesPageShell city={city} cityName={cityName}>
      <MinutesHeading name={session.name} cityName={cityName} japaneseYear={session.japanese_year}
        scheduleCount={session.schedules.length} scheduleUnit={minutesScheduleUnit(session)} contentLabel={minutesContentLabel(session)}
        indexItem={indexItem} officialSource={officialSource} />
      {structuredMinutesHref && <StructuredMinutesCallout href={structuredMinutesHref} />}
      <Suspense>
        <MinutesDetailClient session={session} enriched={enriched} cityName={cityName} officialSource={officialSource} />
      </Suspense>
    </MinutesPageShell>
  );
}
