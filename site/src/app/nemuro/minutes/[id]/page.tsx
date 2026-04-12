import fs from "fs";
import path from "path";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import type { Metadata } from "next";
import type { MinutesSession, MinutesIndexItem, MinutesEnriched } from "@/types/minutes";
import MinutesDetailClient from "@/components/MinutesDetailClient";

function getSession(id: string): MinutesSession | null {
  const fp = path.join(process.cwd(), "data", "nemuro", "minutes", `${id}.json`);
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as MinutesSession;
  } catch {
    return null;
  }
}

function getEnriched(id: string): MinutesEnriched | null {
  const fp = path.join(process.cwd(), "data", "nemuro", "minutes", "enriched", `${id}.json`);
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as MinutesEnriched;
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
  const enriched = getEnriched(id);

  const title = session
    ? `${session.name} | 根室市議会 | 北海道議会情報マップ`
    : "議事録 | 根室市議会 | 北海道議会情報マップ";
  const description = enriched?.summary
    ? enriched.summary.slice(0, 100)
    : session
    ? `${session.type_label}（${session.japanese_year}）`
    : "根室市議会の議事録";

  return {
    title,
    description,
    openGraph: { title, description },
    twitter: { card: "summary" },
  };
}

export async function generateStaticParams() {
  const fp = path.join(process.cwd(), "data", "nemuro", "minutes", "index.json");
  try {
    const index = JSON.parse(fs.readFileSync(fp, "utf-8")) as MinutesIndexItem[];
    return index.map((item) => ({ id: String(item.council_id) }));
  } catch {
    return [];
  }
}

function typeCategory(typeLabel: string): string {
  if (typeLabel.includes("定例会") && !typeLabel.includes("補正") && !typeLabel.includes("委員会")) return "定例会";
  if (typeLabel.includes("臨時会")) return "臨時会";
  if (typeLabel.includes("委員会")) return "委員会";
  return "";
}

export default async function NemuroMinutesDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) notFound();

  const enriched = getEnriched(id);
  const category = typeCategory(session.type_label);

  const totalSpeeches = session.schedules.reduce(
    (acc, s) => acc + s.minutes.filter((m) => m.minute_type !== "名簿").length,
    0
  );

  return (
    <div className="max-w-2xl mx-auto">
      <nav className="text-sm text-[#718096] mb-5 flex items-center gap-1.5">
        <a href="/nemuro" className="hover:text-[#1B3A6B] transition-colors">根室市議会</a>
        <span aria-hidden="true">›</span>
        <a href="/nemuro/minutes" className="hover:text-[#1B3A6B] transition-colors">議事録</a>
        <span aria-hidden="true">›</span>
        <span className="text-[#1A202C]" aria-current="page">{session.name.slice(0, 20)}</span>
      </nav>
      <section className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          {category && (
            <span className="text-xs font-semibold px-2 py-0.5 bg-[#E8EEF7] text-[#2A5298] rounded">
              {category}
            </span>
          )}
          <span className="text-xs text-[#718096]">{session.japanese_year}</span>
        </div>
        <h2 className="text-xl font-bold text-[#1B3A6B] leading-snug mb-2">
          {session.name}
        </h2>
        <div className="flex flex-wrap gap-4 text-sm text-[#4A5568]">
          <span className="inline-flex items-center gap-1.5">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-[#2A5298]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            {session.schedules.length}日程
          </span>
          <span className="inline-flex items-center gap-1.5">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-[#2A5298]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            {totalSpeeches}件の発言・議題
          </span>
        </div>
      </section>

      <Suspense>
        <MinutesDetailClient session={session} enriched={enriched} />
      </Suspense>
    </div>
  );
}
