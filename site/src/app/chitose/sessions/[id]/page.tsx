import fs from "fs";
import path from "path";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { Session, SessionSummary } from "@/types/session";
import TranscriptSegment from "@/components/TranscriptSegment";

function getSession(id: string): Session | null {
  const fp = path.join(process.cwd(), "data", "chitose", "sessions", `${id}.json`);
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as Session;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const session = getSession(id);

  if (!session) {
    return {
      title: "会議録 | 千歳市議会 | 北海道議会情報マップ",
    };
  }

  const dateLabel = formatDate(session.date);
  const title = `${session.title}（${dateLabel}）| 千歳市議会 | 北海道議会情報マップ`;

  const firstSummary = session.segments.find((s) => s.summary)?.summary;
  const description = firstSummary
    ? firstSummary.slice(0, 100)
    : session.committee
    ? `${session.committee} — ${dateLabel}の会議録`
    : `千歳市議会 ${dateLabel}の会議録`;

  return {
    title,
    description,
    openGraph: { title, description },
    twitter: { card: "summary" },
  };
}

export async function generateStaticParams() {
  const fp = path.join(process.cwd(), "data", "chitose", "sessions", "index.json");
  try {
    const index = JSON.parse(fs.readFileSync(fp, "utf-8")) as SessionSummary[];
    return index.map((s) => ({ id: s.id }));
  } catch {
    return [];
  }
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) notFound();

  const hasContent = session.segments.length > 0;

  return (
    <div className="max-w-2xl mx-auto">
      {/* タイトル */}
      <section className="mb-5">
        {session.committee && (
          <p className="text-sm text-[#718096] mb-1">{session.committee}</p>
        )}
        <h2 className="text-xl font-bold text-[#1B3A6B] leading-snug mb-1">
          {session.title}
        </h2>
        <p className="text-sm text-[#4A5568]">{formatDate(session.date)}</p>
      </section>

      {/* YouTube */}
      <div className="mb-6 rounded-lg overflow-hidden border border-[#CBD5E0] shadow-sm">
        <div className="relative bg-black" style={{ paddingBottom: "56.25%" }}>
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
                <path d="M8 5v14l11-7z"/>
              </svg>
              YouTubeで視聴
            </a>
          </div>
        </div>
      </div>

      {/* セグメント一覧 */}
      {hasContent ? (
        <div className="flex flex-col gap-4">
          <h3 className="text-base font-bold text-[#1B3A6B]">
            要約・文字起こし
            <span className="ml-2 text-sm font-normal text-[#718096]">
              （{session.segments.length}部構成）
            </span>
          </h3>
          {session.segments.map((seg) => (
            <TranscriptSegment key={seg.index} seg={seg} />
          ))}
          {session.generated_at && (
            <p className="text-xs text-[#718096] text-right">
              要約生成日: {session.generated_at}
            </p>
          )}
        </div>
      ) : (
        <div className="bg-[#E8EEF7] rounded-lg p-6 text-center">
          <p className="text-base font-medium text-[#1B3A6B] mb-1">文字起こし準備中</p>
          <p className="text-sm text-[#4A5568]">
            文字起こしデータが追加されると、要約と全文が表示されます。
          </p>
        </div>
      )}
    </div>
  );
}
