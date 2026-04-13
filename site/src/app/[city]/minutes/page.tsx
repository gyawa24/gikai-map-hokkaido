import fs from "fs";
import path from "path";
import type { MinutesIndexItem, MinutesEnriched } from "@/types/minutes";
import MinutesIndexClient from "@/components/MinutesIndexClient";
import { getMunicipality } from "@/lib/municipalities";

function getMinutesIndex(city: string): MinutesIndexItem[] {
  const fp = path.join(process.cwd(), "data", city, "minutes", "index.json");
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as MinutesIndexItem[];
  } catch {
    return [];
  }
}

function getEnriched(city: string, councilId: number): MinutesEnriched | null {
  const fp = path.join(
    process.cwd(),
    "data",
    city,
    "minutes",
    "enriched",
    `${councilId}.json`
  );
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as MinutesEnriched;
  } catch {
    return null;
  }
}

function categoryLabel(typeLabel: string): string {
  if (
    typeLabel.includes("定例会") &&
    !typeLabel.includes("補正") &&
    !typeLabel.includes("委員会")
  )
    return "本会議・定例会";
  if (typeLabel.includes("臨時会")) return "本会議・臨時会";
  if (typeLabel.includes("予算特別委員会")) return "予算特別委員会";
  if (typeLabel.includes("決算特別委員会")) return "決算特別委員会";
  if (typeLabel.includes("委員会")) return "委員会";
  return "その他";
}

export default async function CityMinutesPage({
  params,
}: {
  params: Promise<{ city: string }>;
}) {
  const { city } = await params;
  const municipality = getMunicipality(city);
  const cityName = municipality?.name ?? city;

  const allItems = getMinutesIndex(city);
  const items = allItems.map((item) => ({
    ...item,
    enriched: getEnriched(city, item.council_id),
    category: categoryLabel(item.type_label),
  }));

  const enrichedCount = items.filter((i) => i.enriched).length;

  return (
    <div className="max-w-2xl mx-auto">
      <section className="mb-6">
        <h2 className="text-xl font-bold text-[#1B3A6B] mb-1">公式議事録</h2>
        <p className="text-base text-[#4A5568] leading-relaxed">
          {cityName}議会の公式会議録です。本会議・委員会の発言内容をすべて収録しています。
          {enrichedCount > 0 && (
            <span className="text-sm text-[#718096]">
              {" "}（{enrichedCount}件にAI要約・タグあり）
            </span>
          )}
        </p>
      </section>

      {items.length === 0 ? (
        <div className="bg-white rounded-lg border border-[#CBD5E0] p-8 text-center text-[#718096]">
          現在、掲載されている議事録はありません。
        </div>
      ) : (
        <MinutesIndexClient
          items={items}
          minutesBasePath={`/${city}/minutes`}
        />
      )}
    </div>
  );
}
