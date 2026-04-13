import fs from "fs";
import path from "path";
import type { MinutesEnriched } from "@/types/minutes";

export type EnrichedRecord = MinutesEnriched & {
  cityId: string;
  cityName: string;
};

const CITY_NAMES: Record<string, string> = {
  chitose: "千歳市",
  eniwa: "恵庭市",
  tomakomai: "苫小牧市",
  asahikawa: "旭川市",
  hakodate: "函館市",
  muroran: "室蘭市",
  kushiro: "釧路市",
  wakkanai: "稚内市",
  kitami: "北見市",
  obihiro: "帯広市",
  nayoro: "名寄市",
  date: "伊達市",
  fukushima: "福島町",
  hokuto: "北斗市",
  ishikari: "石狩市",
  kitahiroshima: "北広島市",
  nemuro: "根室市",
  noboribetsu: "登別市",
  ashibetsu: "芦別市",
  memuro: "芽室町",
  kamikawa: "上川町",
  nakagawa: "中川町",
  kutchan: "倶知安町",
  ikeda: "池田町",
  esashi: "江差町",
};

export function loadAllEnriched(): EnrichedRecord[] {
  const records: EnrichedRecord[] = [];

  for (const [cityId, cityName] of Object.entries(CITY_NAMES)) {
    const enrichedDir = path.join(process.cwd(), "data", cityId, "minutes", "enriched");
    try {
      const files = fs.readdirSync(enrichedDir).filter((f) => f.endsWith(".json"));
      for (const file of files) {
        try {
          const data = JSON.parse(
            fs.readFileSync(path.join(enrichedDir, file), "utf-8")
          ) as MinutesEnriched;
          records.push({ ...data, cityId, cityName });
        } catch {
          // skip malformed files
        }
      }
    } catch {
      // directory doesn't exist for this city
    }
  }

  return records;
}

export function getAllTags(): { tag: string; count: number }[] {
  const all = loadAllEnriched();
  const counts = new Map<string, number>();

  for (const record of all) {
    for (const tag of record.tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}

export function getByTag(tag: string): EnrichedRecord[] {
  return loadAllEnriched().filter((r) => (r.tags ?? []).includes(tag));
}
