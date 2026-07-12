"use client";

import { useState, useEffect, useRef, Suspense, useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import type { SessionHit, MemberHit, SearchFacet, SearchResponse } from "@/app/api/search/route";
import { Accordion } from "@/components/Accordion";
import { buildSearchAssist, buildSearchQuery, createSearchTextEvaluator, excerptSearchText } from "@/lib/searchQuery";

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

function normalizeForSearch(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\u3000/g, " ")
    .replace(/[ァ-ヶ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60))
    .toLowerCase()
    .trim();
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
type SearchIndexScope = "recent" | "full" | "city" | "server";

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

type AgendaEntry = {
  city: string;
  cityName: string;
  council_id: number;
  council_name: string;
  date?: string;
  schedule_index: number;
  schedule_name: string;
  agenda_title: string;
  first_minute_id: number | null;
  text: string;
  year?: string;
};

type IndexedSession = {
  city: string;
  cityName: string;
  id: string;
  title: string;
  committee: string;
  date: string;
  segments: Array<{
    index: number;
    label: string;
    start_time?: string;
    summary?: string;
    topics?: string[];
    transcript?: string;
  }>;
};

type EnrichedDoc = {
  city: string;
  cityName: string;
  council_id: number;
  name: string;
  generated_at?: string;
  summary?: string;
  highlights?: string[];
  tags?: string[];
};

type IndexedDecision = {
  city: string;
  cityName: string;
  session: string;
  description?: string;
};

type IndexedMember = {
  city: string;
  cityName: string;
  seat_number?: number | null;
  name: string;
  furigana: string;
  party: string;
  faction: string;
  committees: string[];
};

type IndexedMemberActivity = {
  city: string;
  cityName: string;
  member_name: string;
  council_id: number;
  council_name: string;
  year?: string;
  topics?: string[];
  summary_topics?: string[];
};

type ClientRuntimeSearchIndex = {
  scope?: SearchIndexScope;
  recent_from_year?: number;
  recent_to_year?: number;
  municipalities?: Array<{ slug: string; name: string }>;
  agendas: AgendaEntry[];
  sessions?: IndexedSession[];
  enriched?: EnrichedDoc[];
  decisions?: IndexedDecision[];
  members?: IndexedMember[];
  memberActivities?: IndexedMemberActivity[];
};

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
  field?: string;
};

type ClientBigramSearchManifest = {
  version: number;
  generated_at: string;
  scope: "city-bigram";
  city: string;
  document_count: number;
  bucket_count: number;
  buckets: string[];
};

type RankedSessionHit = SessionHit & { score: number };
type RankedMemberHit = MemberHit & { score: number };

const clientSearchIndexPromises = new Map<string, Promise<ClientRuntimeSearchIndex>>();
const clientBigramManifestPromises = new Map<string, Promise<ClientBigramSearchManifest>>();
const clientBigramDocumentsPromises = new Map<string, Promise<ClientBigramSearchDocument[]>>();
const clientBigramPostingPromises = new Map<string, Promise<Record<string, number[]>>>();

const BIGRAM_BUCKET_COUNT = 64;

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

function getCityMap(index: ClientRuntimeSearchIndex): Record<string, string> {
  const entries = new Map<string, string>();
  for (const m of index.municipalities ?? []) entries.set(m.slug, m.name);
  for (const row of index.agendas) entries.set(row.city, row.cityName);
  for (const row of index.sessions ?? []) entries.set(row.city, row.cityName);
  for (const row of index.enriched ?? []) entries.set(row.city, row.cityName);
  for (const row of index.decisions ?? []) entries.set(row.city, row.cityName);
  for (const row of index.members ?? []) entries.set(row.city, row.cityName);
  for (const row of index.memberActivities ?? []) entries.set(row.city, row.cityName);
  return Object.fromEntries(entries);
}

function uniqueTexts(values: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  return values
    .map((value) => value?.trim() ?? "")
    .filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

function memberActivityText(activity: IndexedMemberActivity, cityName: string): string {
  return [
    cityName,
    activity.member_name,
    activity.council_name,
    ...uniqueTexts([...(activity.summary_topics ?? []), ...(activity.topics ?? [])]),
  ].join(" ");
}

function cleanRawTopicExcerpt(text: string): string {
  return text
    .replace(/（[^）]{1,24}君）\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function memberActivityContext(summaryTopics: string[], topics: string[], tokens: string[]): string {
  if (summaryTopics.length > 0) {
    return `質問テーマ: ${summaryTopics.join("、")}`;
  }
  const excerptSource = topics.map(cleanRawTopicExcerpt).filter(Boolean).slice(0, 3).join("。");
  return excerptSource ? `議事録からの抜粋: ${excerptSearchText(excerptSource, tokens, 80)}` : "";
}

function memberHref(city: string, seatNumber: number | null | undefined): string {
  const normalizedSeatNumber = Number(seatNumber);
  return Number.isFinite(normalizedSeatNumber) && normalizedSeatNumber > 0
    ? `/${city}/members/${normalizedSeatNumber}`
    : `/${city}`;
}

function searchScopeLabel(scope: SearchIndexScope | undefined): string {
  if (scope === "recent") return "直近2年";
  if (scope === "city") return "選択中の市町村全期間";
  if (scope === "server" || scope === "full") return "全期間";
  return "";
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

async function loadClientSearchIndex(indexUrl: string, signal: AbortSignal): Promise<ClientRuntimeSearchIndex> {
  let promise = clientSearchIndexPromises.get(indexUrl);
  if (!promise) {
    promise = fetch(indexUrl, { cache: "no-cache" })
      .then(async (response) => {
        if (!response.ok) throw new Error("検索インデックスの読み込みに失敗しました");
        const data = (await response.json()) as ClientRuntimeSearchIndex;
        if (!Array.isArray(data.agendas)) throw new Error("検索インデックスが壊れています");
        return data;
      })
      .catch((error) => {
        clientSearchIndexPromises.delete(indexUrl);
        throw error;
      });
    clientSearchIndexPromises.set(indexUrl, promise);
  }
  const data = await promise;
  if (signal.aborted) throw new Error("検索を中断しました");
  return data;
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

function bigramBucket(term: string): number {
  let hash = 0;
  for (let i = 0; i < term.length; i += 1) {
    hash = ((hash * 31) + term.charCodeAt(i)) >>> 0;
  }
  return hash % BIGRAM_BUCKET_COUNT;
}

function bigramBucketFile(bucket: number): string {
  return `${bucket.toString(16).padStart(2, "0")}.json`;
}

function documentSearchText(doc: ClientBigramSearchDocument): string {
  return [
    doc.cityName,
    doc.title,
    doc.body,
    doc.context,
    doc.metaText,
    doc.member_name,
    doc.name,
    doc.furigana,
    doc.party,
    doc.faction,
    ...(doc.committees ?? []),
  ].filter(Boolean).join(" ");
}

function intersectNumberLists(left: number[], right: number[]): number[] {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
}

function unionNumberLists(lists: number[][]): number[] {
  return Array.from(new Set(lists.flat()));
}

function queryVariantTermGroups(q: string): string[][][] {
  const searchQuery = buildSearchQuery(q);
  return searchQuery.tokenGroups
    .map((group) =>
      group
        .map((variant) => bigramsForSearch(variant.normalized || variant.term))
        .filter((terms) => terms.length > 0)
    )
    .filter((group) => group.length > 0);
}

function candidateIdsFromBigramPostings(
  q: string,
  searchMode: SearchMode,
  postingsByTerm: Map<string, number[]>
): number[] {
  const groupCandidates = queryVariantTermGroups(q).map((variantGroups) => {
    const variantCandidates = variantGroups.map((terms) => {
      const lists = terms.map((term) => postingsByTerm.get(term) ?? []);
      if (lists.some((list) => list.length === 0)) return [];
      return lists.slice(1).reduce((acc, list) => intersectNumberLists(acc, list), lists[0] ?? []);
    });
    return unionNumberLists(variantCandidates);
  });

  const nonEmptyGroups = groupCandidates.filter((group) => group.length > 0);
  if (nonEmptyGroups.length === 0) return [];
  if (searchMode === "or") return unionNumberLists(nonEmptyGroups);
  if (nonEmptyGroups.length !== groupCandidates.length) return [];
  return nonEmptyGroups
    .slice(1)
    .reduce((acc, group) => intersectNumberLists(acc, group), nonEmptyGroups[0] ?? []);
}

async function loadJsonWithCache<T>(
  url: string,
  cache: Map<string, Promise<T>>,
  signal: AbortSignal,
  validate: (value: T) => boolean,
  errorMessage: string
): Promise<T> {
  let promise = cache.get(url);
  if (!promise) {
    promise = fetch(url, { cache: "no-cache" })
      .then(async (response) => {
        if (!response.ok) throw new Error(errorMessage);
        const data = (await response.json()) as T;
        if (!validate(data)) throw new Error(errorMessage);
        return data;
      })
      .catch((error) => {
        cache.delete(url);
        throw error;
      });
    cache.set(url, promise);
  }
  const data = await promise;
  if (signal.aborted) throw new Error("検索を中断しました");
  return data;
}

async function loadClientBigramCitySearch(
  city: string,
  q: string,
  signal: AbortSignal
): Promise<{ manifest: ClientBigramSearchManifest; documents: ClientBigramSearchDocument[]; postingsByTerm: Map<string, number[]> }> {
  const baseUrl = `/generated/search-bigram-cities/${city}`;
  const manifest = await loadJsonWithCache<ClientBigramSearchManifest>(
    `${baseUrl}/manifest.json`,
    clientBigramManifestPromises,
    signal,
    (data) => data?.scope === "city-bigram" && data.city === city && Number.isFinite(data.bucket_count),
    "市別検索インデックスの読み込みに失敗しました"
  );
  const documents = await loadJsonWithCache<ClientBigramSearchDocument[]>(
    `${baseUrl}/documents.json`,
    clientBigramDocumentsPromises,
    signal,
    Array.isArray,
    "市別検索インデックスの読み込みに失敗しました"
  );
  const terms = Array.from(new Set(queryVariantTermGroups(q).flat(2)));
  const bucketFiles = Array.from(new Set(terms.map((term) => bigramBucketFile(bigramBucket(term)))))
    .filter((file) => manifest.buckets.includes(file));
  const buckets = await Promise.all(
    bucketFiles.map((file) =>
      loadJsonWithCache<Record<string, number[]>>(
        `${baseUrl}/postings/${file}`,
        clientBigramPostingPromises,
        signal,
        (data) => data && typeof data === "object" && !Array.isArray(data),
        "市別検索インデックスの読み込みに失敗しました"
      )
    )
  );
  const postingsByTerm = new Map<string, number[]>();
  for (const bucket of buckets) {
    for (const term of terms) {
      if (bucket[term]) postingsByTerm.set(term, bucket[term]);
    }
  }
  return { manifest, documents, postingsByTerm };
}

function dedupeSessionHits(results: RankedSessionHit[]): RankedSessionHit[] {
  const byKey = new Map<string, RankedSessionHit>();
  for (const result of sortSessionHits(results)) {
    const key = result.sourceType === "minutes" && result.href.includes("/minutes/")
      ? `${result.city}:minutes:${result.href.split("?")[0]}`
      : `${result.city}:${result.sourceType}:${result.id}`;
    if (!byKey.has(key)) byKey.set(key, result);
  }
  return Array.from(byKey.values());
}

function runClientBigramCitySearch(
  cityData: { manifest: ClientBigramSearchManifest; documents: ClientBigramSearchDocument[]; postingsByTerm: Map<string, number[]> },
  options: {
    q: string;
    searchMode: SearchMode;
    cityFilter: string;
    sourceFilter: SourceFilter;
    yearFilter: string;
    factionFilter: string;
  }
): SearchResponse {
  const { q, searchMode, cityFilter, sourceFilter, yearFilter, factionFilter } = options;
  const searchQuery = buildSearchQuery(q);
  const queryAssist = buildSearchAssist(q);
  const exactExpandedTerms = queryAssist.find((group) => group.kind === "exact")?.terms ?? [];
  const relatedExpandedTerms = queryAssist.find((group) => group.kind === "related")?.terms ?? [];
  const searchSuggestions = queryAssist.find((group) => group.kind === "suggestion")?.terms ?? [];
  const tokens = searchQuery.highlightTokens;

  const candidateIds = candidateIdsFromBigramPostings(q, searchMode, cityData.postingsByTerm);
  const candidateDocs = candidateIds
    .map((index) => cityData.documents[index])
    .filter((doc): doc is ClientBigramSearchDocument => Boolean(doc));

  const collectResults = (
    mode: "strict" | "fallback"
  ): { sessionResults: RankedSessionHit[]; memberResults: RankedMemberHit[] } => {
    const sessionResults: RankedSessionHit[] = [];
    const memberResults: RankedMemberHit[] = [];
    const evaluateText = createSearchTextEvaluator(searchQuery, searchMode, mode);

    for (const doc of candidateDocs) {
      const searchText = documentSearchText(doc);
      const evaluation = evaluateText(searchText);
      if (!evaluation.matched) continue;

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
      let score = evaluation.score + (doc.source === "member_activity" ? 32 : doc.source === "agenda" ? 14 : 8);
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
        href: doc.href || `/${doc.city}`,
        segIndex: 0,
        label: doc.label ?? "",
        startTime: "",
        context: excerptSearchText(doc.context || doc.body || searchText, tokens, 100),
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

  if (sessionResults.length === 0 || memberResults.length === 0) {
    const fallbackResults = collectResults("fallback");
    if (sessionResults.length === 0 && fallbackResults.sessionResults.length > 0) {
      sessionResults = fallbackResults.sessionResults;
      sessionRescued = true;
    }
    if (memberResults.length === 0 && fallbackResults.memberResults.length > 0) {
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
  const effectiveSourceFilter =
    sourceFilter !== "all" && sessionSourceFacets.some((facet) => facet.value === sourceFilter)
      ? sourceFilter
      : "all";
  const sourceScopedSessions =
    effectiveSourceFilter === "all"
      ? cityScopedSessions
      : cityScopedSessions.filter((result) => result.sourceType === effectiveSourceFilter);
  const sessionYearFacets = buildCountFacets(
    sourceScopedSessions.map((result) => result.year).filter(Boolean)
  );
  const effectiveYearFilter =
    yearFilter !== "all" && sessionYearFacets.some((facet) => facet.value === yearFilter)
      ? yearFilter
      : "all";
  const filteredSessions =
    effectiveYearFilter === "all"
      ? sourceScopedSessions
      : sourceScopedSessions.filter((result) => result.year === effectiveYearFilter);
  const memberFactionFacets = buildCountFacets(
    cityScopedMembers.map((result) => result.faction || "無所属")
  );
  const effectiveFactionFilter =
    factionFilter !== "all" && memberFactionFacets.some((facet) => facet.value === factionFilter)
      ? factionFilter
      : "all";
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
    sessionBaseTotal: sessionResults.length,
    memberBaseTotal: memberResults.length,
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
    searchScope: "city",
    searchScopeLabel: "選択中の市町村全期間",
    fullSearchAvailable: false,
  };
}

function runClientSearch(
  runtimeIndex: ClientRuntimeSearchIndex,
  options: {
    q: string;
    searchMode: SearchMode;
    cityFilter: string;
    sourceFilter: SourceFilter;
    yearFilter: string;
    factionFilter: string;
  }
): SearchResponse {
  const { q, searchMode, cityFilter, sourceFilter, yearFilter, factionFilter } = options;
  const searchQuery = buildSearchQuery(q);
  const queryAssist = buildSearchAssist(q);
  const exactExpandedTerms = queryAssist.find((group) => group.kind === "exact")?.terms ?? [];
  const relatedExpandedTerms = queryAssist.find((group) => group.kind === "related")?.terms ?? [];
  const searchSuggestions = queryAssist.find((group) => group.kind === "suggestion")?.terms ?? [];
  const tokens = searchQuery.highlightTokens;
  const cityMap = getCityMap(runtimeIndex);

  const collectResults = (
    mode: "strict" | "fallback"
  ): { sessionResults: RankedSessionHit[]; memberResults: RankedMemberHit[] } => {
    const sessionResults: RankedSessionHit[] = [];
    const memberResults: RankedMemberHit[] = [];
    const evaluateText = createSearchTextEvaluator(searchQuery, searchMode, mode);

    for (const s of runtimeIndex.sessions ?? []) {
      const city = s.city;
      const cityName = s.cityName || cityMap[city] || city;
      const committee = s.committee ?? "";
      const title = s.title ?? "";
      const sessionYear = yearFromDate(s.date);
      const sessionLabel = committee || title;
      let bestHit: RankedSessionHit | null = null;

      for (const seg of s.segments ?? []) {
        const fields = [
          { text: `${cityName} ${seg.summary ?? ""}`, field: "要約", bonus: 24, radius: 100 },
          { text: `${cityName} ${(seg.topics ?? []).join(" ")}`, field: "トピック", bonus: 20, radius: 90 },
          { text: `${cityName} ${seg.transcript ?? ""}`, field: "全文", bonus: 10, radius: 100 },
        ];
        for (const field of fields) {
          const evaluation = evaluateText(field.text);
          if (!evaluation.matched) continue;
          const score = evaluation.score + field.bonus;
          if (bestHit && bestHit.score >= score) continue;
          bestHit = {
            id: s.id,
            city,
            cityName,
            sourceType: "session",
            title,
            committee,
            href: `/${city}/sessions/${s.id}`,
            segIndex: seg.index,
            label: seg.label ?? "",
            startTime: seg.start_time ?? "",
            context: excerptSearchText(field.text, tokens, field.radius),
            field: field.field,
            date: s.date,
            year: sessionYear,
            score,
          };
        }
      }

      const titleSearchText = `${cityName} ${title} ${committee}`;
      const titleEvaluation = evaluateText(titleSearchText);
      if (titleEvaluation.matched) {
        const score = titleEvaluation.score + 28;
        if (!bestHit || score > bestHit.score) {
          bestHit = {
            id: s.id,
            city,
            cityName,
            sourceType: "session",
            title,
            committee,
            href: `/${city}/sessions/${s.id}`,
            segIndex: 0,
            label: "",
            startTime: "",
            context: sessionLabel,
            field: "会議名",
            date: s.date,
            year: sessionYear,
            score,
          };
        }
      }

      if (bestHit) sessionResults.push(bestHit);
    }

    const seenMinutes = new Set<string>();
    for (const agenda of runtimeIndex.agendas) {
      const haystack = `${agenda.cityName} ${agenda.council_name} ${agenda.agenda_title} ${agenda.text}`;
      const evaluation = evaluateText(haystack);
      if (!evaluation.matched) continue;
      let score = evaluation.score + 14;
      if (agenda.agenda_title && evaluateText(agenda.agenda_title).matched) score += 18;
      if (evaluateText(agenda.council_name).matched) score += 10;
      sessionResults.push({
        id: `${agenda.city}_minutes_${agenda.council_id}_${agenda.schedule_index}_${agenda.first_minute_id ?? 0}`,
        city: agenda.city,
        cityName: agenda.cityName,
        sourceType: "minutes",
        title: agenda.council_name,
        committee: agenda.agenda_title || "議題",
        href:
          agenda.first_minute_id !== null
            ? `/${agenda.city}/minutes/${agenda.council_id}?q=${encodeURIComponent(q)}`
            : `/${agenda.city}/minutes/${agenda.council_id}`,
        segIndex: agenda.schedule_index,
        label: agenda.schedule_name,
        startTime: "",
        context: excerptSearchText(`${agenda.agenda_title} ${agenda.text}`, tokens, 100),
        field: "議事録",
        date: agenda.date,
        year: agenda.year ?? yearFromCouncilName(agenda.council_name),
        score,
      });
      seenMinutes.add(`${agenda.city}_${agenda.council_id}`);
    }

    for (const activity of runtimeIndex.memberActivities ?? []) {
      const city = activity.city;
      const cityName = activity.cityName || cityMap[city] || city;
      const minuteKey = `${city}_${activity.council_id}`;
      if (seenMinutes.has(minuteKey)) continue;
      const searchText = memberActivityText(activity, cityName);
      const evaluation = evaluateText(searchText);
      if (!evaluation.matched) continue;
      const summaryTopics = uniqueTexts(activity.summary_topics ?? []);
      const topics = uniqueTexts(activity.topics ?? []);
      const contextText = memberActivityContext(summaryTopics, topics, tokens) || excerptSearchText(searchText, tokens, 100);
      let score = evaluation.score + 32;
      const topicText = [...summaryTopics, ...topics].join(" ");
      if (topicText && evaluateText(topicText).matched) score += 22;
      if (evaluateText(activity.member_name).matched) score += 12;
      if (evaluateText(activity.council_name).matched) score += 8;
      sessionResults.push({
        id: `${city}_member_activity_${activity.member_name}_${activity.council_id}`,
        city,
        cityName,
        sourceType: "minutes",
        title: activity.council_name,
        committee: `${activity.member_name}議員の質問`,
        href: `/${city}/minutes/${activity.council_id}?q=${encodeURIComponent(q)}`,
        segIndex: 0,
        label: "",
        startTime: "",
        context: contextText,
        field: "質問テーマ",
        year: activity.year ?? yearFromCouncilName(activity.council_name),
        score,
      });
      seenMinutes.add(minuteKey);
    }

    for (const doc of runtimeIndex.enriched ?? []) {
      const city = doc.city;
      const cityName = doc.cityName || cityMap[city] || city;
      const minuteKey = `${city}_${doc.council_id}`;
      if (seenMinutes.has(minuteKey)) continue;
      const summary = doc.summary ?? "";
      const highlights = doc.highlights ?? [];
      const searchText = [cityName, doc.name, summary, ...highlights, ...(doc.tags ?? [])].join(" ");
      const evaluation = evaluateText(searchText);
      if (!evaluation.matched) continue;
      let score = evaluation.score + 8;
      if (evaluateText(doc.name).matched) score += 16;
      if (summary && evaluateText(summary).matched) score += 12;
      const contextText = summary
        ? excerptSearchText(summary, tokens, 120)
        : highlights.slice(0, 2).join("、");
      sessionResults.push({
        id: `${city}_minutes_${doc.council_id}`,
        city,
        cityName,
        sourceType: "minutes",
        title: doc.name,
        committee: "",
        href: `/${city}/minutes/${doc.council_id}`,
        segIndex: 0,
        label: "",
        startTime: "",
        context: contextText,
        field: "AI要約",
        year: yearFromCouncilName(doc.name) || yearFromDate(doc.generated_at),
        score,
      });
    }

    for (const decision of runtimeIndex.decisions ?? []) {
      const city = decision.city;
      const cityName = decision.cityName || cityMap[city] || city;
      const text = [cityName, decision.session, decision.description ?? ""].join(" ");
      const evaluation = evaluateText(text);
      if (!evaluation.matched) continue;
      let score = evaluation.score + 10;
      if (evaluateText(decision.session).matched) score += 10;
      sessionResults.push({
        id: `${city}_decision_${decision.session}`,
        city,
        cityName,
        sourceType: "decision",
        title: decision.session,
        committee: "議決結果",
        href: `/${city}/decisions`,
        segIndex: 0,
        label: "",
        startTime: "",
        context: excerptSearchText(text, tokens, 80),
        field: "議決",
        year: yearFromCouncilName(decision.session),
        score,
      });
    }

    for (const member of runtimeIndex.members ?? []) {
      const city = member.city;
      const cityName = member.cityName || cityMap[city] || city;
      const committees = Array.isArray(member.committees)
        ? member.committees.filter((committee): committee is string => typeof committee === "string")
        : [];
      const name = member.name ?? "";
      const furigana = member.furigana ?? "";
      const party = member.party ?? "";
      const faction = member.faction ?? "";
      const searchText = [cityName, name, furigana, party, faction, ...committees].join(" ");
      const evaluation = evaluateText(searchText);
      if (!evaluation.matched) continue;
      let score = evaluation.score;
      if (evaluateText(name).matched) score += 28;
      if (furigana && evaluateText(furigana).matched) score += 20;
      if (party && evaluateText(party).matched) score += 10;
      if (faction && evaluateText(faction).matched) score += 12;
      memberResults.push({
        city,
        cityName,
        href: memberHref(city, member.seat_number),
        name,
        furigana,
        party,
        faction,
        committees,
        score,
      });
    }

    return {
      sessionResults: sortSessionHits(sessionResults),
      memberResults: sortMemberHits(memberResults),
    };
  };

  const strictResults = collectResults("strict");
  let sessionResults = strictResults.sessionResults;
  let memberResults = strictResults.memberResults;
  let sessionRescued = false;
  let memberRescued = false;

  if (sessionResults.length === 0 || memberResults.length === 0) {
    const fallbackResults = collectResults("fallback");
    if (sessionResults.length === 0 && fallbackResults.sessionResults.length > 0) {
      sessionResults = fallbackResults.sessionResults;
      sessionRescued = true;
    }
    if (memberResults.length === 0 && fallbackResults.memberResults.length > 0) {
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
  const effectiveSourceFilter =
    sourceFilter !== "all" && sessionSourceFacets.some((facet) => facet.value === sourceFilter)
      ? sourceFilter
      : "all";
  const sourceScopedSessions =
    effectiveSourceFilter === "all"
      ? cityScopedSessions
      : cityScopedSessions.filter((result) => result.sourceType === effectiveSourceFilter);
  const sessionYearFacets = buildCountFacets(
    sourceScopedSessions.map((result) => result.year).filter(Boolean)
  );
  const effectiveYearFilter =
    yearFilter !== "all" && sessionYearFacets.some((facet) => facet.value === yearFilter)
      ? yearFilter
      : "all";
  const filteredSessions =
    effectiveYearFilter === "all"
      ? sourceScopedSessions
      : sourceScopedSessions.filter((result) => result.year === effectiveYearFilter);
  const memberFactionFacets = buildCountFacets(
    cityScopedMembers.map((result) => result.faction || "無所属")
  );
  const effectiveFactionFilter =
    factionFilter !== "all" && memberFactionFacets.some((facet) => facet.value === factionFilter)
      ? factionFilter
      : "all";
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
    sessionBaseTotal: sessionResults.length,
    memberBaseTotal: memberResults.length,
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
    searchScope: runtimeIndex.scope,
    searchScopeLabel: searchScopeLabel(runtimeIndex.scope),
    fullSearchAvailable: runtimeIndex.scope === "recent",
  };
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
  const [searchScope, setSearchScope] = useState<SearchIndexScope | "">("");
  const [searchScopeLabelText, setSearchScopeLabelText] = useState("");
  const [fullSearchAvailable, setFullSearchAvailable] = useState(false);
  const [forceFullSearch, setForceFullSearch] = useState(false);
  const [recentQueries, setRecentQueries] = useState<string[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hasSearchResponse, setHasSearchResponse] = useState(false);
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
    setForceFullSearch(false);
  }, [query, cityFilter]);

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
      setSearchScope("");
      setSearchScopeLabelText("");
      setFullSearchAvailable(false);
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
      try {
        const params = new URLSearchParams({
          q,
          op: searchMode,
        });
        if (cityFilter !== "all") params.set("city", cityFilter);
        if (tab === "sessions" && sourceFilter !== "all") params.set("source", sourceFilter);
        if (tab === "sessions" && yearFilter !== "all") params.set("year", yearFilter);
        if (tab === "members" && factionFilter !== "all") params.set("faction", factionFilter);
        if (forceFullSearch) params.set("scope", "all");
        const res = await fetch(`/api/search?${params.toString()}`, { signal: controller.signal });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "検索に失敗しました");
        }
        let data = (await res.json()) as SearchResponse;
        if (data.clientSearchRequired) {
          if (cityFilter !== "all") {
            try {
              const bigramCityData = await loadClientBigramCitySearch(cityFilter, q, controller.signal);
              data = runClientBigramCitySearch(bigramCityData, {
                q,
                searchMode,
                cityFilter,
                sourceFilter,
                yearFilter,
                factionFilter,
              });
            } catch {
              const runtimeIndex = await loadClientSearchIndex(data.indexUrl ?? `/generated/search-indexes/${cityFilter}.json`, controller.signal);
              data = runClientSearch(runtimeIndex, {
                q,
                searchMode,
                cityFilter,
                sourceFilter,
                yearFilter,
                factionFilter,
              });
            }
          } else {
            const runtimeIndex = await loadClientSearchIndex(data.indexUrl ?? "/generated/search-index.json", controller.signal);
            data = runClientSearch(runtimeIndex, {
              q,
              searchMode,
              cityFilter,
              sourceFilter,
              yearFilter,
              factionFilter,
            });
          }
          const noResults = (data.sessionResults?.length ?? 0) === 0 && (data.memberResults?.length ?? 0) === 0;
          if (data.searchScope === "recent" && cityFilter === "all" && noResults) {
            const fullRuntimeIndex = await loadClientSearchIndex("/generated/search-index.json", controller.signal);
            data = runClientSearch(fullRuntimeIndex, {
              q,
              searchMode,
              cityFilter,
              sourceFilter,
              yearFilter,
              factionFilter,
            });
            data.fullSearchAvailable = false;
            data.searchScope = "full";
            data.searchScopeLabel = "全期間";
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
        setSearchScope(data.searchScope ?? "");
        setSearchScopeLabelText(data.searchScopeLabel ?? "");
        setFullSearchAvailable(Boolean(data.fullSearchAvailable));
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
        setSearchScope("");
        setSearchScopeLabelText("");
        setFullSearchAvailable(false);
        setTruncated(false);
        setHasSearchResponse(true);
        setError(err instanceof Error ? err.message : "検索に失敗しました");
      } finally {
        if (requestIdRef.current === requestId) {
          setLoading(false);
        }
      }
    }, 220);

    return () => {
      controller.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, searchMode, cityFilter, sourceFilter, yearFilter, factionFilter, tab, forceFullSearch, replaceSearchParams]);

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

  // 親フィルタ変更で選択肢から外れた子フィルタ state を "all" にリセット。
  // 依存配列には primitive 化したキーを渡して、配列の reference だけで
  // 再発火しないようにする。
  const availableSourcesKey = Array.from(availableSourceTypes).sort().join("|");
  const availableYearsKey = availableYears.join("|");
  const availableFactionsKey = availableFactions.join("|");
  useEffect(() => {
    if (!hasSearchResponse) return;
    if (sourceFilter !== "all" && !availableSourceTypes.has(sourceFilter)) {
      replaceSearchParams({ source: "all" });
    }
  }, [availableSourcesKey, hasSearchResponse, sourceFilter, availableSourceTypes, replaceSearchParams]);
  useEffect(() => {
    if (!hasSearchResponse) return;
    if (yearFilter !== "all" && !availableYears.includes(yearFilter)) {
      replaceSearchParams({ year: "all" });
    }
  }, [availableYearsKey, hasSearchResponse, yearFilter, availableYears, replaceSearchParams]);
  useEffect(() => {
    if (!hasSearchResponse) return;
    if (factionFilter !== "all" && !availableFactions.includes(factionFilter)) {
      replaceSearchParams({ faction: "all" });
    }
  }, [availableFactionsKey, hasSearchResponse, factionFilter, availableFactions, replaceSearchParams]);

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
              value={draftQuery}
              onChange={(e) => setDraftQuery(e.target.value)}
              placeholder="給食無償化、除雪、ラピダス、防災、議員名で検索"
              className="theme-input w-full min-h-12 py-3 pl-9 pr-16 text-base sm:min-h-14 sm:text-lg"
            />
            {draftQuery && (
              <button
                onClick={clearSearch}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded text-xs font-bold text-[#718096] hover:text-[#1A202C] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8AA3CF]"
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
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                      searchMode === "and" ? "bg-[#1B3A6B] text-white" : "text-[#4A5568] hover:text-[#1B3A6B]"
                    }`}
                  >
                    AND
                  </button>
                  <button
                    type="button"
                    onClick={() => replaceSearchParams({ op: "or" })}
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
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
                  className="theme-pill-soft text-[#1B3A6B]"
                  type="button"
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        )}

        {!hasQuery && (
          <p className="mt-3 text-xs leading-relaxed text-[#667085] sm:text-sm">
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
              <p className="mt-1 text-xs text-[#667085] sm:text-sm">
                議事録・議決結果 {loading ? "…" : sessionTotal.toLocaleString()} 件 / 議員 {loading ? "…" : memberTotal.toLocaleString()} 名
              </p>
              <p className="mt-1 text-sm text-[#667085]">
                予算書は各市町村の「予算」ページで原本画像とOCR結果を検索できます。
              </p>
              {searchScopeLabelText && (
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-[#667085]">
                  <span>検索対象: {searchScopeLabelText}</span>
                  {searchScope === "recent" && fullSearchAvailable && (
                    <button
                      type="button"
                      onClick={() => setForceFullSearch(true)}
                      className="rounded-full border border-[#CBD5E0] bg-white px-2 py-0.5 text-xs font-semibold text-[#1B3A6B] hover:border-[#1B3A6B] hover:bg-[#E8EEF7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8AA3CF]"
                    >
                      全期間を検索
                    </button>
                  )}
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
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8AA3CF] rounded-t sm:px-4 ${
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
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8AA3CF] ${
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
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8AA3CF] ${
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
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8AA3CF] ${
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
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8AA3CF] ${
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
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8AA3CF] ${
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
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8AA3CF] ${
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
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8AA3CF] ${
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
                          <span className="theme-pill-soft text-[#2A5298] opacity-90">会議録</span>
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
  return (
    <Suspense>
      <SearchClientInner {...props} />
    </Suspense>
  );
}
