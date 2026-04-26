export const AI_SEARCH_PATH = "/ai-search";
export const AI_SEARCH_LABEL = "AI議事録検索";
export const AI_SEARCH_NAV_LABEL = "AI検索";
export const AI_SEARCH_BADGE_LABEL = "試験版";

const AI_SEARCH_COVERED_COUNCILS = ["千歳市議会"] as const;

export const AI_SEARCH_SUMMARY =
  "自然文で質問すると、議事録の抜粋を根拠に関連する発言や議題を探せます。";

export function getAiSearchCoverageText() {
  return `現在は${AI_SEARCH_COVERED_COUNCILS.join("・")}の議事録に対応しています。`;
}
