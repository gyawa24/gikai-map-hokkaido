import { compactForSearch } from "./searchNormalization.mjs";

export const MAX_SEARCH_QUERY_INPUT_LENGTH = 80;
export const MIN_SEARCH_QUERY_COMPACT_LENGTH = 2;
export const MAX_SEARCH_QUERY_COMPACT_LENGTH = 64;
export const MAX_SEARCH_QUERY_TOKENS = 8;
export const MAX_SEARCH_NGRAM_TERMS = 64;
export const MAX_SEARCH_POSTING_BUCKETS = 32;
export const MAX_SEARCH_ASSET_REQUESTS_PER_QUERY = 96;

export const SEARCH_QUERY_LIMIT_MESSAGE =
  "検索語は2文字以上、80文字以内で入力し、範囲が広い場合は語句を追加して絞ってください。";

export function validateSearchQueryLimits(query) {
  const input = String(query ?? "");
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  const compactTokenLengths = tokens.map((token) => compactForSearch(token).length);
  const compactLength = compactForSearch(input).length;
  return {
    ok:
      input.length <= MAX_SEARCH_QUERY_INPUT_LENGTH
      && compactLength >= MIN_SEARCH_QUERY_COMPACT_LENGTH
      && compactLength <= MAX_SEARCH_QUERY_COMPACT_LENGTH
      && tokens.length <= MAX_SEARCH_QUERY_TOKENS
      && compactTokenLengths.every((length) => length >= MIN_SEARCH_QUERY_COMPACT_LENGTH),
    inputLength: input.length,
    compactLength,
    tokenCount: tokens.length,
  };
}

export function validateSearchPostingPlan(terms, bucketFiles) {
  return {
    ok:
      new Set(terms).size <= MAX_SEARCH_NGRAM_TERMS
      && new Set(bucketFiles).size <= MAX_SEARCH_POSTING_BUCKETS,
    termCount: new Set(terms).size,
    bucketCount: new Set(bucketFiles).size,
  };
}

export function validateSearchAssetRequestPlan(existingKeys, nextKeys) {
  const requestCount = new Set([
    ...Array.from(existingKeys ?? []),
    ...Array.from(nextKeys ?? []),
  ]).size;
  return {
    ok: requestCount <= MAX_SEARCH_ASSET_REQUESTS_PER_QUERY,
    requestCount,
  };
}

export function appendSearchQueryToHref(href, query) {
  const value = String(href ?? "");
  const [withoutHash, hash = ""] = value.split(/#(.*)/s, 2);
  const separator = withoutHash.includes("?") ? "&" : "?";
  return `${withoutHash}${separator}q=${encodeURIComponent(String(query ?? ""))}${hash ? `#${hash}` : ""}`;
}

export function runtimeAgendaResultId(agenda) {
  const identity = agenda?.agenda_index ?? agenda?.first_minute_id ?? 0;
  return `${agenda?.city}_minutes_${agenda?.council_id}_${agenda?.schedule_index}_${identity}`;
}
