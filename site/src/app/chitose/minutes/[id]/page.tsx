import fs from "fs";
import path from "path";
import { notFound } from "next/navigation";
import type { MinutesSession, MinutesIndexItem, MinutesEnriched } from "@/types/minutes";
import MinutesReader from "@/components/MinutesReader";

function getSession(id: string): MinutesSession | null {
  const fp = path.join(process.cwd(), "data", "chitose", "minutes", `${id}.json`);
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as MinutesSession;
  } catch {
    return null;
  }
}

function getEnriched(id: string): MinutesEnriched | null {
  const fp = path.join(process.cwd(), "data", "chitose", "minutes", "enriched", `${id}.json`);
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as MinutesEnriched;
  } catch {
    return null;
  }
}

export async function generateStaticParams() {
  const fp = path.join(process.cwd(), "data", "chitose", "minutes", "index.json");
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

const ROLE_ORDER: Record<string, number> = {
  "議長": 0, "市長": 1, "副市長": 2, "議員": 3, "理事者": 4, "その他": 5,
};

export default async function MinutesDetailPage({
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

  const memberSpeakers = enriched?.speakers
    .filter((s) => s.role === "議員")
    .sort((a, b) => b.speech_count - a.speech_count) ?? [];

  const officialSpeakers = enriched?.speakers
    .filter((s) => s.role !== "議員" && s.role !== "その他")
    .sort((a, b) => (ROLE_ORDER[a.role] ?? 5) - (ROLE_ORDER[b.role] ?? 5)) ?? [];

  return (
    <div className="max-w-2xl mx-auto">
      {/* ヘッダー */}
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

      {/* AI要約セクション */}
      {enriched ? (
        <section className="mb-6 space-y-4">
          {/* 要約 */}
          <div className="bg-[#E8EEF7] rounded-lg p-5">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-bold text-[#2A5298]">✦ AI要約</span>
            </div>
            <p className="text-base text-[#1A202C] leading-relaxed mb-3">
              {enriched.summary}
            </p>
            {enriched.highlights.length > 0 && (
              <ul className="space-y-1">
                {enriched.highlights.map((h, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-[#4A5568]">
                    <span className="text-[#2A5298] shrink-0 mt-0.5">·</span>
                    {h}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* タグ */}
          {enriched.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {enriched.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-xs px-2.5 py-1 bg-white border border-[#CBD5E0] text-[#4A5568] rounded-full"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* 発言した議員 */}
          {(memberSpeakers.length > 0 || enriched.questioners.length > 0) && (
            <div className="bg-white rounded-lg border border-[#CBD5E0] p-4 shadow-sm">
              <h3 className="text-sm font-bold text-[#1B3A6B] mb-3">質問に立った議員</h3>
              <div className="space-y-2">
                {enriched.questioners.length > 0 ? (
                  enriched.questioners.map((q) => (
                    <div key={q.name} className="flex items-start gap-2">
                      <span className="text-sm font-medium text-[#1A202C] shrink-0 w-28">{q.name}</span>
                      <div className="flex flex-wrap gap-1">
                        {q.topics.map((t) => (
                          <span key={t} className="text-xs px-2 py-0.5 bg-[#E8EEF7] text-[#2A5298] rounded-full">{t}</span>
                        ))}
                      </div>
                    </div>
                  ))
                ) : (
                  memberSpeakers.map((s) => (
                    <div key={s.name} className="flex items-center gap-2">
                      <span className="text-sm text-[#1A202C]">{s.name}</span>
                      <span className="text-xs text-[#718096]">{s.speech_count}回</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* 理事者・執行部 */}
          {officialSpeakers.length > 0 && (
            <div className="bg-white rounded-lg border border-[#CBD5E0] p-4 shadow-sm">
              <h3 className="text-sm font-bold text-[#1B3A6B] mb-3">答弁した執行部</h3>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {officialSpeakers.map((s) => (
                  <div key={s.name} className="flex items-center gap-1.5">
                    <span className="text-xs text-[#718096]">{s.role}</span>
                    <span className="text-sm text-[#1A202C]">{s.name.replace(/[◎○]/g, "")}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-xs text-[#A0AEC0] text-right">AI要約生成日: {enriched.generated_at}</p>
        </section>
      ) : (
        <div className="mb-6 bg-[#F4F6F9] rounded-lg p-4 border border-dashed border-[#CBD5E0]">
          <p className="text-sm text-[#718096] text-center">
            要約・タグ・発言者リストを準備中です
          </p>
        </div>
      )}

      <MinutesReader session={session} />
    </div>
  );
}
