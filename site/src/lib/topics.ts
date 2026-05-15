import fs from "fs";
import path from "path";
import type { MinutesEnriched } from "@/types/minutes";

export type EnrichedRecord = MinutesEnriched & {
  cityId: string;
  cityName: string;
};

export type TopicTag = {
  tag: string;
  slug: string;
  count: number;
  aliases: string[];
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

const TOPIC_ALIASES: Record<string, string[]> = {
  "福祉・介護": ["福祉", "介護", "高齢者", "高齢者福祉", "高齢者支援", "障がい者支援", "生活支援", "生活保護"],
  "財政・予算": ["予算", "補正予算", "財政", "決算", "財政健全化", "行財政改革"],
  "子育て・教育": ["子育て", "教育", "子育て支援", "学校給食", "給食", "保育", "不登校", "少子化対策"],
  "DX・デジタル": ["DX", "DX推進", "マイナンバー", "デジタル"],
  "防災・安全": ["防災", "消防", "防犯", "交通安全", "津波対策", "熊対策"],
  "観光・産業": ["観光", "企業誘致", "地域経済", "商工", "雇用", "ふるさと納税"],
  "環境・脱炭素": ["環境", "脱炭素", "ゼロカーボン", "再生可能エネルギー"],
  "交通・道路": ["公共交通", "交通", "道路", "道路整備", "除雪"],
  "公共施設・インフラ": ["公共施設", "インフラ", "水道", "下水道", "病院", "病院経営", "施設整備", "公園"],
  "住まい・地域": ["住宅", "空き家", "町内会", "移住定住", "人口減少", "まちづくり"],
};

const ALIAS_TO_CANONICAL = new Map<string, string>(
  Object.entries(TOPIC_ALIASES).flatMap(([canonical, aliases]) => [
    [canonical, canonical],
    ...aliases.map((alias) => [alias, canonical] as const),
  ])
);

function normalizeTopic(value: string): string {
  return value.normalize("NFKC").trim();
}

export function canonicalizeTag(tag: string): string {
  const normalized = normalizeTopic(tag);
  return ALIAS_TO_CANONICAL.get(normalized) ?? normalized;
}

export function aliasesForTag(tag: string): string[] {
  const canonical = canonicalizeTag(tag);
  const aliases = TOPIC_ALIASES[canonical] ?? [];
  return Array.from(new Set([canonical, ...aliases]));
}

function recordKey(record: EnrichedRecord): string {
  return `${record.cityId}:${record.council_id}`;
}

function recordMatchesTag(record: EnrichedRecord, tag: string): boolean {
  const aliases = new Set(aliasesForTag(tag).map(normalizeTopic));
  return (record.tags ?? []).some((recordTag) => aliases.has(normalizeTopic(recordTag)));
}

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

export function getAllTags(): TopicTag[] {
  const all = loadAllEnriched();
  const buckets = new Map<string, { aliases: Set<string>; records: Set<string> }>();

  for (const record of all) {
    for (const tag of record.tags ?? []) {
      const canonical = canonicalizeTag(tag);
      const bucket = buckets.get(canonical) ?? { aliases: new Set<string>(), records: new Set<string>() };
      bucket.aliases.add(normalizeTopic(tag));
      bucket.records.add(recordKey(record));
      buckets.set(canonical, bucket);
    }
  }

  return Array.from(buckets.entries())
    .map(([tag, bucket]) => ({
      tag,
      slug: tag,
      count: bucket.records.size,
      aliases: aliasesForTag(tag).filter((alias) => alias === tag || bucket.aliases.has(alias)),
    }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "ja"));
}

export function getByTag(tag: string): EnrichedRecord[] {
  return loadAllEnriched().filter((record) => recordMatchesTag(record, tag));
}
