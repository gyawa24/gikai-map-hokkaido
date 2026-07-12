export const TOPIC_ALIASES: Record<string, string[]> = {
  "福祉・介護": ["福祉", "介護", "高齢者", "高齢者福祉", "高齢者支援", "障がい者支援", "生活支援", "生活保護"],
  "財政・予算": ["予算", "補正予算", "財政", "決算", "財政健全化", "行財政改革"],
  "子育て・教育": ["子育て", "教育", "子育て支援", "学校給食", "給食", "保育", "不登校", "少子化対策"],
  "医療・健康": ["医療", "健康", "地域医療", "保健", "予防接種", "母子保健"],
  "DX・デジタル": ["DX", "DX推進", "マイナンバー", "デジタル"],
  "防災・安全": ["防災", "消防", "防犯", "交通安全", "津波対策", "熊対策"],
  "観光・産業": ["観光", "企業誘致", "地域経済", "商工", "雇用", "ふるさと納税"],
  "農林水産": ["農業", "林業", "水産業", "漁業", "酪農"],
  "環境・脱炭素": ["環境", "脱炭素", "ゼロカーボン", "再生可能エネルギー"],
  "交通・道路": ["公共交通", "交通", "道路", "道路整備", "除雪"],
  "公共施設・インフラ": ["公共施設", "インフラ", "水道", "下水道", "病院", "病院経営", "施設整備", "公園"],
  "住まい・地域": ["住宅", "空き家", "町内会", "地域コミュニティ", "まちづくり"],
  "人口・移住": ["人口", "人口減少", "移住", "定住", "移住定住", "関係人口"],
  "スポーツ・文化": ["スポーツ", "スポーツ振興", "文化", "文化振興", "図書館", "生涯学習"],
  "議会・行政運営": ["議会運営", "行政", "市政運営", "情報公開", "行政改革"],
};

export const CITIZEN_TOPIC_NAMES = Object.freeze(Object.keys(TOPIC_ALIASES));
const CITIZEN_TOPIC_SET = new Set(CITIZEN_TOPIC_NAMES);

const ALIAS_TO_CANONICAL = new Map<string, string>(
  Object.entries(TOPIC_ALIASES).flatMap(([canonical, aliases]) => [
    [canonical, canonical],
    ...aliases.map((alias) => [alias, canonical] as const),
  ])
);

export function normalizeTopic(value: string): string {
  return value.normalize("NFKC").trim();
}

export function canonicalizeTag(tag: string): string {
  const normalized = normalizeTopic(tag);
  return ALIAS_TO_CANONICAL.get(normalized) ?? normalized;
}

export function isCitizenTopic(tag: string): boolean {
  return CITIZEN_TOPIC_SET.has(canonicalizeTag(tag));
}

export function aliasesForTag(tag: string): string[] {
  const canonical = canonicalizeTag(tag);
  const aliases = TOPIC_ALIASES[canonical] ?? [];
  return Array.from(new Set([canonical, ...aliases]));
}

export function slugForTag(tag: string): string {
  const normalized = normalizeTopic(tag);
  if (/^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(normalized)) {
    return normalized;
  }
  const bytes = new TextEncoder().encode(normalized);
  return `u-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function tagFromSlug(slug: string): string {
  if (!slug.startsWith("u-")) {
    return normalizeTopic(slug);
  }
  const hex = slug.slice(2);
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) {
    return normalizeTopic(slug);
  }
  const bytes = hex.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? [];
  return normalizeTopic(new TextDecoder().decode(new Uint8Array(bytes)));
}
