import {
  buildExpansionSummary,
  buildQuerySuggestions,
  buildTokenGroups,
  normalizeForSearch,
  type SearchTokenGroup,
  type SearchTokenVariant,
} from "@/lib/searchSynonyms";

export type SearchOperator = "and" | "or";
export type SearchMatchMode = "strict" | "fallback";

export type SearchQuery = {
  raw: string;
  tokens: string[];
  tokenGroups: SearchTokenGroup[];
  highlightTokens: string[];
};

export type SearchAssistGroup = {
  kind: "exact" | "related" | "suggestion";
  label: string;
  terms: string[];
};

export function normalizeSearchText(text: string): string {
  return normalizeForSearch(text);
}

function tokenize(query: string): string[] {
  return query.trim().split(/\s+/).filter(Boolean);
}

export function buildSearchQuery(query: string): SearchQuery {
  const tokens = tokenize(query);
  return {
    raw: query,
    tokens,
    tokenGroups: buildTokenGroups(tokens),
    highlightTokens: tokens,
  };
}

export function buildSearchAssist(query: string): SearchAssistGroup[] {
  const tokens = tokenize(query);
  if (!tokens.length) return [];

  const tokenGroups = buildTokenGroups(tokens);
  const expansions = buildExpansionSummary(tokenGroups);
  const suggestions = buildQuerySuggestions(query, tokenGroups);
  const groups: SearchAssistGroup[] = [];

  if (expansions.exactTerms.length > 0) {
    groups.push({ kind: "exact", label: "同義語", terms: expansions.exactTerms });
  }
  if (expansions.relatedTerms.length > 0) {
    groups.push({ kind: "related", label: "関連語", terms: expansions.relatedTerms });
  }
  if (suggestions.length > 0) {
    groups.push({ kind: "suggestion", label: "候補", terms: suggestions });
  }

  return groups;
}

function allowedVariants(group: SearchTokenGroup, mode: SearchMatchMode): SearchTokenVariant[] {
  if (mode === "fallback") return group;
  return group.filter((variant) => variant.kind !== "related");
}

function groupMatchScore(text: string, group: SearchTokenGroup, mode: SearchMatchMode): number {
  const normalizedText = normalizeSearchText(text);
  let best = 0;
  for (const variant of allowedVariants(group, mode)) {
    if (!variant.normalized) continue;
    if (normalizedText.includes(variant.normalized)) {
      best = Math.max(best, variant.boost);
    }
  }
  return best;
}

export function evaluateSearchText(
  text: string,
  searchQuery: SearchQuery,
  operator: SearchOperator = "and",
  mode: SearchMatchMode = "strict"
): { matched: boolean; score: number; matchedGroupCount: number } {
  if (!searchQuery.tokenGroups.length) {
    return { matched: false, score: 0, matchedGroupCount: 0 };
  }

  const scores = searchQuery.tokenGroups.map((group) => groupMatchScore(text, group, mode));
  const matchedGroupCount = scores.filter((score) => score > 0).length;
  const matched =
    operator === "and"
      ? matchedGroupCount === searchQuery.tokenGroups.length
      : matchedGroupCount > 0;

  if (!matched) {
    return { matched: false, score: 0, matchedGroupCount };
  }

  const coverage = matchedGroupCount / searchQuery.tokenGroups.length;
  const score = scores.reduce((sum, score) => sum + score * 100, 0) + coverage * 40;
  return { matched: true, score, matchedGroupCount };
}

export function matchesSearchText(
  text: string,
  searchQuery: SearchQuery,
  mode: SearchMatchMode = "strict",
  operator: SearchOperator = "and"
): boolean {
  return evaluateSearchText(text, searchQuery, operator, mode).matched;
}

export function scoreSearchText(
  text: string,
  searchQuery: SearchQuery,
  operator: SearchOperator = "and",
  mode: SearchMatchMode = "strict"
): number {
  return evaluateSearchText(text, searchQuery, operator, mode).score;
}

export function excerptSearchText(text: string, tokens: string[], radius = 80): string {
  const normalizedText = normalizeSearchText(text);
  const normalizedTokens = tokens.map((token) => normalizeSearchText(token)).filter(Boolean);
  const firstHit = normalizedTokens
    .map((token) => normalizedText.indexOf(token))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];

  if (firstHit === undefined) {
    return text.length <= radius * 2 ? text : `${text.slice(0, radius * 2)}…`;
  }

  const start = Math.max(0, firstHit - radius);
  const end = Math.min(text.length, firstHit + radius * 2);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}
