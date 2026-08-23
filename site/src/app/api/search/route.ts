import { NextRequest, NextResponse } from "next/server";
import { getDecisions, getMembers, getMinutesEnrichedDocs, getSearchIndex, getSession, getSessionSummaries, readCityJson } from "@/lib/cityData";
import { getMunicipalities } from "@/lib/municipalities";
import { checkRateLimit } from "@/lib/rateLimit";
import { buildSearchAssist, buildSearchQuery, createSearchTextEvaluator, excerptSearchText } from "@/lib/searchQuery";
import { getClientAddress } from "@/lib/security";
import { fetchStaticAsset } from "@/lib/staticAssetFetch";
import type { SearchAssistGroup, SearchOperator } from "@/lib/searchQuery";
import type { MemberActivity } from "@/types/member";

const SEARCH_WINDOW_SECONDS = 60;
const SEARCH_GET_LIMIT = 60;
const SEARCH_POST_LIMIT = 12;
const SEARCH_RESPONSE_CACHE_SECONDS = 60;

function shouldUseClientSearch(request: NextRequest): boolean {
  const mode = process.env.GIKAI_SEARCH_MODE;
  if (mode === "server") return false;
  if (mode === "client") return true;

  const host = request.nextUrl.hostname.toLowerCase();
  return (
    process.env.NODE_ENV === "production" ||
    request.headers.has("cf-ray") ||
    host === "chihougikai.com" ||
    host === "www.chihougikai.com" ||
    host.endsWith(".workers.dev")
  );
}

const RECENT_YEAR_WINDOW = 2;

export type SearchIndexScope = "recent" | "full" | "city" | "server";

function currentRecentFromYear(): number {
  return new Date().getFullYear() - RECENT_YEAR_WINDOW + 1;
}

function isOldYearFilter(yearFilter: string): boolean {
  const year = Number(yearFilter);
  return yearFilter !== "all" && Number.isFinite(year) && year < currentRecentFromYear();
}

function clientSearchIndexMeta(
  cityFilter: string,
  yearFilter: string,
  forceFullSearch: boolean
): {
  indexUrl: string;
  searchScope: SearchIndexScope;
  searchScopeLabel: string;
  fullSearchAvailable: boolean;
} {
  if (cityFilter !== "all" && /^[a-z0-9-]+$/.test(cityFilter)) {
    return {
      indexUrl: `/generated/search-indexes/${cityFilter}.json`,
      searchScope: "city",
      searchScopeLabel: "選択中の市町村全期間",
      fullSearchAvailable: false,
    };
  }
  if (forceFullSearch || isOldYearFilter(yearFilter)) {
    return {
      indexUrl: "/generated/search-index.json",
      searchScope: "full",
      searchScopeLabel: "全期間",
      fullSearchAvailable: false,
    };
  }
  return {
    indexUrl: "/generated/search-index-recent.json",
    searchScope: "recent",
    searchScopeLabel: "直近2年",
    fullSearchAvailable: true,
  };
}

// 日付文字列（"2026-03-02" 等）から西暦4桁を取り出す
function yearFromDate(date: string | undefined | null): string {
  if (!date) return "";
  const m = date.match(/^(\d{4})/);
  return m ? m[1] : "";
}

// 会議名（"令和７年 第１回定例会" 等）から西暦を推定する
function yearFromCouncilName(name: string): string {
  // 半角/全角数字を半角に揃える
  const norm = name.replace(/[０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0)
  );
  const reiwa = norm.match(/令和\s*(\d+)/);
  if (reiwa) return String(2018 + Number(reiwa[1]));
  const heisei = norm.match(/平成\s*(\d+)/);
  if (heisei) return String(1988 + Number(heisei[1]));
  const west = norm.match(/(\d{4})/);
  if (west) return west[1];
  return "";
}

// ---------------------------------------------------------------------------
// Build city name map from the runtime index
// ---------------------------------------------------------------------------
function getCityMap(index: RuntimeSearchIndex): Record<string, string> {
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type SessionHit = {
  id: string;
  city: string;
  cityName: string;
  sourceType: "session" | "minutes" | "decision";
  title: string;
  committee: string;
  href: string;
  segIndex: number;
  label: string;
  startTime: string;
  context: string;
  field: string;
  date?: string;
  /** 西暦。不明な場合は空文字 */
  year: string;
};

export type MemberHit = {
  city: string;
  cityName: string;
  href: string;
  name: string;
  furigana: string;
  party: string;
  faction: string;
  committees: string[];
};

export type SourceFilter = "all" | "minutes" | "session" | "decision";

export type SearchFacet = {
  value: string;
  label: string;
  count: number;
};

export type SearchResponse = {
  sessionResults: SessionHit[];
  memberResults: MemberHit[];
  sessionTotal: number;
  memberTotal: number;
  sessionBaseTotal: number;
  memberBaseTotal: number;
  truncated: boolean;
  rescued: boolean;
  sessionRescued: boolean;
  memberRescued: boolean;
  highlightTokens: string[];
  queryAssist: SearchAssistGroup[];
  exactExpandedTerms: string[];
  relatedExpandedTerms: string[];
  searchSuggestions: string[];
  searchMode: SearchOperator;
  facets: {
    cities: SearchFacet[];
    sessionSources: SearchFacet[];
    sessionYears: SearchFacet[];
    memberFactions: SearchFacet[];
  };
  clientSearchRequired?: boolean;
  indexUrl?: string;
  searchScope?: SearchIndexScope;
  searchScopeLabel?: string;
  fullSearchAvailable?: boolean;
};

type RankedSessionHit = SessionHit & { score: number };
type RankedMemberHit = MemberHit & { score: number };

type AgendaEntry = {
  city: string;
  cityName: string;
  council_id: number;
  council_name: string;
  schedule_index: number;
  schedule_name: string;
  agenda_title: string;
  first_minute_id: number | null;
  text: string;
  truncated: boolean;
  date?: string;
  year?: string;
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
    speaker?: string;
    start_time?: string;
    summary?: string;
    topics?: string[];
    transcript?: string;
  }>;
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
  record_id?: string;
  council_id: number;
  council_name: string;
  year?: string;
  date?: string;
  href?: string;
  overview?: string;
  question_kind?: string;
  source_type?: string;
  source_label?: string;
  source_status?: string;
  start_time?: string;
  topics?: string[];
  summary_topics?: string[];
};

type RuntimeSearchIndex = {
  version?: number;
  generated_at?: string;
  excerpt_max?: number;
  count?: number;
  municipalities?: Array<{ slug: string; name: string }>;
  agendas: AgendaEntry[];
  sessions?: IndexedSession[];
  enriched?: EnrichedDoc[];
  decisions?: IndexedDecision[];
  members?: IndexedMember[];
  memberActivities?: IndexedMemberActivity[];
};

let runtimeSearchIndexPromise: Promise<RuntimeSearchIndex> | null = null;
let hasCloudflareAssetsPromise: Promise<boolean> | null = null;

function emptyRuntimeSearchIndex(): RuntimeSearchIndex {
  return { agendas: [], sessions: [], enriched: [], decisions: [], members: [], memberActivities: [] };
}

function memberActivityText(activity: IndexedMemberActivity, cityName: string): string {
  return [
    cityName,
    activity.member_name,
    activity.council_name,
    activity.date,
    activity.overview,
    activity.question_kind,
    activity.source_label,
    activity.source_status,
    memberActivityDisplayLabel(activity),
    ...uniqueTexts([...(activity.summary_topics ?? []), ...(activity.topics ?? [])]),
  ].join(" ");
}

function memberActivityQuestionLabel(questionKind: string | undefined): string {
  if (questionKind === "general_question") return "一般質問";
  if (questionKind === "representative_question") return "代表質問";
  if (questionKind === "committee_question") return "委員会質疑";
  if (questionKind === "plenary_question") return "本会議質疑";
  if (questionKind === "other_question") return "質問";
  return "質問記録";
}

function memberActivitySourceType(activity: IndexedMemberActivity): "session" | "minutes" {
  return activity.source_status === "preliminary"
    || activity.source_type === "video_transcript"
    || activity.href?.includes("/sessions/")
    ? "session"
    : "minutes";
}

function memberActivityDisplayLabel(activity: IndexedMemberActivity): string {
  const sourceLabel = activity.source_label
    || (activity.source_status === "preliminary" ? "会議録速報" : "公式議事録");
  return uniqueTexts([sourceLabel, memberActivityQuestionLabel(activity.question_kind)]).join("・");
}

function sessionSegmentIdentity(speaker: string | undefined, label: string | undefined): string {
  const normalizedSpeaker = speaker?.trim() ?? "";
  const normalizedLabel = label?.trim() ?? "";
  if (normalizedSpeaker && normalizedLabel.includes(normalizedSpeaker)) return normalizedLabel;
  return uniqueTexts([normalizedSpeaker, normalizedLabel]).join("・");
}

function cleanRawTopicExcerpt(text: string): string {
  return text
    .replace(/（[^）]{1,24}君）\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function memberActivityContext(
  activity: IndexedMemberActivity,
  summaryTopics: string[],
  topics: string[],
  tokens: string[]
): string {
  const parts = [memberActivityDisplayLabel(activity)];
  if (activity.overview) parts.push(excerptSearchText(activity.overview, tokens, 120));
  if (summaryTopics.length > 0) parts.push(`質問テーマ: ${summaryTopics.join("、")}`);
  const excerptSource = topics.map(cleanRawTopicExcerpt).filter(Boolean).slice(0, 3).join("。");
  if (summaryTopics.length === 0 && excerptSource) {
    parts.push(`議事録からの抜粋: ${excerptSearchText(excerptSource, tokens, 80)}`);
  }
  return parts.filter(Boolean).join(" ");
}

function memberHref(city: string, seatNumber: number | null | undefined): string {
  const normalizedSeatNumber = Number(seatNumber);
  return Number.isFinite(normalizedSeatNumber) && normalizedSeatNumber > 0
    ? `/${city}/members/${normalizedSeatNumber}`
    : `/${city}`;
}

function loadFileRuntimeSearchIndex(): RuntimeSearchIndex {
  const municipalities = getMunicipalities().filter((m) => m.active);
  const cityMap = Object.fromEntries(municipalities.map((m) => [m.slug, m.name]));
  const allCities = Object.keys(cityMap);
  const sessions: IndexedSession[] = [];
  const enriched: EnrichedDoc[] = [];
  const decisions: IndexedDecision[] = [];
  const members: IndexedMember[] = [];
  const memberActivities: IndexedMemberActivity[] = [];

  for (const city of allCities) {
    const cityName = cityMap[city];

    for (const entry of getSessionSummaries(city)) {
      if (!entry.has_summary || (entry.segment_count ?? 0) === 0) continue;
      const session = getSession(city, entry.id);
      if (!session) continue;
      sessions.push({
        city,
        cityName,
        id: session.id,
        title: session.title,
        committee: session.committee ?? "",
        date: session.date,
        segments: session.segments.map((seg) => ({
          index: seg.index,
          label: seg.label,
          speaker: (seg as typeof seg & { speaker?: string }).speaker ?? seg.detail?.speaker ?? "",
          start_time: seg.start_time ?? "",
          summary: seg.summary ?? "",
          topics: seg.topics ?? [],
          transcript: seg.transcript ?? "",
        })),
      });
    }

    enriched.push(
      ...getMinutesEnrichedDocs(city).map((doc) => ({
        city,
        cityName,
        council_id: doc.council_id,
        name: doc.name,
        generated_at: doc.generated_at,
        summary: doc.summary,
        highlights: doc.highlights,
        tags: doc.tags,
      }))
    );

    decisions.push(
      ...getDecisions(city).map((decision) => ({
        city,
        cityName,
        session: decision.session,
        description: decision.description,
      }))
    );

    const activity = readCityJson<Record<string, MemberActivity>>(city, "members_activity.json") ?? {};
    memberActivities.push(
      ...Object.values(activity).flatMap((entry) => {
        const memberName = entry.name?.trim() ?? "";
        if (!memberName) return [];
        return (entry.sessions ?? [])
          .filter((session) => Number.isFinite(Number(session.council_id)) && Number(session.council_id) >= 0)
          .map((session) => ({
            city,
            cityName,
            member_name: memberName,
            record_id: session.record_id,
            council_id: Number(session.council_id),
            council_name: session.session ?? "",
            year: session.year || yearFromCouncilName(session.session ?? ""),
            date: session.date,
            href: session.href,
            overview: session.overview,
            question_kind: session.question_kind,
            source_type: session.source_type,
            source_label: session.source_label,
            source_status: session.source_status,
            start_time: session.start_time,
            summary_topics: Array.isArray(session.summary_topics) ? session.summary_topics : [],
            topics: Array.isArray(session.summary_topics) && session.summary_topics.length
              ? []
              : Array.isArray(session.topics)
                ? session.topics.slice(0, 6)
                : [],
          }));
      })
    );

    const memberList = getMembers(city);
    if (memberList.length > 0) {
      members.push(
        ...memberList.map((member) => ({
          city,
          cityName,
          seat_number: member.seat_number,
          name: member.name,
          furigana: member.furigana,
          party: member.party ?? "",
          faction: member.faction ?? "",
          committees: member.committees ?? [],
        }))
      );
      continue;
    }

    const data = readCityJson<Record<string, unknown>>(city, "election.json");
    const candidates = (data?.candidates as Array<Record<string, unknown>> | undefined) ?? [];
    members.push(
      ...candidates
        .filter((candidate) => candidate.result === "当選")
        .map((candidate) => ({
          city,
          cityName,
          seat_number: null,
          name: (candidate.name as string) ?? "",
          furigana: (candidate.furigana as string) ?? "",
          party: (candidate.party as string) ?? "",
          faction: (candidate.party as string) ?? "",
          committees: [],
        }))
    );
  }

  return {
    ...getSearchIndex(),
    municipalities: municipalities.map((m) => ({ slug: m.slug, name: m.name })),
    sessions,
    enriched,
    decisions,
    members,
    memberActivities,
  };
}

async function loadPublicRuntimeSearchIndex(request: NextRequest): Promise<RuntimeSearchIndex> {
  const url = new URL("/generated/search-index.json", request.url);
  const response = await fetchStaticAsset(url);
  if (!response.ok) {
    throw new Error(`search index asset not found: ${response.status}`);
  }
  const parsed = (await response.json()) as RuntimeSearchIndex;
  if (!Array.isArray(parsed.agendas)) {
    throw new Error("search index asset is malformed");
  }
  return parsed;
}

async function hasCloudflareAssets(): Promise<boolean> {
  hasCloudflareAssetsPromise ??= import("@opennextjs/cloudflare")
    .then(({ getCloudflareContext }) => getCloudflareContext({ async: true }))
    .then(({ env }) => Boolean(env.ASSETS))
    .catch(() => false);
  return hasCloudflareAssetsPromise;
}

function getCloudflareCache(): Cache | null {
  const workerCaches = (
    globalThis as typeof globalThis & {
      caches?: CacheStorage & { default?: Cache };
    }
  ).caches;
  return workerCaches?.default ?? null;
}

function buildSearchCacheKey(request: NextRequest): Request {
  const url = new URL(request.url);
  url.searchParams.sort();
  return new Request(url.toString(), { method: "GET" });
}

async function readCachedSearchResponse(request: NextRequest): Promise<Response | null> {
  if (!(await hasCloudflareAssets())) return null;
  const cache = getCloudflareCache();
  if (!cache) return null;
  const cached = await cache.match(buildSearchCacheKey(request)).catch(() => null);
  if (!cached) return null;
  const headers = new Headers(cached.headers);
  headers.set("x-gikai-search-cache", "hit");
  return new Response(cached.body, {
    status: cached.status,
    statusText: cached.statusText,
    headers,
  });
}

async function cacheSearchResponse(request: NextRequest, response: Response): Promise<Response> {
  if (!(await hasCloudflareAssets())) return response;
  const cache = getCloudflareCache();
  if (!cache) return response;
  const headers = new Headers(response.headers);
  headers.set("cache-control", `public, max-age=${SEARCH_RESPONSE_CACHE_SECONDS}`);
  headers.set("x-gikai-search-cache", "miss");

  const body = await response.text();
  const cacheable = new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
  await cache.put(buildSearchCacheKey(request), cacheable.clone()).catch(() => undefined);
  return cacheable;
}

async function getRuntimeSearchIndex(request: NextRequest): Promise<RuntimeSearchIndex> {
  if (await hasCloudflareAssets()) {
    try {
      return await loadPublicRuntimeSearchIndex(request);
    } catch {
      return emptyRuntimeSearchIndex();
    }
  }

  runtimeSearchIndexPromise ??= loadPublicRuntimeSearchIndex(request).catch(() => {
    try {
      return loadFileRuntimeSearchIndex();
    } catch {
      return emptyRuntimeSearchIndex();
    }
  });
  return runtimeSearchIndexPromise;
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

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  const cachedResponse = await readCachedSearchResponse(request);
  if (cachedResponse) return cachedResponse;

  const rateLimit = await checkRateLimit({
    bucket: "api-search-get",
    key: getClientAddress(request),
    limit: SEARCH_GET_LIMIT,
    windowSeconds: SEARCH_WINDOW_SECONDS,
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "検索回数の上限に達しました。少し待ってから再度お試しください。", sessionResults: [], memberResults: [] },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      }
    );
  }

  const q = (request.nextUrl.searchParams.get("q") ?? "").slice(0, 500);
  const cityFilter = request.nextUrl.searchParams.get("city") ?? "all";
  const yearFilter = request.nextUrl.searchParams.get("year") ?? "all";
  const factionFilter = request.nextUrl.searchParams.get("faction") ?? "all";
  const rawSourceFilter = request.nextUrl.searchParams.get("source") ?? "all";
  const rawSearchMode = request.nextUrl.searchParams.get("op") ?? "and";
  const forceFullSearch = request.nextUrl.searchParams.get("scope") === "all";
  const sourceFilter: SourceFilter =
    rawSourceFilter === "minutes" || rawSourceFilter === "session" || rawSourceFilter === "decision"
      ? rawSourceFilter
      : "all";
  const searchMode: SearchOperator = rawSearchMode === "or" ? "or" : "and";

  const searchQuery = buildSearchQuery(q);
  const queryAssist = buildSearchAssist(q);
  const exactExpandedTerms =
    queryAssist.find((group) => group.kind === "exact")?.terms ?? [];
  const relatedExpandedTerms =
    queryAssist.find((group) => group.kind === "related")?.terms ?? [];
  const searchSuggestions =
    queryAssist.find((group) => group.kind === "suggestion")?.terms ?? [];
  const tokens = searchQuery.highlightTokens;
  if (!tokens.length) {
    return NextResponse.json({
      sessionResults: [],
      memberResults: [],
      sessionTotal: 0,
      memberTotal: 0,
      sessionBaseTotal: 0,
      memberBaseTotal: 0,
      truncated: false,
      rescued: false,
      sessionRescued: false,
      memberRescued: false,
      highlightTokens: [],
      queryAssist: [],
      exactExpandedTerms: [],
      relatedExpandedTerms: [],
      searchSuggestions: [],
      searchMode,
      facets: {
        cities: [],
        sessionSources: [],
        sessionYears: [],
        memberFactions: [],
      },
    } satisfies SearchResponse);
  }

  if (shouldUseClientSearch(request) || (await hasCloudflareAssets())) {
    const searchIndex = clientSearchIndexMeta(cityFilter, yearFilter, forceFullSearch);
    const response = NextResponse.json({
      sessionResults: [],
      memberResults: [],
      sessionTotal: 0,
      memberTotal: 0,
      sessionBaseTotal: 0,
      memberBaseTotal: 0,
      truncated: false,
      rescued: false,
      sessionRescued: false,
      memberRescued: false,
      highlightTokens: tokens,
      queryAssist,
      exactExpandedTerms,
      relatedExpandedTerms,
      searchSuggestions,
      searchMode,
      facets: {
        cities: [],
        sessionSources: [],
        sessionYears: [],
        memberFactions: [],
      },
      clientSearchRequired: true,
      indexUrl: searchIndex.indexUrl,
      searchScope: searchIndex.searchScope,
      searchScopeLabel: searchIndex.searchScopeLabel,
      fullSearchAvailable: searchIndex.fullSearchAvailable,
    } satisfies SearchResponse);
    response.headers.set("x-gikai-search-mode", "client");
    response.headers.set("x-gikai-search-index-url", searchIndex.indexUrl);
    response.headers.set("x-gikai-search-index-scope", searchIndex.searchScope);
    response.headers.set("cache-control", "no-store");
    return response;
  }

  const runtimeIndex = await getRuntimeSearchIndex(request);
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
        const segments = s.segments ?? [];
        let hasMatchingSegment = false;

        for (const seg of segments) {
          const identity = sessionSegmentIdentity(seg.speaker, seg.label);
          const fields = [
            { content: identity, field: "発言者・見出し", bonus: 30, radius: 90 },
            { content: seg.summary ?? "", field: "要約", bonus: 24, radius: 100 },
            { content: (seg.topics ?? []).join(" "), field: "トピック", bonus: 20, radius: 90 },
            { content: seg.transcript ?? "", field: "全文", bonus: 10, radius: 100 },
          ];
          let segmentBestHit: RankedSessionHit | null = null;
          for (const field of fields) {
            const searchText = `${cityName} ${seg.speaker ?? ""} ${seg.label ?? ""} ${field.content}`;
            const evaluation = evaluateText(searchText);
            if (!evaluation.matched) continue;
            const score = evaluation.score + field.bonus;
            if (segmentBestHit && segmentBestHit.score >= score) continue;
            const excerpt = excerptSearchText(field.content || searchText, tokens, field.radius);
            segmentBestHit = {
              id: `${s.id}:segment:${seg.index}`,
              city,
              cityName,
              sourceType: "session",
              title,
              committee,
              href: `/${city}/sessions/${s.id}#seg-${seg.index}`,
              segIndex: seg.index,
              label: identity,
              startTime: seg.start_time ?? "",
              context: identity && !excerpt.includes(identity) ? `${identity}: ${excerpt}` : excerpt,
              field: field.field,
              date: s.date,
              year: sessionYear,
              score,
            };
          }
          if (segmentBestHit) {
            hasMatchingSegment = true;
            sessionResults.push(segmentBestHit);
          }
        }

        const titleSearchText = `${cityName} ${title} ${committee}`;
        const titleEvaluation = evaluateText(titleSearchText);
        if (!hasMatchingSegment && titleEvaluation.matched) {
          const score = titleEvaluation.score + 28;
          sessionResults.push({
            id: `${s.id}:meeting`,
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
          });
        }
    }

    const seenMinutesForEnriched = new Set<string>();
    for (const agenda of runtimeIndex.agendas) {
      const haystack = `${agenda.cityName} ${agenda.council_name} ${agenda.agenda_title} ${agenda.text}`;
      const evaluation = evaluateText(haystack);
      if (!evaluation.matched) continue;
      let score = evaluation.score + 14;
      if (agenda.agenda_title && evaluateText(agenda.agenda_title).matched) {
        score += 18;
      }
      if (evaluateText(agenda.council_name).matched) {
        score += 10;
      }
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
      seenMinutesForEnriched.add(`${agenda.city}_${agenda.council_id}`);
    }

    for (const activity of runtimeIndex.memberActivities ?? []) {
        const city = activity.city;
        const cityName = activity.cityName || cityMap[city] || city;
        const minuteKey = `${city}_${activity.council_id}`;
        const searchText = memberActivityText(activity, cityName);
        const evaluation = evaluateText(searchText);
        if (!evaluation.matched) continue;
        const summaryTopics = uniqueTexts(activity.summary_topics ?? []);
        const topics = uniqueTexts(activity.topics ?? []);
        const contextText = memberActivityContext(activity, summaryTopics, topics, tokens) || excerptSearchText(searchText, tokens, 100);
        let score = evaluation.score + 32;
        const topicText = [...summaryTopics, ...topics].join(" ");
        if (topicText && evaluateText(topicText).matched) score += 22;
        if (evaluateText(activity.member_name).matched) score += 12;
        if (evaluateText(activity.council_name).matched) score += 8;
        const sourceType = memberActivitySourceType(activity);
        const fallbackHref = Number(activity.council_id) > 0
          ? `/${city}/minutes/${activity.council_id}`
          : `/${city}`;
        sessionResults.push({
          id: `member_activity:${activity.record_id || `${city}:${activity.member_name}:${activity.council_id}:${activity.date || "undated"}`}`,
          city,
          cityName,
          sourceType,
          title: activity.council_name,
          committee: `${activity.member_name}議員の${memberActivityQuestionLabel(activity.question_kind)}`,
          href: activity.href || fallbackHref,
          segIndex: 0,
          label: memberActivityDisplayLabel(activity),
          startTime: activity.start_time ?? "",
          context: contextText,
          field: memberActivityQuestionLabel(activity.question_kind),
          date: activity.date,
          year: activity.year || yearFromDate(activity.date) || yearFromCouncilName(activity.council_name),
          score,
        });
        if (Number(activity.council_id) > 0) seenMinutesForEnriched.add(minuteKey);
    }

    for (const doc of runtimeIndex.enriched ?? []) {
        const city = doc.city;
        const cityName = doc.cityName || cityMap[city] || city;
        const minuteKey = `${city}_${doc.council_id}`;
        if (seenMinutesForEnriched.has(minuteKey)) continue;
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

  const MAX_RESULTS = 200;
  const response = NextResponse.json({
    sessionResults: stripSessionScore(filteredSessions.slice(0, MAX_RESULTS)),
    memberResults: stripMemberScore(filteredMembers.slice(0, MAX_RESULTS)),
    sessionTotal: filteredSessions.length,
    memberTotal: filteredMembers.length,
    sessionBaseTotal: sessionResults.length,
    memberBaseTotal: memberResults.length,
    truncated: filteredSessions.length > MAX_RESULTS || filteredMembers.length > MAX_RESULTS,
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
    searchScope: "server",
    searchScopeLabel: "全期間",
    fullSearchAvailable: false,
  } satisfies SearchResponse);
  return cacheSearchResponse(request, response);
}

export async function POST(request: NextRequest) {
  const rateLimit = await checkRateLimit({
    bucket: "api-search-post",
    key: getClientAddress(request),
    limit: SEARCH_POST_LIMIT,
    windowSeconds: SEARCH_WINDOW_SECONDS,
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "検索回数の上限に達しました。少し待ってから再度お試しください。" },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      }
    );
  }

  return NextResponse.json(
    { error: "AI検索は終了しました。通常検索をご利用ください。" },
    { status: 410 }
  );
}
