import fs from "fs";
import path from "path";
import type { MinutesIndexItem } from "@/types/minutes";
import MinutesIndexClient from "@/components/MinutesIndexClient";

function getMinutesIndex(): MinutesIndexItem[] {
  const fp = path.join(process.cwd(), "data", "eniwa", "minutes", "index.json");
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

export default function EniwaMinutesPage() {
  const allItems = getMinutesIndex();
  const items = allItems.map((item) => ({
    ...item,
    enriched: null,
    category: categoryLabel(item.type_label),
  }));

  return (
    <div className="max-w-2xl mx-auto">
      <section className="mb-6">
        <h2 className="text-xl font-bold text-[#1B3A6B] mb-1">公式議事録</h2>
        <p className="text-base text-[#4A5568] leading-relaxed">
          恵庭市議会の公式会議録です。本会議・委員会の発言内容をすべて収録しています。
        </p>
      </section>

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
