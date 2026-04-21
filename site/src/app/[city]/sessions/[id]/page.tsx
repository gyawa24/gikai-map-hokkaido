import fs from "fs";
import path from "path";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { Session, SessionSummary } from "@/types/session";
import type { Member } from "@/types/member";
import TranscriptSegment from "@/components/TranscriptSegment";
import { getMunicipality } from "@/lib/municipalities";

export const dynamic = "force-static";
export const dynamicParams = false;

function getSession(city: string, id: string): Session | null {
  const fp = path.join(process.cwd(), "data", city, "sessions", `${id}.json`);
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as Session;
  } catch {
    return null;
  }
}

function getMembers(city: string): Member[] {
  const fp = path.join(process.cwd(), "data", city, "members.json");
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as Member[];
  } catch {
    return [];
  }
}

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
  const title = `${session.title}（${dateLabel}）- ${cityName}議会`;
  const firstSummary = session.segments.find((s) => s.summary)?.summary;
  const description = firstSummary
    ? firstSummary.slice(0, 100)
    : session.committee
    ? `${session.committee} — ${dateLabel}の会議録`
    : `${cityName}議会 ${dateLabel}の会議録`;

  const ogImage = `/api/og-segment?city=${city}&session=${id}&seg=1`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [{ url: ogImage, width: 1200, height: 630 }],
    },
    twitter: { card: "summary_large_image" },
  };
}

export async function generateStaticParams({
  params,
}: {
  params: { city: string };
}) {
  const { city } = params;
  const fp = path.join(process.cwd(), "data", city, "sessions", "index.json");
  try {
    const index = JSON.parse(fs.readFileSync(fp, "utf-8")) as SessionSummary[];
    return index.map((s) => ({ id: s.id }));
  } catch {
    return [];
  }
}

export default async function CitySessionPage({
  params,
}: {
  params: Promise<{ city: string; id: string }>;
}) {
  const { city, id } = await params;
  const municipality = getMunicipality(city);
  if (!municipality?.features.includes("sessions")) notFound();

  const session = getSession(city, id);
  if (!session) notFound();

  const members = getMembers(city);
  const hasContent = session.segments.length > 0;

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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://img.youtube.com/vi/${session.youtube_id}/maxresdefault.jpg`}
            alt={session.title}
            className="absolute inset-0 w-full h-full object-cover opacity-80"
          />
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <a
              href={`https://www.youtube.com/watch?v=${session.youtube_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 bg-[#FF0000] hover:bg-[#cc0000] text-white font-bold px-5 py-3 rounded-full shadow-lg transition-colors text-sm"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                <path d="M8 5v14l11-7z" />
              </svg>
              YouTubeで視聴
            </a>
          </div>
        </div>
      </div>

      {hasContent ? (
        <div className="flex flex-col gap-4">
          <h3 className="text-base font-bold text-[#1B3A6B]">
            要約・文字起こし
            <span className="ml-2 text-sm font-normal text-[#718096]">
              （{session.segments.length}部構成）
            </span>
          </h3>
          {session.segments.map((seg) => (
            <TranscriptSegment key={seg.index} seg={seg} members={members} />
          ))}
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
