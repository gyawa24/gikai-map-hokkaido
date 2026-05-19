import { notFound } from "next/navigation";
import type { Metadata } from "next";
import TranscriptSegment from "@/components/TranscriptSegment";
import AIDisclaimer from "@/components/AIDisclaimer";
import FullTranscriptBlock from "@/components/FullTranscriptBlock";
import { getMembers, getSession, getSessionSummaries } from "@/lib/cityData";
import { hasCityCapability } from "@/lib/cityCapabilities";
import { getMunicipality } from "@/lib/municipalities";
import {
  getSessionSourceLabel,
  getSessionThumbnailUrl,
  getSessionWatchUrl,
} from "@/lib/sessionSources";
import { buildPageMetadata } from "@/lib/metadata";

export const dynamicParams = false;

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string; id: string }>;
}): Promise<Metadata> {
  const { city, id } = await params;
  const municipality = getMunicipality(city);
  const cityName = municipality?.name ?? city;
  const session = getSession(city, id);

  if (!session) {
    return { title: `会議録 - ${cityName}議会` };
  }

  const dateLabel = formatDate(session.date);
  const title = `${session.title}（${dateLabel}） - ${cityName}議会`;
  const firstSummary = session.segments.find((s) => s.summary)?.summary;
  const description = firstSummary
    ? firstSummary.slice(0, 100)
    : session.committee
    ? `${session.committee} — ${dateLabel}の会議録`
    : `${cityName}議会 ${dateLabel}の会議録`;

  const ogImage = `/api/og-segment?city=${city}&session=${id}&seg=1`;

  return buildPageMetadata({
    title,
    description,
    path: `/${city}/sessions/${id}`,
    image: ogImage,
  });
}

export async function generateStaticParams() {
  const { getMunicipalities } = await import("@/lib/municipalities");
  const { getCityCapability } = await import("@/lib/cityCapabilities");
  const params: { city: string; id: string }[] = [];
  for (const m of getMunicipalities()) {
    if (!m.active) continue;
    if (!getCityCapability(m.slug).capabilities.sessions) continue;
    for (const session of getSessionSummaries(m.slug)) {
      params.push({ city: m.slug, id: session.id });
    }
  }
  return params;
}

export default async function CitySessionPage({
  params,
}: {
  params: Promise<{ city: string; id: string }>;
}) {
  const { city, id } = await params;
  const municipality = getMunicipality(city);
  if (!municipality || !hasCityCapability(city, "sessions")) notFound();

  const session = getSession(city, id);
  if (!session) notFound();

  const members = getMembers(city);
  const hasSegments = session.segments.length > 0;
  const hasFullTranscript = !!session.full_transcript?.trim();
  const hasContent = hasSegments || hasFullTranscript;
  const cityName = municipality.name;
  const watchUrl = getSessionWatchUrl(session);
  const watchLabel = getSessionSourceLabel(session);
  const thumbnailUrl = getSessionThumbnailUrl(session, "hero");

  return (
    <div className="max-w-2xl mx-auto">
      <section className="mb-5">
        {session.committee && (
          <p className="text-sm text-[#718096] mb-1">{session.committee}</p>
        )}
        <h2 className="text-xl font-bold text-[#1B3A6B] leading-snug mb-1">
          {session.title}
        </h2>
        <p className="text-sm text-[#4A5568]">{formatDate(session.date)}</p>
      </section>

      <div className="mb-6 rounded-lg overflow-hidden border border-[#CBD5E0] shadow-sm">
        <div className="relative bg-black" style={{ paddingBottom: "56.25%" }}>
          {thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumbnailUrl}
              alt={session.title}
              className="absolute inset-0 w-full h-full object-cover opacity-80"
            />
          ) : (
            <div className="absolute inset-0 bg-[linear-gradient(135deg,#102A43,#2A5298)] opacity-95" />
          )}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            {watchUrl ? (
              <a
                href={watchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 bg-[#FF0000] hover:bg-[#cc0000] text-white font-bold px-5 py-3 rounded-full shadow-lg transition-colors text-sm"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                  <path d="M8 5v14l11-7z" />
                </svg>
                {watchLabel}
              </a>
            ) : (
              <div className="flex items-center gap-2 bg-white/15 text-white font-bold px-5 py-3 rounded-full shadow-lg text-sm">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                  <path d="M8 5v14l11-7z" />
                </svg>
                視聴リンク未設定
              </div>
            )}
          </div>
        </div>
      </div>

      {hasContent ? (
        <div className="flex flex-col gap-4">
          <AIDisclaimer sourceLabel={watchLabel} />
          {hasFullTranscript && (
            <FullTranscriptBlock transcript={session.full_transcript ?? ""} />
          )}
          {hasSegments && (
            <>
              <h3 className="text-base font-bold text-[#1B3A6B]">
                要約・文字起こし
                <span className="ml-2 text-sm font-normal text-[#718096]">
                  （{session.segments.length}部構成）
                </span>
              </h3>
              {session.segments.map((seg) => (
                <TranscriptSegment
                  key={seg.index}
                  seg={seg}
                  members={members}
                  city={city}
                  sessionId={id}
                  cityName={cityName}
                  sessionTitle={session.title}
                />
              ))}
            </>
          )}
          {session.generated_at && (
            <p className="text-xs text-[#718096] text-right">
              要約生成日: {session.generated_at}
            </p>
          )}
        </div>
      ) : (
        <div className="bg-[#E8EEF7] rounded-lg p-6 text-center">
          <p className="text-base font-medium text-[#1B3A6B] mb-1">
            文字起こし準備中
          </p>
          <p className="text-sm text-[#4A5568]">
            文字起こしデータが追加されると、要約と全文が表示されます。
          </p>
        </div>
      )}
    </div>
  );
}
