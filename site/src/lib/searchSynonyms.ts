import { normalizeForSearch } from "@/lib/searchNormalization.mjs";

export type SearchSynonymKind = "exact" | "related";

export type SearchSynonymEntry = {
  canonical: string;
  aliases: string[];
  category: string;
  kind: SearchSynonymKind;
  boost: number;
  source?: "basic" | "corpus";
};

export type SearchTokenVariant = {
  term: string;
  normalized: string;
  canonical: string;
  kind: "original" | SearchSynonymKind;
  boost: number;
};

export type SearchTokenGroup = SearchTokenVariant[];

const BASIC_SEARCH_SYNONYMS: SearchSynonymEntry[] = [
  { canonical: "子ども", aliases: ["子供", "こども", "こども達", "こどもたち", "児童"], category: "福祉", kind: "exact", boost: 0.96, source: "basic" },
  { canonical: "子育て支援", aliases: ["子育て", "育児支援"], category: "福祉", kind: "exact", boost: 0.94, source: "basic" },
  { canonical: "障害", aliases: ["障がい", "しょうがい"], category: "福祉", kind: "exact", boost: 0.96, source: "basic" },
  { canonical: "高齢者", aliases: ["高齢", "シニア"], category: "福祉", kind: "exact", boost: 0.94, source: "basic" },
  { canonical: "除雪", aliases: ["除排雪", "排雪"], category: "生活", kind: "exact", boost: 0.97, source: "basic" },
  { canonical: "学校給食", aliases: ["給食"], category: "教育", kind: "exact", boost: 0.97, source: "basic" },
  { canonical: "公共交通", aliases: ["地域交通", "地域公共交通"], category: "交通", kind: "exact", boost: 0.95, source: "basic" },
  { canonical: "デジタル化", aliases: ["DX", "デジタル", "電子化"], category: "行政", kind: "exact", boost: 0.9, source: "basic" },
  { canonical: "脱炭素", aliases: ["ゼロカーボン", "カーボンニュートラル"], category: "環境", kind: "exact", boost: 0.96, source: "basic" },
  { canonical: "ラピダス", aliases: ["Rapidus", "rapidus"], category: "産業", kind: "exact", boost: 0.99, source: "basic" },
  { canonical: "半導体", aliases: ["半導体産業"], category: "産業", kind: "exact", boost: 0.95, source: "basic" },
  { canonical: "観光", aliases: ["観光客"], category: "産業", kind: "exact", boost: 0.92, source: "basic" },
  { canonical: "移住定住", aliases: ["移住", "定住"], category: "人口", kind: "exact", boost: 0.93, source: "basic" },
  { canonical: "防災", aliases: ["減災"], category: "安全", kind: "exact", boost: 0.95, source: "basic" },
  { canonical: "再生可能エネルギー", aliases: ["再エネ"], category: "環境", kind: "exact", boost: 0.96, source: "basic" },
  { canonical: "物価高騰", aliases: ["物価高", "物価"], category: "経済", kind: "exact", boost: 0.88, source: "basic" },
  { canonical: "学校再編", aliases: ["学校統合", "統廃合"], category: "教育", kind: "exact", boost: 0.95, source: "basic" },
  { canonical: "空き家", aliases: ["空家"], category: "住宅", kind: "exact", boost: 0.98, source: "basic" },
  { canonical: "企業誘致", aliases: ["誘致"], category: "産業", kind: "exact", boost: 0.88, source: "basic" },
  { canonical: "不登校", aliases: ["登校拒否"], category: "教育", kind: "exact", boost: 0.98, source: "basic" },
  { canonical: "いじめ", aliases: ["苛め"], category: "教育", kind: "exact", boost: 0.98, source: "basic" },
  { canonical: "子ども", aliases: ["保育", "教育"], category: "福祉", kind: "related", boost: 0.56, source: "basic" },
  { canonical: "防災", aliases: ["避難", "災害", "ハザード"], category: "安全", kind: "related", boost: 0.58, source: "basic" },
  { canonical: "公共交通", aliases: ["バス", "鉄道", "乗合", "デマンド交通", "デマンドバス", "コミュニティバス"], category: "交通", kind: "related", boost: 0.55, source: "basic" },
  { canonical: "観光", aliases: ["宿泊", "旅行", "インバウンド"], category: "産業", kind: "related", boost: 0.56, source: "basic" },
  { canonical: "移住定住", aliases: ["関係人口", "人口減少"], category: "人口", kind: "related", boost: 0.54, source: "basic" },
  { canonical: "脱炭素", aliases: ["省エネ", "再生可能エネルギー"], category: "環境", kind: "related", boost: 0.56, source: "basic" },
  { canonical: "除雪", aliases: ["雪対策", "冬対策"], category: "生活", kind: "related", boost: 0.57, source: "basic" },
  { canonical: "高齢者", aliases: ["介護", "福祉"], category: "福祉", kind: "related", boost: 0.54, source: "basic" },
  { canonical: "学校給食", aliases: ["食育"], category: "教育", kind: "related", boost: 0.53, source: "basic" },
];

const CORPUS_SEARCH_SYNONYMS: SearchSynonymEntry[] = [
  { canonical: "物価高騰対策", aliases: ["物価高騰", "物価高"], category: "経済", kind: "exact", boost: 0.97, source: "corpus" },
  { canonical: "介護保険", aliases: ["介護"], category: "福祉", kind: "exact", boost: 0.94, source: "corpus" },
  { canonical: "地域おこし協力隊", aliases: ["協力隊"], category: "地域", kind: "exact", boost: 0.96, source: "corpus" },
  { canonical: "ふるさと納税", aliases: ["企業版ふるさと納税"], category: "財政", kind: "related", boost: 0.58, source: "corpus" },
  { canonical: "上下水道", aliases: ["上水道", "下水道"], category: "インフラ", kind: "exact", boost: 0.92, source: "corpus" },
  { canonical: "空き家対策", aliases: ["空き家", "空家", "空家等"], category: "住宅", kind: "exact", boost: 0.95, source: "corpus" },
  { canonical: "ヤングケアラー", aliases: ["若年介護"], category: "福祉", kind: "exact", boost: 0.92, source: "corpus" },
  { canonical: "学校給食費", aliases: ["給食費"], category: "教育", kind: "exact", boost: 0.96, source: "corpus" },
  { canonical: "義務教育学校", aliases: ["小中一貫校"], category: "教育", kind: "exact", boost: 0.9, source: "corpus" },
  { canonical: "部活動", aliases: ["部活"], category: "教育", kind: "exact", boost: 0.96, source: "corpus" },
  { canonical: "デジタル田園都市", aliases: ["デジタル田園都市国家構想"], category: "行政", kind: "exact", boost: 0.92, source: "corpus" },
  { canonical: "観光振興", aliases: ["観光"], category: "産業", kind: "related", boost: 0.57, source: "corpus" },
  { canonical: "宿泊税", aliases: ["宿泊"], category: "産業", kind: "related", boost: 0.54, source: "corpus" },
  { canonical: "人口減少", aliases: ["少子化"], category: "人口", kind: "related", boost: 0.58, source: "corpus" },
  { canonical: "移住定住", aliases: ["移住促進", "定住促進", "移住者"], category: "人口", kind: "exact", boost: 0.95, source: "corpus" },
  { canonical: "公共交通", aliases: ["路線バス"], category: "交通", kind: "related", boost: 0.56, source: "corpus" },
  { canonical: "公共交通", aliases: ["公共交通機関"], category: "交通", kind: "exact", boost: 0.93, source: "corpus" },
  { canonical: "公共交通", aliases: ["地域公共交通"], category: "交通", kind: "exact", boost: 0.96, source: "corpus" },
  { canonical: "防災", aliases: ["避難所", "防災訓練", "消防団"], category: "安全", kind: "related", boost: 0.57, source: "corpus" },
  { canonical: "ヒグマ対策", aliases: ["ヒグマ", "熊"], category: "安全", kind: "exact", boost: 0.9, source: "corpus" },
  { canonical: "鳥獣被害", aliases: ["有害鳥獣", "鳥獣"], category: "農林", kind: "exact", boost: 0.94, source: "corpus" },
  { canonical: "農業", aliases: ["農業者", "担い手", "スマート農業"], category: "農林", kind: "related", boost: 0.56, source: "corpus" },
  { canonical: "ラピダス", aliases: ["半導体関連"], category: "産業", kind: "related", boost: 0.57, source: "corpus" },
  { canonical: "脱炭素", aliases: ["脱炭素先行地域"], category: "環境", kind: "exact", boost: 0.94, source: "corpus" },
  { canonical: "ごみ", aliases: ["ゴミ"], category: "生活", kind: "exact", boost: 0.98, source: "corpus" },
];

const SEARCH_SYNONYMS: SearchSynonymEntry[] = [
  ...BASIC_SEARCH_SYNONYMS,
  ...CORPUS_SEARCH_SYNONYMS,
];

export { normalizeForSearch };

function isLooseTermMatch(token: string, term: string): boolean {
  if (!token || !term) return false;
  if (token === term) return true;
  if (token.length >= 2 && term.includes(token) && term.length - token.length <= 2) return true;
  if (term.length >= 2 && token.includes(term)) return true;
  return false;
}

export function buildTokenGroups(tokens: string[]): SearchTokenGroup[] {
  return tokens.map((token) => {
    const normalizedToken = normalizeForSearch(token);
    const candidates = new Map<string, SearchTokenVariant>();

    const addCandidate = (candidate: SearchTokenVariant) => {
      const existing = candidates.get(candidate.normalized);
      if (!existing || existing.boost < candidate.boost) {
        candidates.set(candidate.normalized, candidate);
      }
    };

    addCandidate({
      term: token,
      normalized: normalizedToken,
      canonical: token,
      kind: "original",
      boost: 1,
    });

    for (const entry of SEARCH_SYNONYMS) {
      const terms = [entry.canonical, ...entry.aliases];
      const matchedTerms = terms.filter((term) =>
        isLooseTermMatch(normalizedToken, normalizeForSearch(term))
      );
      if (matchedTerms.length === 0) continue;

      for (const term of new Set([entry.canonical, ...matchedTerms])) {
        const normalized = normalizeForSearch(term);
        addCandidate({
          term,
          normalized,
          canonical: entry.canonical,
          kind: entry.kind,
          boost: normalized === normalizeForSearch(entry.canonical)
            ? entry.boost
            : Math.max(0.45, entry.boost - 0.04),
        });
      }
    }

    return Array.from(candidates.values()).sort((a, b) => {
      if (b.boost !== a.boost) return b.boost - a.boost;
      return a.term.localeCompare(b.term, "ja");
    });
  });
}

export function buildExpansionSummary(tokenGroups: SearchTokenGroup[]) {
  const exactTerms = new Set<string>();
  const relatedTerms = new Set<string>();

  for (const group of tokenGroups) {
    for (const variant of group) {
      if (variant.kind === "exact") exactTerms.add(variant.term);
      if (variant.kind === "related") relatedTerms.add(variant.term);
    }
  }

  return {
    exactTerms: Array.from(exactTerms),
    relatedTerms: Array.from(relatedTerms),
  };
}

export function buildQuerySuggestions(query: string, tokenGroups: SearchTokenGroup[]): string[] {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  const suggestions = new Set<string>();

  tokenGroups.forEach((group, index) => {
    const original = group.find((variant) => variant.kind === "original");
    const exact = group.find((variant) => variant.kind === "exact" && normalizeForSearch(variant.term) !== original?.normalized);
    const related = group.find((variant) => variant.kind === "related" && normalizeForSearch(variant.term) !== original?.normalized);

    if (exact) {
      const next = [...tokens];
      next[index] = exact.canonical;
      suggestions.add(next.join(" "));
    } else if (related) {
      const next = [...tokens];
      next[index] = related.canonical;
      suggestions.add(next.join(" "));
    }
  });

  if (tokens.length >= 2) {
    suggestions.add(tokens.slice(0, tokens.length - 1).join(" "));
  }

  return Array.from(suggestions)
    .filter(Boolean)
    .filter((candidate) => normalizeForSearch(candidate) !== normalizeForSearch(query))
    .slice(0, 4);
}
