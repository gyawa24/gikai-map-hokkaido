import fs from "fs";
import path from "path";
import Link from "next/link";
import type { MinutesIndexItem } from "@/types/minutes";

function getMinutesIndex(): MinutesIndexItem[] {
  const fp = path.join(process.cwd(), "data", "chitose", "minutes", "index.json");
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as MinutesIndexItem[];
  } catch {
    return [];
  }
}

function categoryLabel(typeLabel: string): string {
  if (typeLabel.includes("定例会") && !typeLabel.includes("補正") && !typeLabel.includes("委員会")) return "本会議・定例会";
  if (typeLabel.includes("臨時会")) return "本会議・臨時会";
  if (typeLabel.includes("予算特別委員会")) return "予算特別委員会";
  if (typeLabel.includes("決算特別委員会")) return "決算特別委員会";
  if (typeLabel.includes("委員会")) return "委員会";
  return "その他";
}

const CATEGORY_ORDER = [
  "本会議・定例会",
  "本会議・臨時会",
  "予算特別委員会",
  "決算特別委員会",
  "委員会",
  "その他",
];

export default function ChitoseMinutesPage() {
  const allItems = getMinutesIndex();

  // 年でグルーピング
  const byYear: Record<string, MinutesIndexItem[]> = {};
  for (const item of allItems) {
    const y = item.japanese_year;
    if (!byYear[y]) byYear[y] = [];
    byYear[y].push(item);
  }
  const years = Object.keys(byYear).sort((a, b) => b.localeCompare(a));

  return (
    <div className="max-w-2xl mx-auto">
      <section className="mb-6">
        <h2 className="text-xl font-bold text-[#1B3A6B] mb-1">公式議事録</h2>
        <p className="text-base text-[#4A5568] leading-relaxed">
          千歳市議会の公式会議録です。本会議・委員会の発言内容をすべて収録しています。
        </p>
      </section>

      {/* 速報との関係説明 */}
      <div className="bg-[#E8EEF7] rounded-lg p-4 mb-6 flex gap-3">
        <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-[#2A5298] shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <p className="text-sm text-[#4A5568] leading-relaxed">
          公式議事録は会議から約2ヶ月後に発行されます。
          直近の会議は
          <Link href="/chitose/sessions" className="text-[#2A5298] hover:text-[#1B3A6B] underline decoration-[#CBD5E0] mx-1">会議録・速報</Link>
          でYouTube動画の文字起こしと要約を閲覧できます。
        </p>
      </div>

      {years.length === 0 ? (
        <div className="bg-white rounded-lg border border-[#CBD5E0] p-8 text-center text-[#718096]">
          現在、掲載されている議事録はありません。
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {years.map((year) => {
            const items = byYear[year];
            // カテゴリごとにグルーピング
            const byCategory: Record<string, MinutesIndexItem[]> = {};
            for (const item of items) {
              const cat = categoryLabel(item.type_label);
              if (!byCategory[cat]) byCategory[cat] = [];
              byCategory[cat].push(item);
            }
            const cats = CATEGORY_ORDER.filter((c) => byCategory[c]);

            return (
              <section key={year}>
                <h3 className="text-base font-bold text-[#1B3A6B] mb-3 flex items-center gap-2">
                  <span className="inline-block w-1 h-4 bg-[#1B3A6B] rounded-full" aria-hidden="true" />
                  {year}
                </h3>
                <div className="flex flex-col gap-6">
                  {cats.map((cat) => (
                    <div key={cat}>
                      <p className="text-xs font-semibold text-[#718096] uppercase tracking-wider mb-2 pl-1">{cat}</p>
                      <div className="flex flex-col gap-2">
                        {byCategory[cat].map((item) => (
                          <Link
                            key={item.council_id}
                            href={`/chitose/minutes/${item.council_id}`}
                            className="group bg-white rounded-lg border border-[#CBD5E0] hover:border-[#1B3A6B] px-5 py-4 shadow-sm hover:shadow-md transition-all duration-150 flex items-center gap-4"
                          >
                            <div
                              className="w-1 self-stretch rounded-full shrink-0 bg-[#1B3A6B] opacity-20 group-hover:opacity-100 transition-opacity"
                              aria-hidden="true"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-base font-semibold text-[#1A202C] leading-snug">{item.name}</p>
                            </div>
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="w-5 h-5 text-[#CBD5E0] group-hover:text-[#1B3A6B] shrink-0 transition-colors"
                              viewBox="0 0 24 24" fill="none" stroke="currentColor"
                              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                              aria-hidden="true"
                            >
                              <polyline points="9 18 15 12 9 6" />
                            </svg>
                          </Link>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
