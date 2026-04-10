import fs from "fs";
import path from "path";
import Link from "next/link";
import type { MinutesIndexItem, MinutesEnriched } from "@/types/minutes";
import MinutesIndexClient from "@/components/MinutesIndexClient";

function getMinutesIndex(): MinutesIndexItem[] {
  const fp = path.join(process.cwd(), "data", "chitose", "minutes", "index.json");
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as MinutesIndexItem[];
  } catch {
    return [];
  }
}

function getEnriched(councilId: number): MinutesEnriched | null {
  const fp = path.join(process.cwd(), "data", "chitose", "minutes", "enriched", `${councilId}.json`);
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as MinutesEnriched;
  } catch {
    return null;
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

export default function ChitoseMinutesPage() {
  const allItems = getMinutesIndex();

  const items = allItems.map((item) => ({
    ...item,
    enriched: getEnriched(item.council_id),
    category: categoryLabel(item.type_label),
  }));

  const enrichedCount = items.filter((i) => i.enriched).length;

  return (
    <div className="max-w-2xl mx-auto">
      <section className="mb-6">
        <h2 className="text-xl font-bold text-[#1B3A6B] mb-1">公式議事録</h2>
        <p className="text-base text-[#4A5568] leading-relaxed">
          千歳市議会の公式会議録です。本会議・委員会の発言内容をすべて収録しています。
          {enrichedCount > 0 && (
            <span className="text-sm text-[#718096]">
              {" "}（{enrichedCount}件にAI要約・タグあり）
            </span>
          )}
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

      {items.length === 0 ? (
        <div className="bg-white rounded-lg border border-[#CBD5E0] p-8 text-center text-[#718096]">
          現在、掲載されている議事録はありません。
        </div>
      ) : (
        <MinutesIndexClient items={items} />
      )}
    </div>
  );
}
