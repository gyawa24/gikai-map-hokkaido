"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import type {
  SessionHit,
  MemberHit,
  SearchFacet,
  SearchIndexScope,
  SearchResponse,
} from "@/app/api/search/route";
import { Accordion } from "@/components/Accordion";
import {
  payloadSliceForRange,
  resolveBigramCandidates,
  searchPostingBucket as bigramBucket,
  searchPostingBucketAssetFile as bigramBucketFile,
  unionNumberLists,
  variantsForBigramMatchMode,
} from "@/lib/searchBigramCandidates.mjs";
import {
  appendSearchQueryToHref,
  MAX_SEARCH_ASSET_REQUESTS_PER_QUERY,
  MAX_SEARCH_QUERY_INPUT_LENGTH,
  SEARCH_QUERY_LIMIT_MESSAGE,
  validateSearchPostingPlan,
  validateSearchQueryLimits,
} from "@/lib/searchQueryLimits.mjs";
import {
  beginSearchTransferFetch,
  cancelSearchResponseBody,
  createSearchTransferBudget,
  exactSearchAssetMetadataMatches,
  reconcileSearchTransferAttempt,
  reserveSearchTransferAssets,
  responseWireBytes,
  searchExactTextResponseMode,
  searchAssetMetadataFingerprint,
  searchAssetPlanFromCatalog,
  validSearchAssetMetadata,
} from "@/lib/searchTransferBudget.mjs";
import { buildSearchAssist, buildSearchQuery, createSearchTextEvaluator, excerptSearchText, normalizeSearchText as normalizeForSearch } from "@/lib/searchQuery";

function Highlight({ text, tokens }: { text: string; tokens: string[] }) {
  if (!tokens.length) return <>{text}</>;
  const pattern = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const parts = text.split(new RegExp(`(${pattern})`, "gi"));
  const regex = new RegExp(`^(?:${pattern})$`, "i");
  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark key={i} className="bg-yellow-200 text-[#1A202C] rounded">{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

function tokenize(query: string): string[] {
  return query.trim().split(/\s+/).filter(Boolean);
}

function compactForSearch(text: string): string {
  return normalizeForSearch(text).replace(/\s+/g, "");
}

function looksLikeMemberNameSearch(query: string, members: MemberHit[]): boolean {
  const compactQuery = compactForSearch(query);
  if (compactQuery.length < 2) return false;
  return members.some((member) => {
    const compactName = compactForSearch(member.name);
    const compactFurigana = compactForSearch(member.furigana);
    return (
      compactName.includes(compactQuery) ||
      compactQuery.includes(compactName) ||
      Boolean(compactFurigana && compactFurigana.includes(compactQuery))
    );
  });
}

function groupByCity<T extends { city: string; cityName: string }>(items: T[]) {
  const groups = new Map<string, { city: string; cityName: string; items: T[] }>();
  for (const item of items) {
    const existing = groups.get(item.city) ?? { city: item.city, cityName: item.cityName, items: [] };
    existing.items.push(item);
    groups.set(item.city, existing);
  }
  return Array.from(groups.values());
}

type SourceFilter = "all" | "minutes" | "session" | "decision";
type SearchTab = "sessions" | "members";
type SessionSort = "relevance" | "newest";
type MemberSort = "relevance" | "name" | "city";
type SearchMode = "and" | "or";

const SOURCE_FILTER_LABELS: Record<SourceFilter, string> = {
  all: "すべて",
  minutes: "議事録",
  session: "会議録速報",
  decision: "議決結果",
};

const SEARCH_SUGGESTIONS = [
  "除雪",
  "給食無償化",
  "ラピダス",
  "防災",
  "空き家",
  "ヒグマ",
];

const SEARCH_SHORTCUTS = [
  { label: "議員を探す", tab: "members" as const, source: "all" as SourceFilter },
  { label: "議事録を探す", tab: "sessions" as const, source: "minutes" as SourceFilter },
  { label: "議決を探す", tab: "sessions" as const, source: "decision" as SourceFilter },
  { label: "速報を探す", tab: "sessions" as const, source: "session" as SourceFilter },
];

const RESULT_PAGE_SIZE = 30;

type SearchParamUpdates = Partial<{
  q: string;
  tab: SearchTab;
  city: string;
  cityName: string;
  source: SourceFilter;
  year: string;
  faction: string;
  op: SearchMode;
  sessionSort: SessionSort;
  memberSort: MemberSort;
}>;

function normalizeSearchTab(value: string | null | undefined): SearchTab {
  return value === "members" ? "members" : "sessions";
}

function normalizeSourceFilter(value: string | null | undefined): SourceFilter {
  return value === "minutes" || value === "session" || value === "decision" ? value : "all";
}

function normalizeSearchModeParam(value: string | null | undefined): SearchMode {
  return value === "or" ? "or" : "and";
}

function normalizeSessionSortParam(value: string | null | undefined): SessionSort {
  return value === "newest" ? "newest" : "relevance";
}

function normalizeMemberSortParam(value: string | null | undefined): MemberSort {
  return value === "name" || value === "city" ? value : "relevance";
}

function setSearchParam(
  params: URLSearchParams,
  key: string,
  value: string | undefined | null,
  deleteValues: string[] = []
) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || deleteValues.includes(trimmed)) {
    params.delete(key);
    return;
  }
  params.set(key, trimmed);
}

function normalizeSearchParams(params: URLSearchParams) {
  setSearchParam(params, "q", params.get("q"));

  const tab = normalizeSearchTab(params.get("tab"));
  if (tab === "members") {
    params.set("tab", "members");
    params.delete("source");
    params.delete("year");
    params.delete("sessionSort");
  } else {
    params.delete("tab");
    params.delete("faction");
    params.delete("memberSort");
  }

  const city = params.get("city")?.trim() ?? "";
  if (!city || city === "all") {
    params.delete("city");
    params.delete("cityName");
  } else {
    params.set("city", city);
    setSearchParam(params, "cityName", params.get("cityName"));
  }

  const source = normalizeSourceFilter(params.get("source"));
  setSearchParam(params, "source", tab === "sessions" ? source : "all", ["all"]);
  setSearchParam(params, "year", tab === "sessions" ? params.get("year") : "all", ["all"]);
  setSearchParam(params, "faction", tab === "members" ? params.get("faction") : "all", ["all"]);

  const searchMode = normalizeSearchModeParam(params.get("op"));
  setSearchParam(params, "op", searchMode === "or" ? searchMode : "and", ["and"]);
  const sessionSort = normalizeSessionSortParam(params.get("sessionSort"));
  setSearchParam(params, "sessionSort", tab === "sessions" && sessionSort !== "relevance" ? sessionSort : "relevance", ["relevance"]);
  const memberSort = normalizeMemberSortParam(params.get("memberSort"));
  setSearchParam(params, "memberSort", tab === "members" && memberSort !== "relevance" ? memberSort : "relevance", ["relevance"]);
}

type ClientBigramSearchDocument = {
  id: string;
  source: "agenda" | "member_activity" | "member" | "session" | "enriched" | "decision";
  sourceType?: "session" | "minutes" | "decision";
  city: string;
  cityName: string;
  title: string;
  body?: string;
  context?: string;
  metaText?: string;
  council_id?: number | null;
  member_name?: string;
  record_id?: string;
  session_id?: string;
  segment_index?: number;
  name?: string;
  furigana?: string;
  party?: string;
  faction?: string;
  committees?: string[];
  href?: string;
  date?: string;
  year?: string;
  committee?: string;
  label?: string;
  speaker?: string;
  start_time?: string;
  question_kind?: string;
  canonical_topics?: string[];
  topics?: string[];
  source_label?: string;
  source_status?: string;
  field?: string;
  fullTextIndexed?: boolean;
  _exactText?: string;
  _bigramExact?: boolean;
};

type ClientBigramPayloadRange = {
  start: number;
  end: number;
  payload_start: number;
  payload_end: number;
  encoding: "gzip";
};

type ClientBigramDocumentRange = ClientBigramPayloadRange & {
  documents_url: string;
};

type ClientBigramExactTextRange = {
  start: number;
  end: number;
  byte_start: number;
  byte_length: number;
  raw_bytes: number;
  encoding: "gzip-member-json";
  exact_text_url: string;
};

type ClientSearchAssetReference = {
  url: string;
  encoding: "gzip";
  bytes: number;
  raw_bytes: number;
  sha256: string;
  raw_sha256: string;
};

type ClientSearchAssetMetadata = {
  url: string;
  encoding: "gzip" | "identity" | "gzip-member-json";
  bytes: number;
  raw_bytes: number;
  sha256: string;
  raw_sha256: string;
  byte_start?: number;
  asset_bytes?: number;
};

type ClientSearchAssetCatalog = {
  version: 1;
  generated_at: string;
  assets: Record<string, ClientSearchAssetMetadata>;
};

type ClientBigramCityEntry = {
  slug: string;
  name: string;
  document_count: number;
  document_ranges: ClientBigramDocumentRange[];
  exact_text_ranges: ClientBigramExactTextRange[];
};

type ClientBigramSearchManifest = {
  version: number;
  generated_at: string;
  scope: "city-bigram";
  city: string;
  document_count: number;
  bucket_count: number;
  ngram_widths: number[];
  positional_trigrams: false;
  buckets: string[];
  exact_terms: string[];
  postings_encoding: "gzip";
  posting_value_encoding: "delta-varint-v1";
  postings_base_url: string;
  asset_catalog: ClientSearchAssetReference;
  document_ranges: ClientBigramDocumentRange[];
  exact_text_ranges: ClientBigramExactTextRange[];
};

type ClientStatewideBigramSearchManifest = {
  version: number;
  generated_at: string;
  scope: "statewide-bigram";
  document_count: number;
  bucket_count: number;
  ngram_widths: number[];
  positional_trigrams: false;
  buckets: string[];
  exact_terms: string[];
  postings_encoding: "gzip";
  posting_value_encoding: "delta-varint-v1";
  asset_catalog: ClientSearchAssetReference;
  cities: ClientBigramCityEntry[];
};

type ClientStatewideBigramPostingValue = string;
type ClientStatewideBigramPostingBucket = Record<
  string,
  Record<string, ClientStatewideBigramPostingValue>
>;
type ClientDecodedNgramPosting = {
  documentIds: number[];
  positionsByDocument?: Map<number, number[]>;
};
type ClientCachedSearchAsset<T> = {
  fingerprint: string;
  promise: Promise<T>;
};
type ClientTransientSearchCaches = {
  manifests: Map<string, Promise<unknown>>;
  catalogs: Map<string, ClientCachedSearchAsset<ClientSearchAssetCatalog>>;
  documents: Map<string, ClientCachedSearchAsset<ClientBigramSearchDocument[]>>;
  exactText: Map<string, ClientCachedSearchAsset<string[]>>;
  postings: Map<string, ClientCachedSearchAsset<ClientStatewideBigramPostingBucket>>;
  snippetExactTextKeys: Set<string>;
  transferBudget: ReturnType<typeof createSearchTransferBudget>;
};

type RankedSessionHit = SessionHit & { score: number };
type RankedMemberHit = MemberHit & { score: number };

const clientBigramManifestCache = new Map<string, ClientBigramSearchManifest>();
const clientStatewideBigramManifestCache = new Map<string, ClientStatewideBigramSearchManifest>();
const MAX_SEARCH_GZIP_BYTES_PER_SEARCH = 16 * 1024 * 1024;
const MAX_SEARCH_RAW_BYTES_PER_SEARCH = 64 * 1024 * 1024;
const MAX_CITY_SEARCH_MANIFEST_BYTES = 512 * 1024;
const MAX_STATEWIDE_SEARCH_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_EXACT_TEXT_SNIPPET_BLOCKS_PER_SEARCH = 12;
const SEARCH_TRANSFER_LIMITS = Object.freeze({
  requests: MAX_SEARCH_ASSET_REQUESTS_PER_QUERY,
  gzipBytes: MAX_SEARCH_GZIP_BYTES_PER_SEARCH,
  rawBytes: MAX_SEARCH_RAW_BYTES_PER_SEARCH,
});

function createClientTransientSearchCaches(): ClientTransientSearchCaches {
  return {
    manifests: new Map(),
    catalogs: new Map(),
    documents: new Map(),
    exactText: new Map(),
    postings: new Map(),
    snippetExactTextKeys: new Set(),
    transferBudget: createSearchTransferBudget(),
  };
}

function clearClientTransientSearchCaches(caches: ClientTransientSearchCaches): void {
  caches.manifests.clear();
  caches.documents.clear();
  caches.catalogs.clear();
  caches.exactText.clear();
  caches.postings.clear();
  caches.snippetExactTextKeys.clear();
  caches.transferBudget.assets.clear();
  caches.transferBudget.retryCounts.clear();
  caches.transferBudget.requests = 0;
  caches.transferBudget.gzipBytes = 0;
  caches.transferBudget.rawBytes = 0;
}

type ClientSearchAssetPlan = {
  key: string;
  gzipBytes: number;
  rawBytes: number;
  allowDecrease?: boolean;
};

function reserveSearchAssets(
  caches: ClientTransientSearchCaches,
  plans: Iterable<ClientSearchAssetPlan>,
  required: boolean
): boolean {
  const accepted = reserveSearchTransferAssets(
    caches.transferBudget,
    plans,
    SEARCH_TRANSFER_LIMITS
  );
  if (!accepted) {
    if (required) {
      throw new Error("検索範囲が広すぎるため、検索語を追加して絞り込んでください。");
    }
    return false;
  }
  return true;
}

function beginSearchAssetFetch(
  caches: ClientTransientSearchCaches,
  plan: ClientSearchAssetPlan,
  required: boolean
): string | null {
  const attemptKey = beginSearchTransferFetch(
    caches.transferBudget,
    plan,
    SEARCH_TRANSFER_LIMITS
  );
  if (!attemptKey && required) {
    throw new Error("検索範囲が広すぎるため、検索語を追加して絞り込んでください。");
  }
  return attemptKey;
}


function yearFromDate(date: string | undefined | null): string {
  const match = date?.match(/^(\d{4})/);
  return match ? match[1] : "";
}

function yearFromCouncilName(name: string): string {
  const norm = name.replace(/[０-９]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xfee0)
  );
  const reiwa = norm.match(/令和\s*(\d+)/);
  if (reiwa) return String(2018 + Number(reiwa[1]));
  const heisei = norm.match(/平成\s*(\d+)/);
  if (heisei) return String(1988 + Number(heisei[1]));
  const west = norm.match(/(\d{4})/);
  return west ? west[1] : "";
}

function formatSearchDate(date: string | undefined, year: string | undefined): string {
  const match = date?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    return `${Number(match[1])}年${Number(match[2])}月${Number(match[3])}日`;
  }
  if (!year) return "";
  return /^\d{4}$/.test(year) ? `${year}年` : year;
}

function compactUiText(text: string, maxLength = 48): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
}

function ResultPager({
  remaining,
  unit,
  onMore,
  onBack,
}: {
  remaining: number;
  unit: string;
  onMore: () => void;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
      {remaining > 0 && (
        <button type="button" onClick={onMore} className="theme-button px-4 py-2 text-sm">
          もっと見る（残り{remaining.toLocaleString()}{unit}）
        </button>
      )}
      <button type="button" onClick={onBack} className="theme-button px-4 py-2 text-sm">
        検索条件に戻る
      </button>
    </div>
  );
}

function sortSessionHits(results: RankedSessionHit[]): RankedSessionHit[] {
  return results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.date !== a.date) return (b.date || "").localeCompare(a.date || "");
    if (b.year !== a.year) return (b.year || "").localeCompare(a.year || "");
    return a.title.localeCompare(b.title, "ja");
  });
}

function sortMemberHits(results: RankedMemberHit[]): RankedMemberHit[] {
  return results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.name.localeCompare(b.name, "ja");
  });
}

function buildCityFacets(
  sessionResults: RankedSessionHit[],
  memberResults: RankedMemberHit[]
): SearchFacet[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const result of sessionResults) {
    counts.set(result.city, {
      label: result.cityName,
      count: (counts.get(result.city)?.count ?? 0) + 1,
    });
  }
  for (const result of memberResults) {
    counts.set(result.city, {
      label: result.cityName,
      count: (counts.get(result.city)?.count ?? 0) + 1,
    });
  }
  return Array.from(counts.entries())
    .map(([value, meta]) => ({ value, label: meta.label, count: meta.count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ja"));
}

function buildCountFacets<T extends string>(
  values: T[],
  labelFor?: (value: T) => string
): SearchFacet[] {
  const counts = new Map<T, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([value, count]) => ({
      value,
      label: labelFor ? labelFor(value) : value,
      count,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ja"));
}

function stripSessionScore(results: RankedSessionHit[]): SessionHit[] {
  return results.map((result) => ({
    id: result.id,
    city: result.city,
    cityName: result.cityName,
    sourceType: result.sourceType,
    title: result.title,
    committee: result.committee,
    href: result.href,
    segIndex: result.segIndex,
    label: result.label,
    startTime: result.startTime,
    context: result.context,
    field: result.field,
    date: result.date,
    year: result.year,
  }));
}

function stripMemberScore(results: RankedMemberHit[]): MemberHit[] {
  return results.map((result) => ({
    city: result.city,
    cityName: result.cityName,
    href: result.href,
    name: result.name,
    furigana: result.furigana,
    party: result.party,
    faction: result.faction,
    committees: result.committees,
  }));
}

function compactForBigramSearch(text: string): string {
  return normalizeForSearch(text).replace(/[^\p{L}\p{N}]+/gu, "");
}

function bigramsForSearch(text: string): string[] {
  const compact = compactForBigramSearch(text);
  if (!compact) return [];
  if (compact.length === 1) return [compact];
  const terms: string[] = [];
  for (let i = 0; i < compact.length - 1; i += 1) {
    terms.push(compact.slice(i, i + 2));
  }
  return Array.from(new Set(terms));
}

function trigramsForSearch(text: string): string[] {
  const compact = compactForBigramSearch(text);
  if (compact.length < 3) return [];
  const terms: string[] = [];
  for (let index = 0; index < compact.length - 2; index += 1) {
    terms.push(compact.slice(index, index + 3));
  }
  return terms;
}

function candidateNgramsForSearch(text: string): string[] {
  const compact = compactForBigramSearch(text);
  return compact.length >= 3
    ? trigramsForSearch(compact)
    : bigramsForSearch(compact);
}

function supportsBigramQuery(query: string): boolean {
  const tokens = tokenize(query);
  return tokens.length > 0 && tokens.every((token) => compactForBigramSearch(token).length >= 2);
}

function documentSearchText(doc: ClientBigramSearchDocument): string {
  return [
    doc.cityName,
    doc.title,
    doc.committee,
    doc.label,
    doc.speaker,
    doc.body,
    doc.context,
    doc.metaText,
    doc.member_name,
    doc.question_kind,
    doc.source_label,
    doc.source_status,
    doc.name,
    doc.furigana,
    doc.party,
    doc.faction,
    ...(doc.committees ?? []),
  ].filter(Boolean).join(" ");
}

function queryVariantDescriptors(
  q: string,
  matchMode: "strict" | "fallback",
  exactPostingTerms: ReadonlySet<string> = new Set()
): Array<Array<{ terms: string[]; exactByPosting: boolean; positional: boolean }>> {
  const searchQuery = buildSearchQuery(q);
  return searchQuery.tokenGroups
    .map((group) =>
      variantsForBigramMatchMode(group, matchMode)
        .map((variant) => {
          const normalized = variant.normalized || variant.term;
          const compact = compactForBigramSearch(normalized);
          const exactByPosting = exactPostingTerms.has(compact);
          return {
            terms: exactByPosting ? [compact] : candidateNgramsForSearch(normalized),
            exactByPosting: compact.length === 2 || compact.length === 3 || exactByPosting,
            positional: compact.length > 3 && !exactByPosting,
          };
        })
        .filter((variant) => variant.terms.length > 0)
    )
    .filter((group) => group.length > 0);
}

function queryVariantTermGroups(
  q: string,
  matchMode: "strict" | "fallback",
  exactPostingTerms: ReadonlySet<string> = new Set()
): string[][][] {
  return queryVariantDescriptors(q, matchMode, exactPostingTerms).map((group) =>
    group.map((variant) => variant.terms)
  );
}

function candidateResolutionFromBigramPostings(
  q: string,
  searchMode: SearchMode,
  postingsByTerm: Map<string, ClientDecodedNgramPosting>,
  matchMode: "strict" | "fallback",
  exactPostingTerms: ReadonlySet<string> = new Set()
): { candidateIds: number[]; verificationIds: number[] } {
  return resolveBigramCandidates(
    queryVariantDescriptors(q, matchMode, exactPostingTerms),
    searchMode,
    postingsByTerm
  );
}

function readUnsignedPostingVarint(binary: string, state: { offset: number }): number {
  let value = 0;
  let multiplier = 1;
  while (state.offset < binary.length) {
    const byte = binary.charCodeAt(state.offset);
    state.offset += 1;
    value += (byte & 0x7f) * multiplier;
    if ((byte & 0x80) === 0) return value;
    multiplier *= 128;
    if (!Number.isSafeInteger(value) || multiplier > Number.MAX_SAFE_INTEGER) break;
  }
  throw new Error("検索postingが壊れています");
}

type ClientExactTextBlock = {
  key: string;
  url: string;
  byteStart: number;
  bytes: number;
  rawBytes: number;
  assetBytes: number;
  sha256: string;
  rawSha256: string;
  documentCount: number;
};

function exactTextBlockForDocument(
  range: ClientBigramExactTextRange,
  documentId: number,
  assetCatalog: ClientSearchAssetCatalog
): ClientExactTextBlock {
  const documentCount = range.end - range.start;
  const key = `exact:${range.exact_text_url}:${range.byte_start}:${range.byte_length}`;
  const asset = assetCatalog.assets[key];
  if (
    documentId < range.start
    || documentId >= range.end
    || documentCount <= 0
    || !Number.isInteger(range.byte_start)
    || range.byte_start < 0
    || !Number.isInteger(range.byte_length)
    || range.byte_length <= 0
    || !Number.isInteger(range.raw_bytes)
    || range.raw_bytes <= 0
    || !range.exact_text_url.startsWith(
      "/generated/search-bigram-statewide/exact-text/"
    )
    || !exactSearchAssetMetadataMatches(key, asset, {
      url: range.exact_text_url,
      byteStart: range.byte_start,
      bytes: range.byte_length,
      rawBytes: range.raw_bytes,
    })
  ) {
    throw new Error("検索本文ブロック番号が範囲外です");
  }
  return {
    key,
    url: range.exact_text_url,
    byteStart: range.byte_start,
    bytes: range.byte_length,
    rawBytes: range.raw_bytes,
    assetBytes: Number(asset.asset_bytes),
    sha256: asset.sha256,
    rawSha256: asset.raw_sha256,
    documentCount,
  };
}

function decodeClientNgramPosting(
  value: ClientStatewideBigramPostingValue
): ClientDecodedNgramPosting {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("検索postingが壊れています");
  }
  const binary = atob(value);
  const state = { offset: 0 };
  const documentIds: number[] = [];
  let previousDocumentId = -1;
  while (state.offset < binary.length) {
    const documentDelta = readUnsignedPostingVarint(binary, state);
    if (documentDelta <= 0) throw new Error("検索postingが壊れています");
    const documentId = previousDocumentId + documentDelta;
    documentIds.push(documentId);
    previousDocumentId = documentId;
  }
  return { documentIds };
}

function searchAssetPlan(key: string, asset: ClientSearchAssetMetadata): ClientSearchAssetPlan {
  try {
    return searchAssetPlanFromCatalog(key, asset);
  } catch {
    throw new Error("検索asset catalogの対応関係が壊れています");
  }
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function gunzipSearchAsset(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("このブラウザは圧縮検索索引に対応していません");
  }
  return new Response(
    new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip"))
  ).arrayBuffer();
}

function reconcileSearchAssetActualBytes(
  caches: ClientTransientSearchCaches,
  key: string,
  gzipBytes: number,
  rawBytes: number,
  required: boolean
): boolean {
  const accepted = reconcileSearchTransferAttempt(
    caches.transferBudget,
    key,
    gzipBytes,
    rawBytes,
    SEARCH_TRANSFER_LIMITS
  );
  if (!accepted) {
    if (required) {
      throw new Error("検索範囲が広すぎるため、検索語を追加して絞り込んでください。");
    }
    return false;
  }
  return true;
}

async function loadJsonWithCache<T>(
  url: string,
  cache: Map<string, T>,
  caches: ClientTransientSearchCaches,
  maxBytes: number,
  signal: AbortSignal,
  validate: (value: T) => boolean,
  errorMessage: string
): Promise<T> {
  const cached = cache.get(url);
  if (cached) return cached;
  const inFlight = caches.manifests.get(url) as Promise<T> | undefined;
  if (inFlight) {
    const data = await inFlight;
    if (signal.aborted) throw new Error("検索を中断しました");
    return data;
  }
  const key = `manifest:${url}`;
  const promise = (async () => {
    const attemptKey = beginSearchAssetFetch(
      caches,
      { key, gzipBytes: maxBytes, rawBytes: maxBytes, allowDecrease: true },
      true
    );
    if (!attemptKey) {
      throw new Error("検索範囲が広すぎるため、検索語を追加して絞り込んでください。");
    }
    const response = await fetch(url, { cache: "no-cache", signal });
    const declaredLength = response.headers.get("content-length");
    if (
      declaredLength !== null
      && declaredLength.trim() !== ""
      && Number.isSafeInteger(Number(declaredLength))
      && Number(declaredLength) > maxBytes
    ) {
      await cancelSearchResponseBody(response);
      reconcileSearchAssetActualBytes(
        caches,
        attemptKey,
        Number(declaredLength),
        Number(declaredLength),
        true
      );
      throw new Error(errorMessage);
    }
    if (!response.ok) {
      await cancelSearchResponseBody(response);
      throw new Error(errorMessage);
    }
    const buffer = await response.arrayBuffer();
    const wireBytes = responseWireBytes(response.headers, buffer.byteLength);
    reconcileSearchAssetActualBytes(caches, attemptKey, wireBytes, buffer.byteLength, true);
    if (buffer.byteLength > maxBytes) throw new Error(errorMessage);
    const data = JSON.parse(new TextDecoder().decode(buffer)) as T;
    if (!validate(data)) throw new Error(errorMessage);
    cache.set(url, data);
    return data;
  })();
  caches.manifests.set(url, promise);
  try {
    return await promise;
  } catch (error) {
    caches.manifests.delete(url);
    throw error;
  }
}

async function loadCompressedJsonWithCache<T>(
  url: string,
  payloadCache: Map<string, ClientCachedSearchAsset<T>>,
  caches: ClientTransientSearchCaches,
  assetKey: string,
  asset: ClientSearchAssetMetadata,
  signal: AbortSignal,
  validate: (value: T) => boolean,
  errorMessage: string
): Promise<T> {
  const plan = searchAssetPlan(assetKey, asset);
  const fingerprint = searchAssetMetadataFingerprint(asset);
  const cached = payloadCache.get(url);
  if (cached && cached.fingerprint !== fingerprint) {
    throw new Error("検索asset catalogの世代が一致しません");
  }
  let promise = cached?.promise;
  if (!promise) {
    const attemptKey = beginSearchAssetFetch(caches, plan, true);
    if (!attemptKey) {
      throw new Error("検索範囲が広すぎるため、検索語を追加して絞り込んでください。");
    }
    promise = fetch(url, { cache: "no-cache", signal })
      .then(async (response) => {
        if (!response.ok) {
          const reportedWireBytes = responseWireBytes(response.headers, asset.bytes);
          await cancelSearchResponseBody(response);
          reconcileSearchAssetActualBytes(
            caches,
            attemptKey,
            reportedWireBytes,
            asset.raw_bytes,
            true
          );
          throw new Error(errorMessage);
        }
        const buffer = await response.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        const wireBytes = responseWireBytes(response.headers, buffer.byteLength);
        reconcileSearchAssetActualBytes(
          caches,
          attemptKey,
          wireBytes,
          buffer.byteLength,
          true
        );
        let rawBuffer: ArrayBuffer;
        if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
          if (buffer.byteLength !== asset.bytes || await sha256Hex(buffer) !== asset.sha256) {
            throw new Error(errorMessage);
          }
          rawBuffer = await gunzipSearchAsset(buffer);
        } else {
          rawBuffer = buffer;
        }
        reconcileSearchAssetActualBytes(
          caches,
          attemptKey,
          wireBytes,
          rawBuffer.byteLength,
          true
        );
        if (
          rawBuffer.byteLength !== asset.raw_bytes
          || await sha256Hex(rawBuffer) !== asset.raw_sha256
        ) {
          throw new Error(errorMessage);
        }
        const data = JSON.parse(new TextDecoder().decode(rawBuffer)) as T;
        if (!validate(data)) throw new Error(errorMessage);
        return data;
      })
      .catch((error) => {
        payloadCache.delete(url);
        throw error;
      });
    payloadCache.set(url, { fingerprint, promise });
  }
  const data = await promise;
  if (signal.aborted) throw new Error("検索を中断しました");
  return data;
}

async function loadClientSearchAssetCatalog(
  reference: ClientSearchAssetReference,
  caches: ClientTransientSearchCaches,
  signal: AbortSignal
): Promise<ClientSearchAssetCatalog> {
  if (
    reference?.encoding !== "gzip"
    || reference.url !== "/generated/search-bigram-statewide/asset-catalog.json.gz"
    || !validSearchAssetMetadata(reference)
  ) {
    throw new Error("検索asset catalog参照が壊れています");
  }
  const key = `catalog:${reference.url}`;
  return loadCompressedJsonWithCache<ClientSearchAssetCatalog>(
    reference.url,
    caches.catalogs,
    caches,
    key,
    reference,
    signal,
    (data) =>
      data?.version === 1
      && typeof data.generated_at === "string"
      && data.assets
      && typeof data.assets === "object"
      && !Array.isArray(data.assets)
      && Object.values(data.assets).every(validSearchAssetMetadata),
    "検索asset catalogの読み込みに失敗しました"
  );
}

async function loadClientExactTextBlock(
  block: ClientExactTextBlock,
  caches: ClientTransientSearchCaches,
  signal: AbortSignal,
  required: boolean
): Promise<string[]> {
  const key = block.key;
  const fingerprint = JSON.stringify([
    block.url,
    block.byteStart,
    block.bytes,
    block.rawBytes,
    block.assetBytes,
    block.sha256,
    block.rawSha256,
  ]);
  const cached = caches.exactText.get(key);
  if (cached && cached.fingerprint !== fingerprint) {
    throw new Error("検索本文ブロックの世代が一致しません");
  }
  let promise = cached?.promise;
  if (!promise) {
    const attemptKey = beginSearchAssetFetch(
      caches,
      { key, gzipBytes: block.bytes, rawBytes: block.rawBytes },
      required
    );
    if (!attemptKey) {
      throw new Error("検索範囲が広すぎるため、検索語を追加して絞り込んでください。");
    }
    const byteEnd = block.byteStart + block.bytes - 1;
    const wholeAsset = block.byteStart === 0 && block.bytes === block.assetBytes;
    promise = fetch(block.url, {
      cache: "no-cache",
      headers: wholeAsset ? undefined : { Range: `bytes=${block.byteStart}-${byteEnd}` },
      signal,
    })
      .then(async (response) => {
        const reportedWireBytes = responseWireBytes(response.headers, block.bytes);
        const responseMode = searchExactTextResponseMode(
          response.status,
          response.headers.get("content-range"),
          block.byteStart,
          block.bytes,
          block.assetBytes
        );
        if (!responseMode) {
          await cancelSearchResponseBody(response);
          reconcileSearchAssetActualBytes(
            caches,
            attemptKey,
            reportedWireBytes,
            block.rawBytes,
            required
          );
          throw new Error("検索本文の取得範囲が壊れています");
        }
        const contentLength = response.headers.get("content-length");
        if (
          contentLength !== null
          && contentLength.trim() !== ""
          && Number(contentLength) !== block.bytes
        ) {
          await cancelSearchResponseBody(response);
          reconcileSearchAssetActualBytes(
            caches,
            attemptKey,
            reportedWireBytes,
            block.rawBytes,
            required
          );
          throw new Error("検索本文の部分読み込み長が壊れています");
        }
        const buffer = await response.arrayBuffer();
        if (!reconcileSearchAssetActualBytes(
          caches,
          attemptKey,
          responseWireBytes(response.headers, buffer.byteLength),
          block.rawBytes,
          required
        )) {
          throw new Error("検索範囲が広すぎるため、検索語を追加して絞り込んでください。");
        }
        if (
          buffer.byteLength !== block.bytes
          || await sha256Hex(buffer) !== block.sha256
        ) {
          throw new Error("検索本文ブロックが壊れています");
        }
        const rawBuffer = await gunzipSearchAsset(buffer);
        if (!reconcileSearchAssetActualBytes(
          caches,
          attemptKey,
          responseWireBytes(response.headers, buffer.byteLength),
          rawBuffer.byteLength,
          required
        )) {
          throw new Error("検索範囲が広すぎるため、検索語を追加して絞り込んでください。");
        }
        if (
          rawBuffer.byteLength !== block.rawBytes
          || await sha256Hex(rawBuffer) !== block.rawSha256
        ) {
          throw new Error("検索本文ブロックが壊れています");
        }
        const text = new TextDecoder().decode(rawBuffer);
        const values = JSON.parse(text) as unknown;
        if (
          !Array.isArray(values)
          || values.length !== block.documentCount
          || !values.every((value) => typeof value === "string")
        ) {
          throw new Error("検索本文ブロックが壊れています");
        }
        return values;
      })
      .catch((error) => {
        caches.exactText.delete(key);
        throw error;
      });
    caches.exactText.set(key, { fingerprint, promise });
  }
  return promise;
}

type BigramCandidateResolution = {
  candidateIds: number[];
  verificationIds: number[];
};

function findBigramPayloadRange<T extends { start: number; end: number }>(
  cityMeta: Pick<ClientBigramCityEntry, "slug" | "document_count">,
  ranges: T[],
  documentIndex: number
): T {
  if (!Number.isInteger(documentIndex) || documentIndex < 0 || documentIndex >= cityMeta.document_count) {
    throw new Error(`${cityMeta.slug}の検索文書番号が範囲外です`);
  }
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const range = ranges[middle];
    if (documentIndex < range.start) high = middle - 1;
    else if (documentIndex >= range.end) low = middle + 1;
    else return range;
  }
  throw new Error(`${cityMeta.slug}の検索文書rangeが見つかりません`);
}

function uniqueBigramPayloadRanges<T extends ClientBigramPayloadRange>(
  cityMeta: Pick<ClientBigramCityEntry, "slug" | "document_count">,
  candidates: T[],
  documentIds: number[],
  rangeKey: (range: T) => string
): T[] {
  const ranges = new Map<string, T>();
  for (const documentId of documentIds) {
    const range = findBigramPayloadRange(cityMeta, candidates, documentId);
    ranges.set(rangeKey(range), range);
  }
  return Array.from(ranges.values());
}

function exactTextBlocksForDocumentIds(
  cityMeta: ClientBigramCityEntry,
  documentIds: number[],
  assetCatalog: ClientSearchAssetCatalog
): Map<string, { range: ClientBigramExactTextRange; block: ClientExactTextBlock; documentIds: number[] }> {
  const blocks = new Map<
    string,
    { range: ClientBigramExactTextRange; block: ClientExactTextBlock; documentIds: number[] }
  >();
  for (const documentId of documentIds) {
    const range = findBigramPayloadRange(cityMeta, cityMeta.exact_text_ranges, documentId);
    const block = exactTextBlockForDocument(range, documentId, assetCatalog);
    const key = block.key;
    const entry = blocks.get(key) ?? { range, block, documentIds: [] };
    entry.documentIds.push(documentId);
    blocks.set(key, entry);
  }
  return blocks;
}

function assertExactTextTransferPlan(
  plans: Array<{ cityMeta: ClientBigramCityEntry; documentIds: number[] }>,
  caches: ClientTransientSearchCaches,
  assetCatalog: ClientSearchAssetCatalog
): void {
  const assetPlans: ClientSearchAssetPlan[] = [];
  for (const { cityMeta, documentIds } of plans) {
    for (const [key, { block }] of exactTextBlocksForDocumentIds(
      cityMeta,
      documentIds,
      assetCatalog
    )) {
      assetPlans.push({ key, gzipBytes: block.bytes, rawBytes: block.rawBytes });
    }
  }
  reserveSearchAssets(caches, assetPlans, true);
}

function assertDocumentTransferPlan(
  plans: Array<{ cityMeta: ClientBigramCityEntry; documentIds: number[] }>,
  caches: ClientTransientSearchCaches,
  assetCatalog: ClientSearchAssetCatalog
): void {
  const assetPlans = plans.flatMap(({ cityMeta, documentIds }) =>
    uniqueBigramPayloadRanges(
      cityMeta,
      cityMeta.document_ranges,
      documentIds,
      (range) => range.documents_url
    ).map((range) => {
      const key = `document:${range.documents_url}`;
      return searchAssetPlan(key, assetCatalog.assets[key]);
    })
  );
  reserveSearchAssets(caches, assetPlans, true);
}

async function loadClientBigramCandidateDocuments(
  cityMeta: ClientBigramCityEntry,
  resolutions: {
    strict: BigramCandidateResolution;
    fallback: BigramCandidateResolution;
  },
  q: string,
  searchMode: SearchMode,
  signal: AbortSignal,
  caches: ClientTransientSearchCaches,
  assetCatalog: ClientSearchAssetCatalog
): Promise<{
  strict: ClientBigramSearchDocument[];
  fallback: ClientBigramSearchDocument[];
}> {
  const candidateIds = unionNumberLists([
    resolutions.strict.candidateIds,
    resolutions.fallback.candidateIds,
  ]);
  if (candidateIds.length === 0) return { strict: [], fallback: [] };

  const verificationIds = unionNumberLists([
    resolutions.strict.verificationIds,
    resolutions.fallback.verificationIds,
  ]);
  assertExactTextTransferPlan([{ cityMeta, documentIds: verificationIds }], caches, assetCatalog);
  assertDocumentTransferPlan([{ cityMeta, documentIds: candidateIds }], caches, assetCatalog);
  const exactTextById = new Map<number, string>();
  const loadExactTexts = async (documentIds: number[], required: boolean) => {
    const blocks = exactTextBlocksForDocumentIds(cityMeta, documentIds, assetCatalog);
    const selectedBlocks: Array<{
      key: string;
      range: ClientBigramExactTextRange;
      block: ClientExactTextBlock;
      documentIds: number[];
    }> = [];
    if (required) {
      reserveSearchAssets(
        caches,
        Array.from(blocks, ([key, { block }]) => ({
          key,
          gzipBytes: block.bytes,
          rawBytes: block.rawBytes,
        })),
        true
      );
      for (const [key, value] of blocks) selectedBlocks.push({ key, ...value });
    } else {
      for (const [key, value] of blocks) {
        if (!caches.snippetExactTextKeys.has(key)) {
          if (
            caches.snippetExactTextKeys.size
            >= MAX_EXACT_TEXT_SNIPPET_BLOCKS_PER_SEARCH
          ) {
            continue;
          }
          if (!reserveSearchAssets(
            caches,
            [{ key, gzipBytes: value.block.bytes, rawBytes: value.block.rawBytes }],
            false
          )) {
            continue;
          }
          caches.snippetExactTextKeys.add(key);
        }
        selectedBlocks.push({ key, ...value });
      }
    }
    const payloads = await Promise.all(
      selectedBlocks.map(async ({ range, block, documentIds: ids }) => {
        try {
          return {
            range,
            documentIds: ids,
            texts: await loadClientExactTextBlock(block, caches, signal, required),
          };
        } catch (error) {
          if (required || signal.aborted) throw error;
          return null;
        }
      })
    );
    for (const payload of payloads) {
      if (!payload) continue;
      for (const documentId of payload.documentIds) {
        const text = payload.texts[documentId - payload.range.start];
        if (typeof text !== "string") {
          if (required) throw new Error(`${cityMeta.slug}の検索本文が欠落しています`);
          continue;
        }
        exactTextById.set(documentId, text);
      }
    }
  };
  await loadExactTexts(verificationIds, true);

  const documentsById = new Map<number, ClientBigramSearchDocument>();
  const loadDocuments = async (documentIds: number[]) => {
    const documentRanges = uniqueBigramPayloadRanges(
      cityMeta,
      cityMeta.document_ranges,
      documentIds,
      (range) => range.documents_url
    );
    reserveSearchAssets(caches, documentRanges.map((range) => {
      const key = `document:${range.documents_url}`;
      return searchAssetPlan(key, assetCatalog.assets[key]);
    }), true);
    const documentPayloads = await Promise.all(
      documentRanges.map(async (range) => ({
        range,
        documents: await loadCompressedJsonWithCache<ClientBigramSearchDocument[]>(
          range.documents_url,
          caches.documents,
          caches,
          `document:${range.documents_url}`,
          assetCatalog.assets[`document:${range.documents_url}`],
          signal,
          (data) => Array.isArray(data) && data.length >= range.payload_end,
          "検索文書rangeの読み込みに失敗しました"
        ),
      }))
    );
    for (const { range, documents } of documentPayloads) {
      payloadSliceForRange(documents, range)
        .forEach((document, offset) => {
          documentsById.set(range.start + offset, document);
        });
    }
  };
  await loadDocuments(verificationIds);

  const exactEvaluationText = (documentId: number) => {
    const evidenceText = exactTextById.get(documentId);
    const document = documentsById.get(documentId);
    if (evidenceText === undefined || !document) {
      throw new Error(`${cityMeta.slug}の検索本文が欠落しています`);
    }
    if (document.source === "member_activity") {
      return [
        document.cityName,
        document.member_name,
        document.title,
        document.committee,
        document.label,
        document.metaText,
        evidenceText,
      ].filter(Boolean).join(" ");
    }
    return [documentSearchText(document), evidenceText].filter(Boolean).join(" ");
  };

  const searchQuery = buildSearchQuery(q);
  const acceptedIds = (mode: "strict" | "fallback") => {
    const resolution = resolutions[mode];
    const verificationSet = new Set(resolution.verificationIds);
    const evaluateText = createSearchTextEvaluator(searchQuery, searchMode, mode);
    return resolution.candidateIds.filter((documentId) => {
      if (!verificationSet.has(documentId)) return true;
      return evaluateText(exactEvaluationText(documentId)).matched;
    });
  };
  const accepted = {
    strict: acceptedIds("strict"),
    fallback: acceptedIds("fallback"),
  };
  const acceptedDocumentIds = unionNumberLists([accepted.strict, accepted.fallback]);
  await loadDocuments(acceptedDocumentIds);

  // A bounded optional Range read gives the first raw-minutes results a useful
  // excerpt even when a short n-gram or dedicated exact posting proved the hit.
  const snippetDocumentIds = acceptedDocumentIds
    .filter((documentId) => {
      if (exactTextById.has(documentId)) return false;
      const document = documentsById.get(documentId);
      return document?.sourceType === "minutes" && document.fullTextIndexed === true;
    })
    .sort((left, right) => {
      const leftRaw = documentsById.get(left)?.id.startsWith("agenda-fulltext:") ? 0 : 1;
      const rightRaw = documentsById.get(right)?.id.startsWith("agenda-fulltext:") ? 0 : 1;
      return leftRaw - rightRaw || left - right;
    })
    .slice(0, 12);
  await loadExactTexts(snippetDocumentIds, false);

  const hydrate = (resolution: BigramCandidateResolution, documentIds: number[]) => {
    const verificationSet = new Set(resolution.verificationIds);
    return documentIds.map((documentId) => {
      const document = documentsById.get(documentId);
      if (!document) throw new Error(`${cityMeta.slug}の検索文書が欠落しています`);
      const exactText = exactTextById.has(documentId)
        ? exactEvaluationText(documentId)
        : undefined;
      if (!verificationSet.has(documentId)) {
        return { ...document, _exactText: exactText, _bigramExact: true };
      }
      return { ...document, _exactText: exactEvaluationText(documentId), _bigramExact: false };
    });
  };

  return {
    strict: hydrate(resolutions.strict, accepted.strict),
    fallback: hydrate(resolutions.fallback, accepted.fallback),
  };
}

async function loadClientBigramCitySearch(
  city: string,
  q: string,
  searchMode: SearchMode,
  matchMode: "strict" | "fallback",
  signal: AbortSignal,
  caches: ClientTransientSearchCaches
): Promise<{
  manifest: ClientBigramSearchManifest;
  candidateDocs: {
    strict: ClientBigramSearchDocument[];
    fallback: ClientBigramSearchDocument[];
  };
}> {
  if (!validateSearchQueryLimits(q).ok) {
    throw new Error(SEARCH_QUERY_LIMIT_MESSAGE);
  }
  if (!supportsBigramQuery(q)) {
    throw new Error("1文字検索は分割検索インデックスを使用します");
  }
  const baseUrl = `/generated/search-bigram-cities/${city}`;
  const manifest = await loadJsonWithCache<ClientBigramSearchManifest>(
    `${baseUrl}/manifest.json`,
    clientBigramManifestCache,
    caches,
    MAX_CITY_SEARCH_MANIFEST_BYTES,
    signal,
    (data) =>
      data?.version === 5
      && data.scope === "city-bigram"
      && data.city === city
      && Number.isFinite(data.bucket_count)
      && Array.isArray(data.ngram_widths)
      && data.ngram_widths.includes(2)
      && data.ngram_widths.includes(3)
      && data.positional_trigrams === false
      && Array.isArray(data.exact_terms)
      && data.postings_encoding === "gzip"
      && data.posting_value_encoding === "delta-varint-v1"
      && data.postings_base_url === "/generated/search-bigram-statewide/postings"
      && data.asset_catalog?.encoding === "gzip"
      && validSearchAssetMetadata(data.asset_catalog)
      && Array.isArray(data.document_ranges)
      && data.document_ranges.every(
        (range) =>
          range.encoding === "gzip"
          && range.documents_url.startsWith(
            "/generated/search-bigram-statewide/documents/"
          )
      )
      && Array.isArray(data.exact_text_ranges)
      && data.exact_text_ranges.every(
        (range) =>
          range.encoding === "gzip-member-json"
          && Number.isInteger(range.byte_start)
          && Number.isInteger(range.byte_length)
          && Number.isInteger(range.raw_bytes)
          && range.exact_text_url.startsWith(
            "/generated/search-bigram-statewide/exact-text/"
          )
      ),
    "市別検索インデックスの読み込みに失敗しました"
  );
  const assetCatalog = await loadClientSearchAssetCatalog(manifest.asset_catalog, caches, signal);
  if (assetCatalog.generated_at !== manifest.generated_at) {
    throw new Error("検索asset catalogの世代が一致しません");
  }
  const exactPostingTerms = new Set(manifest.exact_terms);
  const terms = Array.from(
    new Set(queryVariantTermGroups(q, matchMode, exactPostingTerms).flat(2))
  );
  const bucketFiles = Array.from(new Set(terms.map((term) => bigramBucketFile(bigramBucket(term)))))
    .filter((file) => manifest.buckets.includes(file));
  if (!validateSearchPostingPlan(terms, bucketFiles).ok) {
    throw new Error(SEARCH_QUERY_LIMIT_MESSAGE);
  }
  const postingUrls = bucketFiles.map((file) => `${manifest.postings_base_url}/${file}`);
  reserveSearchAssets(caches, postingUrls.map((url) => {
    const key = `posting:${url}`;
    return searchAssetPlan(key, assetCatalog.assets[key]);
  }), true);
  const buckets = await Promise.all(
    postingUrls.map((url) =>
      loadCompressedJsonWithCache<ClientStatewideBigramPostingBucket>(
        url,
        caches.postings,
        caches,
        `posting:${url}`,
        assetCatalog.assets[`posting:${url}`],
        signal,
        (data) => data && typeof data === "object" && !Array.isArray(data),
        "市別検索インデックスの読み込みに失敗しました"
      )
    )
  );
  const postingsByTerm = new Map<string, ClientDecodedNgramPosting>();
  for (const bucket of buckets) {
    for (const term of terms) {
      const ids = bucket[term]?.[city];
      if (ids) postingsByTerm.set(term, decodeClientNgramPosting(ids));
    }
  }
  const cityMeta: ClientBigramCityEntry = {
    slug: city,
    name: city,
    document_count: manifest.document_count,
    document_ranges: manifest.document_ranges,
    exact_text_ranges: manifest.exact_text_ranges,
  };
  const resolutions = {
    strict: matchMode === "strict"
      ? candidateResolutionFromBigramPostings(
          q,
          searchMode,
          postingsByTerm,
          "strict",
          exactPostingTerms
        )
      : { candidateIds: [], verificationIds: [] },
    fallback: matchMode === "fallback"
      ? candidateResolutionFromBigramPostings(
          q,
          searchMode,
          postingsByTerm,
          "fallback",
          exactPostingTerms
        )
      : { candidateIds: [], verificationIds: [] },
  };
  const candidateDocs = await loadClientBigramCandidateDocuments(
    cityMeta,
    resolutions,
    q,
    searchMode,
    signal,
    caches,
    assetCatalog
  );
  return { manifest, candidateDocs };
}

async function loadClientBigramStatewideSearch(
  manifestUrl: string,
  q: string,
  searchMode: SearchMode,
  matchMode: "strict" | "fallback",
  signal: AbortSignal,
  caches: ClientTransientSearchCaches
): Promise<{
  manifest: ClientStatewideBigramSearchManifest;
  candidateDocs: {
    strict: ClientBigramSearchDocument[];
    fallback: ClientBigramSearchDocument[];
  };
}> {
  if (!validateSearchQueryLimits(q).ok) {
    throw new Error(SEARCH_QUERY_LIMIT_MESSAGE);
  }
  if (!supportsBigramQuery(q)) {
    throw new Error("1文字検索は分割検索インデックスを使用します");
  }
  if (manifestUrl !== "/generated/search-bigram-statewide/manifest.json") {
    throw new Error("全道検索インデックスURLが壊れています");
  }
  const manifest = await loadJsonWithCache<ClientStatewideBigramSearchManifest>(
    manifestUrl,
    clientStatewideBigramManifestCache,
    caches,
    MAX_STATEWIDE_SEARCH_MANIFEST_BYTES,
    signal,
    (data) =>
      data?.version === 5
      && data.scope === "statewide-bigram"
      && Array.isArray(data.buckets)
      && Array.isArray(data.exact_terms)
      && Array.isArray(data.ngram_widths)
      && data.ngram_widths.includes(2)
      && data.ngram_widths.includes(3)
      && data.positional_trigrams === false
      && data.postings_encoding === "gzip"
      && data.posting_value_encoding === "delta-varint-v1"
      && data.asset_catalog?.encoding === "gzip"
      && validSearchAssetMetadata(data.asset_catalog)
      && Array.isArray(data.cities)
      && data.cities.every(
        (city) =>
          Array.isArray(city.document_ranges)
          && city.document_ranges.every(
            (range) =>
              range.encoding === "gzip"
              && range.documents_url.startsWith(
                "/generated/search-bigram-statewide/documents/"
              )
          )
          && Array.isArray(city.exact_text_ranges)
          && city.exact_text_ranges.every(
            (range) =>
              range.encoding === "gzip-member-json"
              && Number.isInteger(range.byte_start)
              && Number.isInteger(range.byte_length)
              && Number.isInteger(range.raw_bytes)
              && range.exact_text_url.startsWith(
                "/generated/search-bigram-statewide/exact-text/"
              )
          )
      )
      && Number.isFinite(data.bucket_count),
    "全道検索インデックスの読み込みに失敗しました"
  );
  const assetCatalog = await loadClientSearchAssetCatalog(manifest.asset_catalog, caches, signal);
  if (assetCatalog.generated_at !== manifest.generated_at) {
    throw new Error("検索asset catalogの世代が一致しません");
  }
  const exactPostingTerms = new Set(manifest.exact_terms);
  const terms = Array.from(
    new Set(queryVariantTermGroups(q, matchMode, exactPostingTerms).flat(2))
  );
  const bucketFiles = Array.from(new Set(terms.map((term) => bigramBucketFile(bigramBucket(term)))))
    .filter((file) => manifest.buckets.includes(file));
  if (!validateSearchPostingPlan(terms, bucketFiles).ok) {
    throw new Error(SEARCH_QUERY_LIMIT_MESSAGE);
  }
  const manifestBaseUrl = manifestUrl.slice(0, manifestUrl.lastIndexOf("/"));
  const postingUrls = bucketFiles.map((file) => `${manifestBaseUrl}/postings/${file}`);
  reserveSearchAssets(caches, postingUrls.map((url) => {
    const key = `posting:${url}`;
    return searchAssetPlan(key, assetCatalog.assets[key]);
  }), true);
  const buckets = await Promise.all(
    postingUrls.map((url) =>
      loadCompressedJsonWithCache<ClientStatewideBigramPostingBucket>(
        url,
        caches.postings,
        caches,
        `posting:${url}`,
        assetCatalog.assets[`posting:${url}`],
        signal,
        (data) => data && typeof data === "object" && !Array.isArray(data),
        "全道検索インデックスの読み込みに失敗しました"
      )
    )
  );

  const postingsByCity = new Map<string, Map<string, ClientDecodedNgramPosting>>();
  for (const bucket of buckets) {
    for (const term of terms) {
      for (const [city, ids] of Object.entries(bucket[term] ?? {})) {
        if (!postingsByCity.has(city)) postingsByCity.set(city, new Map());
        postingsByCity.get(city)?.set(term, decodeClientNgramPosting(ids));
      }
    }
  }

  const manifestCities = new Map(manifest.cities.map((city) => [city.slug, city]));
  const candidatesByCity = Array.from(postingsByCity.entries()).flatMap(
    ([city, postingsByTerm]) => {
      const strict = matchMode === "strict"
        ? candidateResolutionFromBigramPostings(
            q,
            searchMode,
            postingsByTerm,
            "strict",
            exactPostingTerms
          )
        : { candidateIds: [], verificationIds: [] };
      const fallback = matchMode === "fallback"
        ? candidateResolutionFromBigramPostings(
            q,
            searchMode,
            postingsByTerm,
            "fallback",
            exactPostingTerms
          )
        : { candidateIds: [], verificationIds: [] };
      const candidateIds = unionNumberLists([strict.candidateIds, fallback.candidateIds]);
      const cityMeta = manifestCities.get(city);
      return cityMeta && candidateIds.length > 0
        ? [{ cityMeta, resolutions: { strict, fallback } }]
        : [];
    }
  );
  assertExactTextTransferPlan(
    candidatesByCity.map(({ cityMeta, resolutions }) => ({
      cityMeta,
      documentIds: unionNumberLists([
        resolutions.strict.verificationIds,
        resolutions.fallback.verificationIds,
      ]),
    })),
    caches,
    assetCatalog
  );
  assertDocumentTransferPlan(
    candidatesByCity.map(({ cityMeta, resolutions }) => ({
      cityMeta,
      documentIds: unionNumberLists([
        resolutions.strict.candidateIds,
        resolutions.fallback.candidateIds,
      ]),
    })),
    caches,
    assetCatalog
  );
  const cityCandidates = await Promise.all(
    candidatesByCity.map(({ cityMeta, resolutions }) =>
      loadClientBigramCandidateDocuments(
        cityMeta,
        resolutions,
        q,
        searchMode,
        signal,
        caches,
        assetCatalog
      )
    )
  );
  const candidateDocs = {
    strict: cityCandidates.flatMap((candidate) => candidate.strict),
    fallback: cityCandidates.flatMap((candidate) => candidate.fallback),
  };
  return { manifest, candidateDocs };
}

function dedupeSessionHits(results: RankedSessionHit[]): RankedSessionHit[] {
  const byKey = new Map<string, RankedSessionHit>();
  for (const result of sortSessionHits(results)) {
    const isMemberActivity = result.id.startsWith("member_activity:");
    const key = isMemberActivity
      ? `${result.city}:member_activity:${result.id}`
      : result.sourceType === "minutes" && result.href.includes("/minutes/")
        ? `${result.city}:minutes:${result.href.split("?")[0]}`
        : `${result.city}:${result.sourceType}:${result.id}`;
    if (!byKey.has(key)) byKey.set(key, result);
  }
  return Array.from(byKey.values());
}

function runClientBigramDocumentSearch(
  candidateDocs: {
    strict: ClientBigramSearchDocument[];
    fallback: ClientBigramSearchDocument[];
  },
  options: {
    q: string;
    searchMode: SearchMode;
    cityFilter: string;
    sourceFilter: SourceFilter;
    yearFilter: string;
    factionFilter: string;
  },
  resultScope: {
    scope: SearchIndexScope;
    label: string;
    fullSearchAvailable: boolean;
  }
): SearchResponse {
  const { q, searchMode, cityFilter, sourceFilter, yearFilter, factionFilter } = options;
  const searchQuery = buildSearchQuery(q);
  const queryAssist = buildSearchAssist(q);
  const exactExpandedTerms = queryAssist.find((group) => group.kind === "exact")?.terms ?? [];
  const relatedExpandedTerms = queryAssist.find((group) => group.kind === "related")?.terms ?? [];
  const searchSuggestions = queryAssist.find((group) => group.kind === "suggestion")?.terms ?? [];
  const tokens = searchQuery.highlightTokens;

  const collectResults = (
    mode: "strict" | "fallback"
  ): { sessionResults: RankedSessionHit[]; memberResults: RankedMemberHit[] } => {
    const sessionResults: RankedSessionHit[] = [];
    const memberResults: RankedMemberHit[] = [];
    const evaluateText = createSearchTextEvaluator(searchQuery, searchMode, mode);

    for (const doc of candidateDocs[mode]) {
      const metadataSearchText = documentSearchText(doc);
      const metadataEvaluation = evaluateText(metadataSearchText);
      const searchText = doc._exactText ?? metadataSearchText;
      const evaluation = evaluateText(searchText);
      const matchedByExactBigram = doc._bigramExact === true;
      if (!evaluation.matched && !matchedByExactBigram) continue;
      const matchedOutsideMetadata = !metadataEvaluation.matched;

      if (doc.source === "member") {
        const name = doc.name || doc.member_name || doc.title;
        const furigana = doc.furigana ?? "";
        const party = doc.party ?? "";
        const faction = doc.faction ?? "";
        const committees = doc.committees ?? [];
        let score = evaluation.score + 20;
        if (evaluateText(name).matched) score += 28;
        if (furigana && evaluateText(furigana).matched) score += 20;
        if (party && evaluateText(party).matched) score += 10;
        if (faction && evaluateText(faction).matched) score += 12;
        memberResults.push({
          city: doc.city,
          cityName: doc.cityName,
          href: doc.href || `/${doc.city}`,
          name,
          furigana,
          party,
          faction,
          committees,
          score,
        });
        continue;
      }

      const sourceType = doc.sourceType ?? (doc.source === "decision" ? "decision" : doc.source === "session" ? "session" : "minutes");
      const resultHref = doc.href || `/${doc.city}`;
      const exactContext = doc._exactText
        ? excerptSearchText(doc._exactText, tokens, 100)
        : "";
      let score = evaluation.score + (
        doc.source === "member_activity"
          ? 32
          : matchedOutsideMetadata
            ? 6
            : doc.source === "agenda"
              ? 14
              : 8
      );
      if (evaluateText(doc.title).matched) score += 16;
      if (doc.member_name && evaluateText(doc.member_name).matched) score += 12;
      if (doc.committee && evaluateText(doc.committee).matched) score += 8;
      sessionResults.push({
        id: doc.id,
        city: doc.city,
        cityName: doc.cityName,
        sourceType,
        title: doc.title,
        committee: doc.committee ?? (sourceType === "decision" ? "議決結果" : ""),
        href: sourceType === "minutes"
          ? appendSearchQueryToHref(resultHref, q)
          : resultHref,
        segIndex: 0,
        label: doc.label ?? "",
        startTime: doc.start_time ?? "",
        context: exactContext || (matchedOutsideMetadata
          ? mode === "fallback"
            ? "検索対象の本文が検索語または同義・関連語に該当する会議です。原文で該当箇所を確認できます。"
            : exactExpandedTerms.length > 0
              ? "検索対象の本文が検索語または同義語に該当する会議です。原文で該当箇所を確認できます。"
              : `検索対象の本文が検索語「${tokens.join("・")}」に該当する会議です。原文で該当箇所を確認できます。`
          : excerptSearchText(doc.context || doc.body || metadataSearchText, tokens, 100)),
        field: doc.field ?? (sourceType === "decision" ? "議決" : sourceType === "session" ? "会議録速報" : "議事録"),
        date: doc.date,
        year: doc.year || yearFromDate(doc.date) || yearFromCouncilName(doc.title),
        score,
      });
    }

    return {
      sessionResults: dedupeSessionHits(sessionResults),
      memberResults: sortMemberHits(memberResults),
    };
  };

  const strictResults = collectResults("strict");
  let sessionResults = strictResults.sessionResults;
  let memberResults = strictResults.memberResults;
  let sessionRescued = false;
  let memberRescued = false;

  const sessionMatchesActiveFilters = (result: RankedSessionHit) =>
    (cityFilter === "all" || result.city === cityFilter)
    && (sourceFilter === "all" || result.sourceType === sourceFilter)
    && (yearFilter === "all" || result.year === yearFilter);
  const memberMatchesActiveFilters = (result: RankedMemberHit) =>
    (cityFilter === "all" || result.city === cityFilter)
    && (
      factionFilter === "all"
      || (result.faction || "無所属") === factionFilter
    );

  if (
    !sessionResults.some(sessionMatchesActiveFilters)
    || !memberResults.some(memberMatchesActiveFilters)
  ) {
    const fallbackResults = collectResults("fallback");
    if (
      !sessionResults.some(sessionMatchesActiveFilters)
      && fallbackResults.sessionResults.some(sessionMatchesActiveFilters)
    ) {
      sessionResults = fallbackResults.sessionResults;
      sessionRescued = true;
    }
    if (
      !memberResults.some(memberMatchesActiveFilters)
      && fallbackResults.memberResults.some(memberMatchesActiveFilters)
    ) {
      memberResults = fallbackResults.memberResults;
      memberRescued = true;
    }
  }

  const baseCityFacets = buildCityFacets(sessionResults, memberResults);
  const cityScopedSessions =
    cityFilter === "all" ? sessionResults : sessionResults.filter((result) => result.city === cityFilter);
  const cityScopedMembers =
    cityFilter === "all" ? memberResults : memberResults.filter((result) => result.city === cityFilter);
  const sessionSourceFacets = buildCountFacets(
    cityScopedSessions.map((result) => result.sourceType),
    (value) =>
      ({
        minutes: "議事録",
        session: "会議録速報",
        decision: "議決結果",
      })[value] ?? value
  );
  const effectiveSourceFilter = sourceFilter;
  const sourceScopedSessions =
    effectiveSourceFilter === "all"
      ? cityScopedSessions
      : cityScopedSessions.filter((result) => result.sourceType === effectiveSourceFilter);
  const sessionYearFacets = buildCountFacets(
    sourceScopedSessions.map((result) => result.year).filter(Boolean)
  );
  const effectiveYearFilter = yearFilter;
  const filteredSessions =
    effectiveYearFilter === "all"
      ? sourceScopedSessions
      : sourceScopedSessions.filter((result) => result.year === effectiveYearFilter);
  const memberFactionFacets = buildCountFacets(
    cityScopedMembers.map((result) => result.faction || "無所属")
  );
  const effectiveFactionFilter = factionFilter;
  const filteredMembers =
    effectiveFactionFilter === "all"
      ? cityScopedMembers
      : cityScopedMembers.filter((result) => (result.faction || "無所属") === effectiveFactionFilter);
  const maxResults = 200;

  return {
    sessionResults: stripSessionScore(filteredSessions.slice(0, maxResults)),
    memberResults: stripMemberScore(filteredMembers.slice(0, maxResults)),
    sessionTotal: filteredSessions.length,
    memberTotal: filteredMembers.length,
    sessionBaseTotal: filteredSessions.length,
    memberBaseTotal: filteredMembers.length,
    truncated: filteredSessions.length > maxResults || filteredMembers.length > maxResults,
    rescued: sessionRescued || memberRescued,
    sessionRescued,
    memberRescued,
    highlightTokens: tokens,
    queryAssist,
    exactExpandedTerms,
    relatedExpandedTerms,
    searchSuggestions,
    searchMode,
    facets: {
      cities: baseCityFacets,
      sessionSources: sessionSourceFacets,
      sessionYears: sessionYearFacets,
      memberFactions: memberFactionFacets,
    },
    searchScope: resultScope.scope,
    searchScopeLabel: resultScope.label,
    fullSearchAvailable: resultScope.fullSearchAvailable,
  };
}

function runClientBigramCitySearch(
  cityData: {
    manifest: ClientBigramSearchManifest;
    candidateDocs: {
      strict: ClientBigramSearchDocument[];
      fallback: ClientBigramSearchDocument[];
    };
  },
  options: {
    q: string;
    searchMode: SearchMode;
    cityFilter: string;
    sourceFilter: SourceFilter;
    yearFilter: string;
    factionFilter: string;
    tab: "sessions" | "members";
  }
): SearchResponse {
  return runClientBigramDocumentSearch(cityData.candidateDocs, options, {
    scope: "city",
    label: "選択中の市町村全期間",
    fullSearchAvailable: false,
  });
}

function runClientBigramStatewideSearch(
  candidateDocs: {
    strict: ClientBigramSearchDocument[];
    fallback: ClientBigramSearchDocument[];
  },
  options: {
    q: string;
    searchMode: SearchMode;
    cityFilter: string;
    sourceFilter: SourceFilter;
    yearFilter: string;
    factionFilter: string;
  }
): SearchResponse {
  return runClientBigramDocumentSearch(candidateDocs, options, {
    scope: "full",
    label: "全期間",
    fullSearchAvailable: false,
  });
}

async function runClientStatewideFullSearch(
  urls: {
    bigramIndexUrl?: string;
  },
  options: {
    q: string;
    searchMode: SearchMode;
    cityFilter: string;
    sourceFilter: SourceFilter;
    yearFilter: string;
    factionFilter: string;
    tab: "sessions" | "members";
  },
  signal: AbortSignal,
  caches: ClientTransientSearchCaches
): Promise<SearchResponse> {
  if (!supportsBigramQuery(options.q)) {
    throw new Error(SEARCH_QUERY_LIMIT_MESSAGE);
  }
  const strictData = await loadClientBigramStatewideSearch(
    urls.bigramIndexUrl ?? "/generated/search-bigram-statewide/manifest.json",
    options.q,
    options.searchMode,
    "strict",
    signal,
    caches
  );
  let response = runClientBigramStatewideSearch(strictData.candidateDocs, options);
  const activeBaseTotal = options.tab === "sessions"
    ? response.sessionBaseTotal
    : response.memberBaseTotal;
  if (activeBaseTotal === 0) {
    const fallbackData = await loadClientBigramStatewideSearch(
      urls.bigramIndexUrl ?? "/generated/search-bigram-statewide/manifest.json",
      options.q,
      options.searchMode,
      "fallback",
      signal,
      caches
    );
    response = runClientBigramStatewideSearch(
      {
        strict: strictData.candidateDocs.strict,
        fallback: fallbackData.candidateDocs.fallback,
      },
      options
    );
  }
  return response;
}

type SearchClientProps = {
  initialQuery?: string;
  initialTab?: string;
  initialSource?: string;
};

function SearchClientInner({ initialQuery = "", initialTab = "", initialSource = "" }: SearchClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.get("q") ?? initialQuery;
  const tab = normalizeSearchTab(searchParams.get("tab") ?? initialTab);
  const cityFilter = searchParams.get("city")?.trim() || "all";
  const cityLabelHint = searchParams.get("cityName") ?? "";
  const sourceFilter = tab === "sessions"
    ? normalizeSourceFilter(searchParams.get("source") ?? initialSource)
    : "all";
  const factionFilter = tab === "members" ? searchParams.get("faction")?.trim() || "all" : "all";
  const yearFilter = tab === "sessions" ? searchParams.get("year")?.trim() || "all" : "all";
  const sessionSort = tab === "sessions" ? normalizeSessionSortParam(searchParams.get("sessionSort")) : "relevance";
  const memberSort = tab === "members" ? normalizeMemberSortParam(searchParams.get("memberSort")) : "relevance";
  const searchMode = normalizeSearchModeParam(searchParams.get("op"));
  const [draftQuery, setDraftQuery] = useState(searchParams.get("q") ?? initialQuery);
  const [sessionResults, setSessionResults] = useState<SessionHit[]>([]);
  const [memberResults, setMemberResults] = useState<MemberHit[]>([]);
  const [sessionTotal, setSessionTotal] = useState(0);
  const [memberTotal, setMemberTotal] = useState(0);
  const [cityFacets, setCityFacets] = useState<SearchFacet[]>([]);
  const [sessionSourceFacets, setSessionSourceFacets] = useState<SearchFacet[]>([]);
  const [sessionYearFacets, setSessionYearFacets] = useState<SearchFacet[]>([]);
  const [memberFactionFacets, setMemberFactionFacets] = useState<SearchFacet[]>([]);
  const [exactExpandedTerms, setExactExpandedTerms] = useState<string[]>([]);
  const [relatedExpandedTerms, setRelatedExpandedTerms] = useState<string[]>([]);
  const [searchSuggestions, setSearchSuggestions] = useState<string[]>([]);
  const [searchScopeLabelText, setSearchScopeLabelText] = useState("");
  const [recentQueries, setRecentQueries] = useState<string[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [, setHasSearchResponse] = useState(false);
  const [error, setError] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sessionVisibleLimit, setSessionVisibleLimit] = useState(RESULT_PAGE_SIZE);
  const [memberVisibleLimit, setMemberVisibleLimit] = useState(RESULT_PAGE_SIZE);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);
  const resultsHeaderRef = useRef<HTMLDivElement | null>(null);

  const replaceSearchParams = useCallback((updates: SearchParamUpdates) => {
    const params = new URLSearchParams(searchParams.toString());
    setSearchParam(params, "q", query);
    if (tab !== "sessions") params.set("tab", tab);
    if (cityFilter !== "all") {
      params.set("city", cityFilter);
      setSearchParam(params, "cityName", cityLabelHint);
    }
    if (sourceFilter !== "all") params.set("source", sourceFilter);
    if (yearFilter !== "all") params.set("year", yearFilter);
    if (factionFilter !== "all") params.set("faction", factionFilter);
    if (searchMode !== "and") params.set("op", searchMode);
    if (sessionSort !== "relevance") params.set("sessionSort", sessionSort);
    if (memberSort !== "relevance") params.set("memberSort", memberSort);

    if ("q" in updates) setSearchParam(params, "q", updates.q);
    if ("tab" in updates) {
      if (updates.tab === "members") params.set("tab", "members");
      else params.delete("tab");
    }
    if ("city" in updates) setSearchParam(params, "city", updates.city);
    if ("cityName" in updates) setSearchParam(params, "cityName", updates.cityName);
    if ("source" in updates) setSearchParam(params, "source", updates.source);
    if ("year" in updates) setSearchParam(params, "year", updates.year);
    if ("faction" in updates) setSearchParam(params, "faction", updates.faction);
    if ("op" in updates) setSearchParam(params, "op", updates.op);
    if ("sessionSort" in updates) setSearchParam(params, "sessionSort", updates.sessionSort);
    if ("memberSort" in updates) setSearchParam(params, "memberSort", updates.memberSort);

    normalizeSearchParams(params);
    const nextParams = params.toString();
    if (nextParams === searchParams.toString()) return;
    router.replace(nextParams ? `${pathname}?${nextParams}` : pathname, { scroll: false });
  }, [
    pathname,
    router,
    searchParams,
    query,
    tab,
    cityFilter,
    cityLabelHint,
    sourceFilter,
    yearFilter,
    factionFilter,
    searchMode,
    sessionSort,
    memberSort,
  ]);

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    normalizeSearchParams(params);
    const nextParams = params.toString();
    if (nextParams === searchParams.toString()) return;
    router.replace(nextParams ? `${pathname}?${nextParams}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  useEffect(() => {
    setDraftQuery(query);
  }, [query]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("gikai-search-recent");
      if (!saved) return;
      const parsed = JSON.parse(saved) as string[];
      if (Array.isArray(parsed)) setRecentQueries(parsed.slice(0, 6));
    } catch {}
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!q) {
      setSessionResults([]);
      setMemberResults([]);
      setSessionTotal(0);
      setMemberTotal(0);
      setCityFacets([]);
      setSessionSourceFacets([]);
      setSessionYearFacets([]);
      setMemberFactionFacets([]);
      setExactExpandedTerms([]);
      setRelatedExpandedTerms([]);
      setSearchSuggestions([]);
      setSearchScopeLabelText("");
      setTruncated(false);
      setLoading(false);
      setHasSearchResponse(false);
      setError("");
      return;
    }
    setLoading(true);
    setHasSearchResponse(false);
    setError("");
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const controller = new AbortController();
    timerRef.current = setTimeout(async () => {
      const transientCaches = createClientTransientSearchCaches();
      try {
        if (!validateSearchQueryLimits(q).ok) {
          throw new Error(SEARCH_QUERY_LIMIT_MESSAGE);
        }
        const params = new URLSearchParams({
          q,
          op: searchMode,
        });
        if (cityFilter !== "all") params.set("city", cityFilter);
        if (tab === "sessions" && sourceFilter !== "all") params.set("source", sourceFilter);
        if (tab === "sessions" && yearFilter !== "all") params.set("year", yearFilter);
        if (tab === "members" && factionFilter !== "all") params.set("faction", factionFilter);
        const res = await fetch(`/api/search?${params.toString()}`, { signal: controller.signal });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "検索に失敗しました");
        }
        let data = (await res.json()) as SearchResponse;
        if (data.clientSearchRequired) {
          const clientSearchOptions = {
            q,
            searchMode,
            cityFilter,
            sourceFilter,
            yearFilter,
            factionFilter,
            tab,
          };
          if (cityFilter !== "all") {
            if (!supportsBigramQuery(q)) throw new Error(SEARCH_QUERY_LIMIT_MESSAGE);
            const strictCityData = await loadClientBigramCitySearch(
              cityFilter,
              q,
              searchMode,
              "strict",
              controller.signal,
              transientCaches
            );
            data = runClientBigramCitySearch(strictCityData, clientSearchOptions);
            const activeBaseTotal = tab === "sessions"
              ? data.sessionBaseTotal
              : data.memberBaseTotal;
            if (activeBaseTotal === 0) {
              const fallbackCityData = await loadClientBigramCitySearch(
                cityFilter,
                q,
                searchMode,
                "fallback",
                controller.signal,
                transientCaches
              );
              data = runClientBigramCitySearch(
                {
                  manifest: strictCityData.manifest,
                  candidateDocs: {
                    strict: strictCityData.candidateDocs.strict,
                    fallback: fallbackCityData.candidateDocs.fallback,
                  },
                },
                clientSearchOptions
              );
            }
          } else {
            data = await runClientStatewideFullSearch(
              {
                bigramIndexUrl: data.bigramIndexUrl,
              },
              clientSearchOptions,
              controller.signal,
              transientCaches
            );
          }
        }
        if (requestIdRef.current !== requestId) return;
        const nextSessionResults = data.sessionResults ?? [];
        const nextMemberResults = data.memberResults ?? [];
        setSessionResults(nextSessionResults);
        setMemberResults(nextMemberResults);
        setSessionTotal(data.sessionTotal ?? nextSessionResults.length);
        setMemberTotal(data.memberTotal ?? nextMemberResults.length);
        setCityFacets(data.facets?.cities ?? []);
        setSessionSourceFacets(data.facets?.sessionSources ?? []);
        setSessionYearFacets(data.facets?.sessionYears ?? []);
        setMemberFactionFacets(data.facets?.memberFactions ?? []);
        setExactExpandedTerms(data.exactExpandedTerms ?? []);
        setRelatedExpandedTerms(data.relatedExpandedTerms ?? []);
        setSearchSuggestions(data.searchSuggestions ?? []);
        setSearchScopeLabelText(data.searchScopeLabel ?? "");
        setTruncated(Boolean(data.truncated));
        setHasSearchResponse(true);
        if (
          tab === "sessions" &&
          nextSessionResults.length === 0 &&
          nextMemberResults.length > 0 &&
          looksLikeMemberNameSearch(q, nextMemberResults)
        ) {
          replaceSearchParams({ tab: "members" });
        }
        setRecentQueries((prev) => {
          const next = [q, ...prev.filter((item) => normalizeForSearch(item) !== normalizeForSearch(q))].slice(0, 6);
          try {
            window.localStorage.setItem("gikai-search-recent", JSON.stringify(next));
          } catch {}
          return next;
        });
      } catch (err) {
        if (controller.signal.aborted) return;
        setSessionResults([]);
        setMemberResults([]);
        setSessionTotal(0);
        setMemberTotal(0);
        setCityFacets([]);
        setSessionSourceFacets([]);
        setSessionYearFacets([]);
        setMemberFactionFacets([]);
        setExactExpandedTerms([]);
        setRelatedExpandedTerms([]);
        setSearchSuggestions([]);
        setSearchScopeLabelText("");
        setTruncated(false);
        setHasSearchResponse(true);
        setError(err instanceof Error ? err.message : "検索に失敗しました");
      } finally {
        clearClientTransientSearchCaches(transientCaches);
        if (requestIdRef.current === requestId) {
          setLoading(false);
        }
      }
    }, 220);

    return () => {
      controller.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, searchMode, cityFilter, sourceFilter, yearFilter, factionFilter, tab, replaceSearchParams]);

  const tokens = tokenize(query);
  const hasQuery = query.trim().length > 0;

  const sessionsAfterCity = cityFilter === "all" ? sessionResults : sessionResults.filter((r) => r.city === cityFilter);
  const sessionsAfterSource = sourceFilter === "all"
    ? sessionsAfterCity
    : sessionsAfterCity.filter((r) => r.sourceType === sourceFilter);
  const filteredSessions = yearFilter === "all"
    ? sessionsAfterSource
    : sessionsAfterSource.filter((r) => r.year === yearFilter);

  // 親フィルタ（city/source）が変わると子フィルタ（source/year/faction）の選択肢集合が
  // 変わる。前の選択値が新しい選択肢集合に含まれない場合、pill は非表示になるのに
  // state だけ残ってヒット数 0 の矛盾が起きるので "all" にリセットする。

  const membersAfterCity = cityFilter === "all" ? memberResults : memberResults.filter((m) => m.city === cityFilter);
  const filteredMembers = factionFilter === "all"
    ? membersAfterCity
    : membersAfterCity.filter((m) => (m.faction || "無所属") === factionFilter);

  const sortedSessions = [...filteredSessions].sort((a, b) => {
    if (sessionSort === "newest") {
      if (b.year !== a.year) return (b.year || "").localeCompare(a.year || "");
      if (a.cityName !== b.cityName) return a.cityName.localeCompare(b.cityName, "ja");
      return a.title.localeCompare(b.title, "ja");
    }
    return 0;
  });
  const sortedMembers = [...filteredMembers].sort((a, b) => {
    if (memberSort === "name") return a.name.localeCompare(b.name, "ja");
    if (memberSort === "city") {
      if (a.cityName !== b.cityName) return a.cityName.localeCompare(b.cityName, "ja");
      return a.name.localeCompare(b.name, "ja");
    }
    return 0;
  });

  useEffect(() => {
    setSessionVisibleLimit(RESULT_PAGE_SIZE);
    setMemberVisibleLimit(RESULT_PAGE_SIZE);
  }, [query, tab, cityFilter, sourceFilter, yearFilter, factionFilter, sessionSort, memberSort]);

  const totalResults = tab === "sessions" ? sortedSessions.length : sortedMembers.length;

  const availableSourceTypes = useMemo(
    () =>
      new Set(
        sessionSourceFacets
          .map((facet) => facet.value)
          .filter((value): value is SourceFilter => value === "minutes" || value === "session" || value === "decision")
      ),
    [sessionSourceFacets]
  );
  const sourceFacetCounts = new Map(sessionSourceFacets.map((facet) => [facet.value, facet.count]));
  const sessionSourceTotal = sessionSourceFacets.reduce((sum, facet) => sum + facet.count, 0);
  const availableFactions = memberFactionFacets.map((facet) => facet.value).filter(Boolean).sort();
  const factionFacetCounts = new Map(memberFactionFacets.map((facet) => [facet.value, facet.count]));
  const availableCities = cityFacets
    .map((facet) => ({
      id: facet.value,
      name: facet.label,
      count: facet.count,
    }))
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.name.localeCompare(b.name, "ja")));
  const availableYears = sessionYearFacets.map((facet) => facet.value).filter(Boolean).sort((a, b) => (a < b ? 1 : -1));
  const yearFacetCounts = new Map(sessionYearFacets.map((facet) => [facet.value, facet.count]));
  const sessionYearTotal = sessionYearFacets.reduce((sum, facet) => sum + facet.count, 0);

  const selectedCityLabel =
    cityFilter !== "all"
      ? cityFacets.find((facet) => facet.value === cityFilter)?.label || cityLabelHint
      : "";

  const activeFilters = [
    cityFilter !== "all" ? selectedCityLabel || cityFilter : "",
    tab === "sessions" && sourceFilter !== "all" ? SOURCE_FILTER_LABELS[sourceFilter] : "",
    tab === "sessions" && yearFilter !== "all" ? `${yearFilter}年` : "",
    tab === "members" && factionFilter !== "all" ? factionFilter : "",
  ].filter(Boolean);
  const exactOnlyTerms = exactExpandedTerms.filter(
    (term) => !tokens.some((token) => normalizeForSearch(token) === normalizeForSearch(term))
  );
  const relatedOnlyTerms = relatedExpandedTerms.filter(
    (term) =>
      !tokens.some((token) => normalizeForSearch(token) === normalizeForSearch(term)) &&
      !exactExpandedTerms.some((exactTerm) => normalizeForSearch(exactTerm) === normalizeForSearch(term))
  );
  const visibleSessions = sortedSessions.slice(0, sessionVisibleLimit);
  const visibleMembers = sortedMembers.slice(0, memberVisibleLimit);
  const groupedSessions = groupByCity(visibleSessions);
  const groupedMembers = groupByCity(visibleMembers);
  const showGroupedSessions = cityFilter === "all" && groupedSessions.length > 1;
  const showGroupedMembers = cityFilter === "all" && groupedMembers.length > 1;
  const remainingSessions = Math.max(0, sortedSessions.length - visibleSessions.length);
  const remainingMembers = Math.max(0, sortedMembers.length - visibleMembers.length);
  const hasFilterBlocks =
    hasQuery &&
    ((tab === "sessions" && (availableSourceTypes.size > 1 || availableYears.length > 1 || availableCities.length > 1)) ||
      (tab === "members" && (availableFactions.length > 1 || availableCities.length > 1)));
  const scopedCityLabel = cityFilter !== "all" ? selectedCityLabel || cityFilter : "";
  const exactMemberMatches = filteredMembers.filter(
    (member) => compactForSearch(member.name) === compactForSearch(query)
  );
  const exactMemberMatch = exactMemberMatches.length === 1 ? exactMemberMatches[0] : null;

  function clearFilters() {
    replaceSearchParams({
      city: "all",
      cityName: "",
      source: "all",
      faction: "all",
      year: "all",
      sessionSort: "relevance",
      memberSort: "relevance",
    });
  }

  function scrollToResultsHeader() {
    resultsHeaderRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function applyShortcut(tabValue: "sessions" | "members", sourceValue: SourceFilter) {
    setFiltersOpen(true);
    if (tabValue === "sessions") {
      replaceSearchParams({
        tab: tabValue,
        source: sourceValue,
        year: sourceValue !== "all" ? "all" : yearFilter,
        faction: "all",
        memberSort: "relevance",
      });
      return;
    }
    replaceSearchParams({
      tab: tabValue,
      source: "all",
      year: "all",
      faction: factionFilter,
      sessionSort: "relevance",
    });
  }

  function submitSearch() {
    const nextQuery = draftQuery.trim();
    if (nextQuery === query.trim()) return;
    replaceSearchParams({ q: nextQuery });
  }

  function clearSearch() {
    setDraftQuery("");
    replaceSearchParams({ q: "" });
  }

  return (
    <div className="page-shell flex max-w-5xl flex-col gap-4">
      <div className="theme-panel px-4 py-5 sm:px-6">
        <label htmlFor="site-search" className="mb-2 block text-lg font-black text-[#1B3A6B]">
          キーワード検索
        </label>
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            submitSearch();
          }}
        >
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#718096]"
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              aria-hidden="true">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              id="site-search"
              type="search"
              maxLength={MAX_SEARCH_QUERY_INPUT_LENGTH}
              value={draftQuery}
              onChange={(e) => setDraftQuery(e.target.value)}
              placeholder="給食無償化、除雪、ラピダス、防災、議員名で検索"
              className="theme-input w-full min-h-12 py-3 pl-9 pr-16 text-base sm:min-h-14 sm:text-lg"
            />
            {draftQuery && (
              <button
                onClick={clearSearch}
                className="absolute right-1 top-1/2 inline-flex min-h-11 min-w-11 -translate-y-1/2 items-center justify-center rounded text-xs font-bold text-[#718096] hover:text-[#1A202C] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8AA3CF]"
                aria-label="検索をクリア"
                type="button"
              >
                クリア
              </button>
            )}
          </div>
          <button type="submit" className="theme-button theme-button-accent min-h-12 px-5 text-sm sm:min-h-14">
            検索
          </button>
        </form>

        <div className="mt-3 flex flex-wrap gap-2">
          {SEARCH_SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              onClick={() => {
                setDraftQuery(suggestion);
                replaceSearchParams({ q: suggestion });
              }}
              className="inline-flex min-h-11 items-center rounded-full border border-[#CBD5E0] bg-white px-3 py-2 text-sm font-semibold text-[#1B3A6B] transition-colors hover:border-[#1B3A6B] hover:bg-[#E8EEF7]"
              type="button"
            >
              {suggestion}
            </button>
          ))}
        </div>

        <div className="mt-3">
          <Accordion title="詳しい条件" defaultOpen={searchMode === "or"}>
            <div className="space-y-3 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-[#667085]">複数語の条件</span>
                <div className="inline-flex rounded-full border border-[#CBD5E0] bg-white p-1">
                  <button
                    type="button"
                    onClick={() => replaceSearchParams({ op: "and" })}
                    className={`min-h-11 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                      searchMode === "and" ? "bg-[#1B3A6B] text-white" : "text-[#4A5568] hover:text-[#1B3A6B]"
                    }`}
                  >
                    AND
                  </button>
                  <button
                    type="button"
                    onClick={() => replaceSearchParams({ op: "or" })}
                    className={`min-h-11 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                      searchMode === "or" ? "bg-[#1B3A6B] text-white" : "text-[#4A5568] hover:text-[#1B3A6B]"
                    }`}
                  >
                    OR
                  </button>
                </div>
                <p className="text-sm text-[#667085]">
                  {searchMode === "and" ? "すべての語を含む結果を優先" : "どれかの語を含む結果を表示"}
                </p>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {SEARCH_SHORTCUTS.map((shortcut) => (
                  <button
                    key={shortcut.label}
                    onClick={() => applyShortcut(shortcut.tab, shortcut.source)}
                    className="theme-button px-3 py-1.5 text-[11px] sm:text-xs"
                    type="button"
                  >
                    {shortcut.label}
                  </button>
                ))}
              </div>
            </div>
          </Accordion>
        </div>

        {!hasQuery && recentQueries.length > 0 && (
          <div className="mt-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#667085]">最近の検索</p>
            <div className="flex flex-wrap gap-1.5">
              {recentQueries.map((item) => (
                <button
                  key={item}
                  onClick={() => {
                    setDraftQuery(item);
                    replaceSearchParams({ q: item });
                  }}
                  className="theme-pill-soft min-h-11 text-[#1B3A6B]"
                  type="button"
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        )}

        {!hasQuery && (
          <p className="mt-3 text-sm leading-relaxed text-[#667085]">
            {scopedCityLabel
              ? `${scopedCityLabel}に絞っています。議題名、政策テーマ、施設名、議員名、会派名などで探せます。`
              : "議題名、政策テーマ、施設名、議員名、会派名などで探せます。"}
          </p>
        )}
      </div>

      {hasQuery && (
        <div ref={resultsHeaderRef} className="theme-card-soft px-4 py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-black text-[#1B3A6B]">
                「{query.trim()}」の検索結果
              </p>
              <p className="mt-1 text-sm text-[#667085]">
                議事録・議決結果 {loading ? "…" : sessionTotal.toLocaleString()} 件 / 議員 {loading ? "…" : memberTotal.toLocaleString()} 名
              </p>
              <p className="mt-1 text-sm text-[#667085]">
                予算書は各市町村の「予算」ページで原本画像とOCR結果を検索できます。
              </p>
              {searchScopeLabelText && (
                <p className="mt-1 text-sm text-[#667085]">
                  検索対象: {searchScopeLabelText}
                </p>
              )}
              {activeFilters.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {activeFilters.map((filter) => (
                    <span key={filter} className="theme-pill-soft text-[#1B3A6B]">
                      {filter}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs font-semibold text-[#667085]" htmlFor="search-sort">
                並び順
              </label>
              <select
                id="search-sort"
                value={tab === "sessions" ? sessionSort : memberSort}
                onChange={(e) => {
                  if (tab === "sessions") {
                    replaceSearchParams({ sessionSort: e.target.value as SessionSort });
                    return;
                  }
                  replaceSearchParams({ memberSort: e.target.value as MemberSort });
                }}
                className="theme-select min-w-[8rem] px-3 py-2 text-sm"
              >
                {tab === "sessions" ? (
                  <>
                    <option value="relevance">関連度順</option>
                    <option value="newest">新しい順</option>
                  </>
                ) : (
                  <>
                    <option value="relevance">関連度順</option>
                    <option value="name">名前順</option>
                    <option value="city">市町村順</option>
                  </>
                )}
              </select>
              <button
                onClick={clearFilters}
                className="theme-button px-3 py-2 text-xs"
                type="button"
              >
                条件をリセット
              </button>
              {hasFilterBlocks && (
                <button
                  onClick={() => setFiltersOpen((value) => !value)}
                  className="theme-button px-3 py-2 text-xs sm:hidden"
                  type="button"
                >
                  {filtersOpen ? "絞り込みを閉じる" : "絞り込みを開く"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {hasQuery && !loading && (exactOnlyTerms.length > 0 || relatedOnlyTerms.length > 0) && (
        <div className="theme-card-soft px-4 py-3">
          <p className="text-xs font-semibold text-[#6B4C11]">表記ゆれを含めて検索しています</p>
          {exactOnlyTerms.length > 0 && (
            <div className="mt-2">
              <p className="mb-1 text-[11px] font-semibold text-[#667085]">同義語</p>
              <div className="flex flex-wrap gap-1.5">
                {exactOnlyTerms.slice(0, 8).map((term) => (
                  <span key={term} className="theme-pill-soft text-[#6B4C11]">
                    {term}
                  </span>
                ))}
              </div>
            </div>
          )}
          {relatedOnlyTerms.length > 0 && (
            <div className="mt-2">
              <p className="mb-1 text-[11px] font-semibold text-[#667085]">関連語</p>
              <div className="flex flex-wrap gap-1.5">
                {relatedOnlyTerms.slice(0, 8).map((term) => (
                  <span key={term} className="theme-pill-soft text-[#4A5568]">
                    {term}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* タブ */}
      {hasQuery && (
        <div className="flex border-b border-[#E2E8F0]">
          {(["sessions", "members"] as const).map((t) => (
            <button
              key={t}
              onClick={() => replaceSearchParams({ tab: t })}
              className={`min-h-11 px-3 py-2 text-sm font-medium border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8AA3CF] rounded-t sm:px-4 ${
                tab === t
                  ? "border-[#8AA3CF] text-[#1B3A6B]"
                  : "border-transparent text-[#718096] hover:text-[#1A202C]"
              }`}
              aria-current={tab === t ? "true" : undefined}
            >
              {t === "sessions" ? "議事録・議決結果" : "議員"}
              {!loading && (
                <span className="ml-1.5 rounded-full bg-[#F4F8FF] px-1.5 py-0.5 text-xs text-[#1B3A6B]">
                  {t === "sessions" ? filteredSessions.length : filteredMembers.length}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      <div className={`${hasFilterBlocks && !filtersOpen ? "hidden sm:block" : "block"} space-y-4`}>
      {/* 市フィルタ */}
      {hasQuery && (sessionResults.length > 0 || memberResults.length > 0) && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#667085]">市町村で絞る</p>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => replaceSearchParams({ city: "all", cityName: "" })}
              className={`min-h-11 text-xs px-2.5 py-1 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8AA3CF] ${
                cityFilter === "all"
                  ? "bg-[#FFF3BF] text-[#6B4C11] border-[#E6C566]"
                  : "bg-white text-[#4A5568] border-[#CBD5E0] hover:border-[#9FB1D2] hover:text-[#1B3A6B]"
              }`}
            >
              すべての市
            </button>
            {availableCities.map((c) => (
              <button
                key={c.id}
                onClick={() =>
                  replaceSearchParams({
                    city: cityFilter === c.id ? "all" : c.id,
                    cityName: cityFilter === c.id ? "" : c.name,
                  })
                }
                className={`min-h-11 text-xs px-2.5 py-1 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8AA3CF] ${
                  cityFilter === c.id
                    ? "bg-[#FFF3BF] text-[#6B4C11] border-[#E6C566]"
                    : "bg-white text-[#4A5568] border-[#CBD5E0] hover:border-[#9FB1D2] hover:text-[#1B3A6B]"
                }`}
              >
                {c.name}
                <span className="ml-1 opacity-70">{c.count}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 種別フィルタ (議会記録タブのみ) */}
      {tab === "sessions" && hasQuery && availableSourceTypes.size > 1 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#667085]">記録の種類</p>
          <div className="flex flex-wrap gap-1.5">
          {(["all", "minutes", "session", "decision"] as SourceFilter[])
            .filter((s) => s === "all" || availableSourceTypes.has(s))
            .map((s) => (
              <button
                key={s}
                onClick={() => replaceSearchParams({ source: s, year: s === "all" ? yearFilter : "all" })}
                className={`min-h-11 text-xs px-2.5 py-1 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8AA3CF] ${
                  sourceFilter === s
                    ? "bg-[#FFF3BF] text-[#6B4C11] border-[#E6C566]"
                    : "bg-white text-[#4A5568] border-[#CBD5E0] hover:border-[#9FB1D2] hover:text-[#2A5298]"
                }`}
              >
                {SOURCE_FILTER_LABELS[s]}
                <span className="ml-1 opacity-75">
                  {s === "all"
                    ? sessionSourceTotal
                    : sourceFacetCounts.get(s) ?? 0}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 年度フィルタ (議会記録タブのみ) */}
      {tab === "sessions" && hasQuery && availableYears.length > 1 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#667085]">年度</p>
          <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => replaceSearchParams({ year: "all" })}
            className={`min-h-11 text-xs px-2.5 py-1 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8AA3CF] ${
              yearFilter === "all"
                ? "bg-[#FFF3BF] text-[#6B4C11] border-[#E6C566]"
                : "bg-white text-[#4A5568] border-[#CBD5E0] hover:border-[#9FB1D2] hover:text-[#1B3A6B]"
            }`}
          >
            全期間
            <span className="ml-1 opacity-75">{sessionYearTotal}</span>
          </button>
          {availableYears.map((y) => (
            <button
              key={y}
              onClick={() => replaceSearchParams({ year: yearFilter === y ? "all" : y })}
              className={`min-h-11 text-xs px-2.5 py-1 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8AA3CF] ${
                yearFilter === y
                  ? "bg-[#FFF3BF] text-[#6B4C11] border-[#E6C566]"
                  : "bg-white text-[#4A5568] border-[#CBD5E0] hover:border-[#9FB1D2] hover:text-[#1B3A6B]"
              }`}
            >
              {y}年
              <span className="ml-1 opacity-75">
                {yearFacetCounts.get(y) ?? 0}
              </span>
            </button>
          ))}
          </div>
        </div>
      )}

      {/* 会派フィルタ (議員タブのみ) */}
      {tab === "members" && hasQuery && availableFactions.length > 1 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#667085]">会派</p>
          <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => replaceSearchParams({ faction: "all" })}
            className={`min-h-11 text-xs px-2.5 py-1 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8AA3CF] ${
              factionFilter === "all"
                ? "bg-[#FFF3BF] text-[#6B4C11] border-[#E6C566]"
                : "bg-white text-[#4A5568] border-[#CBD5E0] hover:border-[#9FB1D2] hover:text-[#2A5298]"
            }`}
          >
            すべての会派
            <span className="ml-1 opacity-75">{memberFactionFacets.reduce((sum, facet) => sum + facet.count, 0)}</span>
          </button>
          {availableFactions.map((f) => (
            <button
              key={f}
              onClick={() => replaceSearchParams({ faction: factionFilter === f ? "all" : f })}
              className={`min-h-11 text-xs px-2.5 py-1 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8AA3CF] ${
                factionFilter === f
                  ? "bg-[#FFF3BF] text-[#6B4C11] border-[#E6C566]"
                  : "bg-white text-[#4A5568] border-[#CBD5E0] hover:border-[#9FB1D2] hover:text-[#2A5298]"
              }`}
            >
              {f}
              <span className="ml-1 opacity-75">
                {factionFacetCounts.get(f) ?? 0}
              </span>
            </button>
          ))}
          </div>
        </div>
      )}
      </div>

      {/* 状態表示 */}
      {!hasQuery && (
        <div className="theme-card px-5 py-7 text-center text-[#718096] sm:px-6 sm:py-8">
          <p className="text-sm font-semibold text-[#4A5568]">キーワードを入力してください</p>
          <p className="mt-1 text-xs">政策テーマ、施設名、議員名、会派名などで探せます。</p>
        </div>
      )}

      {hasQuery && loading && (
        <div className="flex flex-col gap-3" aria-live="polite" aria-busy="true">
          <span className="sr-only">検索中...</span>
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="theme-card-soft animate-pulse px-4 py-3"
              style={{ animationDelay: `${i * 80}ms` }}
            >
              <div className="flex items-center gap-2 mb-2">
                <div className="h-4 w-16 rounded bg-[#E8EEF7]" />
                <div className="h-3 w-20 rounded bg-[#F4F6F9]" />
                <div className="h-3 w-12 rounded bg-[#F4F6F9] ml-auto" />
              </div>
              <div className="h-4 w-3/4 rounded bg-[#E2E8F0] mb-2" />
              <div className="h-3 w-full rounded bg-[#F4F6F9] mb-1" />
              <div className="h-3 w-5/6 rounded bg-[#F4F6F9]" />
            </div>
          ))}
        </div>
      )}

      {hasQuery && !loading && error && (
        <div className="theme-alert px-4 py-3 text-sm text-[#78451F]">
          {error}
        </div>
      )}

      {hasQuery && !loading && totalResults === 0 && (
        <div className="theme-card px-5 py-7 text-center text-[#718096] sm:px-6 sm:py-8">
          <p className="text-base font-semibold text-[#4A5568]">「{query.trim()}」の検索結果はありませんでした</p>
          <p className="mt-2 text-sm leading-relaxed text-[#4A5568]">
            別の語に変える、短い語にする、表記を変えると見つかることがあります。テーマ一覧や予算書の原本検索も確認できます。
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Link href="/topics" prefetch={false} className="theme-button px-4 py-2 text-sm">
              テーマ一覧を見る
            </Link>
            <Link href="/sources" prefetch={false} className="theme-button px-4 py-2 text-sm">
              予算書の掲載状況を見る
            </Link>
          </div>
          {searchSuggestions.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold text-[#1B3A6B]">代わりにこの語を試せます</p>
              <div className="flex flex-wrap justify-center gap-1.5">
                {searchSuggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => {
                      setDraftQuery(suggestion);
                      replaceSearchParams({ q: suggestion });
                    }}
                    className="theme-button px-3 py-1.5 text-xs"
                    type="button"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 議員サジェスト: sessions タブで議員名がマッチした場合、議員タブへの動線を上部に出す */}
      {tab === "sessions" && hasQuery && !loading && filteredMembers.length > 0 && (
        exactMemberMatch ? (
          <div className="theme-panel flex flex-col items-start gap-3 border-l-4 border-l-[#F7C948] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[#667085]">議員名の完全一致</p>
              <p className="mt-1 text-base font-black text-[#1B3A6B]">
                {exactMemberMatch.name}
                <span className="ml-2 text-sm font-medium text-[#4A5568]">{exactMemberMatch.cityName}</span>
              </p>
              {(exactMemberMatch.faction || exactMemberMatch.party) && (
                <p className="mt-1 text-sm text-[#667085]">
                  {exactMemberMatch.faction || exactMemberMatch.party}
                </p>
              )}
            </div>
            <Link
              href={exactMemberMatch.href}
              prefetch={false}
              className="theme-button theme-button-accent min-h-11 shrink-0 px-4 py-2 text-sm"
            >
              議員ページを見る
            </Link>
          </div>
        ) : (
          <div className="theme-panel flex flex-col items-start gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:py-2.5">
            <p className="text-xs text-[#1B3A6B] flex-1 min-w-0">
              <span className="font-semibold">議員</span>の検索結果が
              <span className="font-bold mx-0.5">{filteredMembers.length}</span>
              件あります:{" "}
              <span className="text-[#4A5568]">
                {filteredMembers.slice(0, 3).map((m) => `${m.name}（${m.cityName}）`).join(" / ")}
                {filteredMembers.length > 3 && " ほか"}
              </span>
            </p>
            <button
              onClick={() => replaceSearchParams({ tab: "members" })}
              className="theme-button shrink-0 px-3 py-1 text-xs"
            >
              議員タブを見る
            </button>
          </div>
        )
      )}

      {hasQuery && !loading && truncated && (
        <div className="theme-alert flex items-start gap-2 px-3 py-2 text-xs text-[#78451F]">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span>
            検索結果が上限（各カテゴリ200件）に達しました。キーワードを追加するか、
            市町村・種別・年度などのフィルタで絞り込んでください。
          </span>
        </div>
      )}

      {/* 議会記録結果 */}
      {tab === "sessions" && hasQuery && !loading && sortedSessions.length > 0 && (
        <div className="flex flex-col gap-3">
          {(showGroupedSessions ? groupedSessions : [{ city: "all", cityName: "すべて", items: visibleSessions }]).map((group) => (
            <div key={group.city} className={showGroupedSessions ? "theme-card-soft px-4 py-4" : ""}>
              {showGroupedSessions && (
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="theme-pill-soft text-[#1B3A6B]">{group.cityName}</span>
                    <span className="text-xs font-semibold text-[#667085]">{group.items.length}件</span>
                  </div>
                </div>
              )}
              <div className="flex flex-col gap-3">
                {group.items.map((r, i) => {
                  const dateLabel = formatSearchDate(r.date, r.year);
                  return (
                    <Link
                      key={`${group.city}-${i}`}
                      href={r.href}
                      prefetch={false}
                      className="theme-card block px-4 py-3 transition-colors hover:border-[#9FB1D2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8AA3CF] sm:px-5"
                    >
                      <div className="mb-1.5 flex items-center gap-1.5 flex-wrap">
                        {!showGroupedSessions && <span className="theme-pill-soft text-[#2A5298]">{r.cityName}</span>}
                        {r.sourceType === "minutes" ? (
                          <span className="theme-pill-soft opacity-85">公式議事録</span>
                        ) : r.sourceType === "decision" ? (
                          <span className="theme-pill-soft opacity-85">議決結果</span>
                        ) : (
                          <span className="theme-pill-soft text-[#2A5298] opacity-90">会議録速報</span>
                        )}
                        {dateLabel && (
                          <span className="theme-pill-soft tabular-nums text-[#4A5568]">{dateLabel}</span>
                        )}
                        {r.committee && r.sourceType !== "decision" && (
                          <span className="theme-pill-soft hidden text-[#1B3A6B] sm:inline-flex">{compactUiText(r.committee)}</span>
                        )}
                        {r.label && (
                          <span className="theme-pill-soft hidden sm:inline-flex">
                            {compactUiText(r.label)}
                            {r.startTime ? ` ${r.startTime}〜` : ""}
                          </span>
                        )}
                      </div>
                      <p className="mb-1 text-[15px] font-black leading-snug text-[#1B3A6B] sm:text-base">{r.title}</p>
                      <p className="text-[15px] leading-relaxed text-[#4A5568]">
                        <Highlight text={r.context} tokens={tokens} />
                      </p>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
          <ResultPager
            remaining={remainingSessions}
            unit="件"
            onMore={() => setSessionVisibleLimit((value) => value + RESULT_PAGE_SIZE)}
            onBack={scrollToResultsHeader}
          />
        </div>
      )}

      {/* 議員結果 */}
      {tab === "members" && hasQuery && !loading && sortedMembers.length > 0 && (
        <div className="flex flex-col gap-3">
          {(showGroupedMembers ? groupedMembers : [{ city: "all", cityName: "すべて", items: visibleMembers }]).map((group) => (
            <div key={group.city} className={showGroupedMembers ? "theme-card-soft px-4 py-4" : ""}>
              {showGroupedMembers && (
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="theme-pill-soft text-[#1B3A6B]">{group.cityName}</span>
                    <span className="text-xs font-semibold text-[#667085]">{group.items.length}名</span>
                  </div>
                </div>
              )}
              <div className="flex flex-col gap-2">
                {group.items.map((m, i) => (
                  <Link
                    key={`${group.city}-${i}`}
                    href={m.href}
                    prefetch={false}
                    className="theme-card block px-4 py-3 transition-colors hover:border-[#9FB1D2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8AA3CF] sm:px-5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <div>
                          <span className="text-base font-black text-[#1B3A6B]">
                            <Highlight text={m.name} tokens={tokens} />
                          </span>
                          <span className="ml-1.5 text-xs text-[#718096]">{m.furigana}</span>
                        </div>
                      </div>
                      {!showGroupedMembers && <span className="theme-pill-soft flex-shrink-0 text-[#2A5298]">{m.cityName}</span>}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {m.party && (
                        <span className="theme-pill-soft opacity-90">
                          <Highlight text={m.party} tokens={tokens} />
                        </span>
                      )}
                      {m.faction && m.faction !== m.party && (
                        <span className="theme-pill-soft opacity-90">
                          <Highlight text={m.faction} tokens={tokens} />
                        </span>
                      )}
                      {m.committees.slice(0, 3).map((c) => (
                        <span key={c} className="theme-pill-soft text-[#1B3A6B]">
                          <Highlight text={c} tokens={tokens} />
                        </span>
                      ))}
                      {m.committees.length > 3 && (
                        <span className="theme-pill-soft">+{m.committees.length - 3}</span>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
          <ResultPager
            remaining={remainingMembers}
            unit="名"
            onMore={() => setMemberVisibleLimit((value) => value + RESULT_PAGE_SIZE)}
            onBack={scrollToResultsHeader}
          />
        </div>
      )}
    </div>
  );
}

export default function SearchClient(props: SearchClientProps) {
  return <SearchClientInner {...props} />;
}
