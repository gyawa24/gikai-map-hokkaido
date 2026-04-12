import fs from "fs";
import path from "path";
import type { MinutesIndexItem, MinutesEnriched } from "@/types/minutes";
import MinutesIndexClient from "@/components/MinutesIndexClient";

function getMinutesIndex(): MinutesIndexItem[] {
  const fp = path.join(process.cwd(), "data", "nemuro", "minutes", "index.json");
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as MinutesIndexItem[];
  } catch {
    return [];
  }
}

function getEnriched(councilId: number): MinutesEnriched | null {
  const fp = path.join(process.cwd(), "data", "nemuro", "minutes", "enriched", `${councilId}.json`);
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

export default function NemuroMinutesPage() {
  const allItems = getMinutesIndex();
  const items = allItems.map((item) => ({
    ...item,
    enriched: getEnriched(item.council_id),
    category: categoryLabel(item.type_label),
  }));

  return (
    <div className="max-w-2xl mx-auto">
      <nav className="text-sm text-[#718096] mb-5 flex items-center gap-1.5">
        <a href="/nemuro" className="hover:text-[#1B3A6B] transition-colors">根室市議会</a>
        <span aria-hidden="true">›</span>
        <span className="text-[#1A202C]" aria-current="page">議事録</span>
      </nav>
      <section className="mb-6">
        <h2 className="text-xl font-bold text-[#1B3A6B] mb-1">公式議事録</h2>
        <p className="text-base text-[#4A5568] leading-relaxed">
          根室市議会の公式会議録です。本会議・委員会の発言内容をすべて収録しています。
          {items.length > 0 && (
            <span className="block mt-1 text-sm text-[#718096]">{items.length}件の会議録を掲載中</span>
          )}
        </p>
      </section>

      {items.length === 0 ? (
        <div className="bg-white rounded-lg border border-[#CBD5E0] p-8 text-center text-[#718096]">
          現在、掲載されている議事録はありません。
        </div>
      ) : (
        <MinutesIndexClient items={items} minutesBasePath="/nemuro/minutes" />
      )}
    </div>
  );
}
