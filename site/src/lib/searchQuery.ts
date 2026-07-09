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

type NormalizedSearchText = {
  normalizedText: string;
  compactText: string;
};

export type SearchTextEvaluation = {
  matched: boolean;
  score: number;
  matchedGroupCount: number;
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

function prepareSearchText(
  text: string,
  cache?: Map<string, NormalizedSearchText>
): NormalizedSearchText {
  const cached = cache?.get(text);
  if (cached) return cached;
  const normalizedText = normalizeSearchText(text);
  const prepared = {
    normalizedText,
    compactText: normalizedText.replace(/\s+/g, ""),
  };
  cache?.set(text, prepared);
  return prepared;
}

function groupMatchScore(preparedText: NormalizedSearchText, group: SearchTokenGroup, mode: SearchMatchMode): number {
  let best = 0;
  for (const variant of allowedVariants(group, mode)) {
    if (!variant.normalized) continue;
    const compactVariant = variant.normalized.replace(/\s+/g, "");
    if (
      preparedText.normalizedText.includes(variant.normalized) ||
      (compactVariant.length >= 2 && preparedText.compactText.includes(compactVariant))
    ) {
      best = Math.max(best, variant.boost);
    }
  }
  return best;
}

export function evaluateSearchText(
  text: string,
  searchQuery: SearchQuery,
  operator: SearchOperator = "and",
  mode: SearchMatchMode = "strict",
  cache?: Map<string, NormalizedSearchText>
): SearchTextEvaluation {
  if (!searchQuery.tokenGroups.length) {
    return { matched: false, score: 0, matchedGroupCount: 0 };
  }

  const preparedText = prepareSearchText(text, cache);
  const scores = searchQuery.tokenGroups.map((group) => groupMatchScore(preparedText, group, mode));
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

export function createSearchTextEvaluator(
  searchQuery: SearchQuery,
  operator: SearchOperator = "and",
  mode: SearchMatchMode = "strict"
): (text: string) => SearchTextEvaluation {
  const cache = new Map<string, NormalizedSearchText>();
  return (text) => evaluateSearchText(text, searchQuery, operator, mode, cache);
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
    const sentenceEnd = text.search(/[。！？]/);
    if (sentenceEnd >= 0 && sentenceEnd + 1 <= radius * 2) {
      return text.slice(0, sentenceEnd + 1);
    }
    return text.length <= radius * 2 ? text : `${text.slice(0, radius * 2)}…`;
  }

  const sentenceStartCandidates = ["。", "！", "？"].map((marker) => text.lastIndexOf(marker, firstHit - 1));
  const sentenceStart = Math.max(0, Math.max(...sentenceStartCandidates) + 1);
  const sentenceEndCandidates = ["。", "！", "？"]
    .map((marker) => text.indexOf(marker, firstHit))
    .filter((index) => index >= 0);
  const sentenceEnd = sentenceEndCandidates.length
    ? Math.min(...sentenceEndCandidates) + 1
    : text.length;
  const maxLength = radius * 2;
  const start = sentenceEnd - sentenceStart <= maxLength
    ? sentenceStart
    : Math.max(sentenceStart, firstHit - radius);
  const end = sentenceEnd - start <= maxLength
    ? sentenceEnd
    : Math.min(sentenceEnd, firstHit + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}
