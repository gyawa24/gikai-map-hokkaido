"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import type { SessionHit, MemberHit, SearchFacet } from "@/app/api/search/route";

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
  "子育て支援",
  "議決結果",
  "議員名で検索",
];

const SEARCH_SHORTCUTS = [
  { label: "議員を探す", tab: "members" as const, source: "all" as SourceFilter },
  { label: "議事録を探す", tab: "sessions" as const, source: "minutes" as SourceFilter },
  { label: "議決を探す", tab: "sessions" as const, source: "decision" as SourceFilter },
  { label: "速報を探す", tab: "sessions" as const, source: "session" as SourceFilter },
];

type SearchClientProps = {
  initialQuery?: string;
  initialTab?: string;
  initialSource?: string;
};

function SearchClientInner({ initialQuery = "", initialTab = "", initialSource = "" }: SearchClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(() => searchParams.get("q") ?? initialQuery);
  const [tab, setTab] = useState<"sessions" | "members">(() =>
    (searchParams.get("tab") ?? initialTab) === "members" ? "members" : "sessions"
  );
  const [cityFilter, setCityFilter] = useState<string>(() => searchParams.get("city") ?? "all");
  const [cityLabelHint] = useState(() => searchParams.get("cityName") ?? "");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>(() => {
    const value = searchParams.get("source") ?? initialSource;
    return value === "minutes" || value === "session" || value === "decision" ? value : "all";
  });
  const [factionFilter, setFactionFilter] = useState<string>(() => searchParams.get("faction") ?? "all");
  const [yearFilter, setYearFilter] = useState<string>(() => searchParams.get("year") ?? "all");
  const [sessionSort, setSessionSort] = useState<SessionSort>(() => searchParams.get("sessionSort") === "newest" ? "newest" : "relevance");
  const [memberSort, setMemberSort] = useState<MemberSort>(() => {
    const value = searchParams.get("memberSort");
    return value === "name" || value === "city" ? value : "relevance";
  });
  const [searchMode, setSearchMode] = useState<SearchMode>(() => searchParams.get("op") === "or" ? "or" : "and");
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
  const [recentQueries, setRecentQueries] = useState<string[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hasSearchResponse, setHasSearchResponse] = useState(false);
  const [error, setError] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const nextQuery = searchParams.get("q") ?? "";
    if (nextQuery !== query) setQuery(nextQuery);
    const nextTab = searchParams.get("tab") === "members" ? "members" : "sessions";
    if (nextTab !== tab) setTab(nextTab);
    const nextSource = searchParams.get("source");
    if (
      nextSource &&
      (nextSource === "minutes" || nextSource === "session" || nextSource === "decision") &&
      nextSource !== sourceFilter
    ) {
      setSourceFilter(nextSource);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

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
        const res = await fetch(`/api/search?${params.toString()}`, { signal: controller.signal });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "検索に失敗しました");
        }
        const data = await res.json();
        if (requestIdRef.current !== requestId) return;
        setSessionResults(data.sessionResults ?? []);
        setMemberResults(data.memberResults ?? []);
        setSessionTotal(data.sessionTotal ?? (data.sessionResults ?? []).length);
        setMemberTotal(data.memberTotal ?? (data.memberResults ?? []).length);
        setCityFacets(data.facets?.cities ?? []);
        setSessionSourceFacets(data.facets?.sessionSources ?? []);
        setSessionYearFacets(data.facets?.sessionYears ?? []);
        setMemberFactionFacets(data.facets?.memberFactions ?? []);
        setExactExpandedTerms(data.exactExpandedTerms ?? []);
        setRelatedExpandedTerms(data.relatedExpandedTerms ?? []);
        setSearchSuggestions(data.searchSuggestions ?? []);
        setTruncated(Boolean(data.truncated));
        setHasSearchResponse(true);
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
  }, [query, searchMode, cityFilter, sourceFilter, yearFilter, factionFilter, tab]);

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

  const totalResults = tab === "sessions" ? sortedSessions.length : sortedMembers.length;

  const availableSourceTypes = new Set(
    sessionSourceFacets
      .map((facet) => facet.value)
      .filter((value): value is SourceFilter => value === "minutes" || value === "session" || value === "decision")
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
      setSourceFilter("all");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableSourcesKey, hasSearchResponse]);
  useEffect(() => {
    if (!hasSearchResponse) return;
    if (yearFilter !== "all" && !availableYears.includes(yearFilter)) {
      setYearFilter("all");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableYearsKey, hasSearchResponse]);
  useEffect(() => {
    if (!hasSearchResponse) return;
    if (factionFilter !== "all" && !availableFactions.includes(factionFilter)) {
      setFactionFilter("all");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableFactionsKey, hasSearchResponse]);

  useEffect(() => {
    const params = new URLSearchParams();
    const trimmed = query.trim();
    if (trimmed) params.set("q", trimmed);
    if (tab !== "sessions") params.set("tab", tab);
    if (cityFilter !== "all") params.set("city", cityFilter);
    if (sourceFilter !== "all") params.set("source", sourceFilter);
    if (yearFilter !== "all") params.set("year", yearFilter);
    if (factionFilter !== "all") params.set("faction", factionFilter);
    if (searchMode !== "and") params.set("op", searchMode);
    if (sessionSort !== "relevance") params.set("sessionSort", sessionSort);
    if (memberSort !== "relevance") params.set("memberSort", memberSort);
    const nextParams = params.toString();
    if (nextParams === searchParams.toString()) return;
    const next = nextParams ? `${pathname}?${nextParams}` : pathname;
    router.replace(next, { scroll: false });
  }, [pathname, router, searchParams, query, tab, cityFilter, sourceFilter, yearFilter, factionFilter, searchMode, sessionSort, memberSort]);

  const activeFilters = [
    cityFilter !== "all" ? availableCities.find((city) => city.id === cityFilter)?.name ?? cityFilter : "",
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
  const groupedSessions = groupByCity(sortedSessions);
  const groupedMembers = groupByCity(sortedMembers);
  const showGroupedSessions = cityFilter === "all" && groupedSessions.length > 1;
  const showGroupedMembers = cityFilter === "all" && groupedMembers.length > 1;
  const hasFilterBlocks =
    hasQuery &&
    ((tab === "sessions" && (availableSourceTypes.size > 1 || availableYears.length > 1 || availableCities.length > 1)) ||
      (tab === "members" && (availableFactions.length > 1 || availableCities.length > 1)));
  const scopedCityLabel = cityFilter !== "all" ? cityLabelHint || cityFilter : "";

  function clearFilters() {
    setCityFilter("all");
    setSourceFilter("all");
    setFactionFilter("all");
    setYearFilter("all");
    setSessionSort("relevance");
    setMemberSort("relevance");
  }

  function applyShortcut(tabValue: "sessions" | "members", sourceValue: SourceFilter) {
    setTab(tabValue);
    setFiltersOpen(true);
    if (tabValue === "sessions") {
      setSourceFilter(sourceValue);
      if (sourceValue !== "all") setYearFilter("all");
      return;
    }
    setSourceFilter("all");
  }

  return (
    <div className="page-shell flex max-w-5xl flex-col gap-4">
      <div className="theme-panel px-4 py-5 sm:px-6">
        <label htmlFor="site-search" className="mb-2 block text-lg font-black text-[#1B3A6B]">
          キーワード検索
        </label>
        <div className="relative">
          <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#718096]"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            aria-hidden="true">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            id="site-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="給食無償化、除雪、ラピダス、防災、議員名で検索"
            className="theme-input w-full min-h-12 py-3 pl-9 pr-20 text-base sm:min-h-14 sm:pr-24 sm:text-lg"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded text-xs font-bold text-[#718096] hover:text-[#1A202C] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8AA3CF]"
              aria-label="検索をクリア"
            >
              クリア
            </button>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {SEARCH_SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              onClick={() => setQuery(suggestion)}
              className="inline-flex min-h-11 items-center rounded-full border border-[#CBD5E0] bg-white px-3 py-2 text-sm font-semibold text-[#1B3A6B] transition-colors hover:border-[#1B3A6B] hover:bg-[#E8EEF7]"
              type="button"
            >
              {suggestion}
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-[#667085]">複数語の条件</span>
          <div className="inline-flex rounded-full border border-[#CBD5E0] bg-white p-1">
            <button
              type="button"
              onClick={() => setSearchMode("and")}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                searchMode === "and" ? "bg-[#1B3A6B] text-white" : "text-[#4A5568] hover:text-[#1B3A6B]"
              }`}
            >
              AND
            </button>
            <button
              type="button"
              onClick={() => setSearchMode("or")}
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

        <div className="mt-3 flex flex-wrap gap-1.5">
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

        {!hasQuery && recentQueries.length > 0 && (
          <div className="mt-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#667085]">最近の検索</p>
            <div className="flex flex-wrap gap-1.5">
              {recentQueries.map((item) => (
                <button
                  key={item}
                  onClick={() => setQuery(item)}
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
              ? `${scopedCityLabel}に絞った状態です。議題名、政策テーマ、施設名、議員名、会派名などで探せます。`
              : "議題名、政策テーマ、施設名、議員名、会派名などで探せます。"}
            複数語は AND/OR を切り替えて使えます。
          </p>
        )}
      </div>

      {hasQuery && (
        <div className="theme-card-soft px-4 py-3">
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
                    setSessionSort(e.target.value as SessionSort);
                    return;
                  }
                  setMemberSort(e.target.value as MemberSort);
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

      <div className={`${hasFilterBlocks && !filtersOpen ? "hidden sm:block" : "block"} space-y-4`}>
      {/* 市フィルタ */}
      {hasQuery && (sessionResults.length > 0 || memberResults.length > 0) && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#667085]">市町村で絞る</p>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setCityFilter("all")}
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
                onClick={() => setCityFilter(cityFilter === c.id ? "all" : c.id)}
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

      {/* タブ */}
      <div className="flex border-b border-[#E2E8F0]">
        {(["sessions", "members"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8AA3CF] rounded-t sm:px-4 ${
              tab === t
                ? "border-[#8AA3CF] text-[#1B3A6B]"
                : "border-transparent text-[#718096] hover:text-[#1A202C]"
            }`}
            aria-current={tab === t ? "true" : undefined}
          >
            {t === "sessions" ? "議事録・議決結果" : "議員"}
            {hasQuery && !loading && (
              <span className="ml-1.5 rounded-full bg-[#F4F8FF] px-1.5 py-0.5 text-xs text-[#1B3A6B]">
                {t === "sessions" ? filteredSessions.length : filteredMembers.length}
              </span>
            )}
          </button>
        ))}
      </div>

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
                onClick={() => setSourceFilter(s)}
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
            onClick={() => setYearFilter("all")}
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
              onClick={() => setYearFilter(yearFilter === y ? "all" : y)}
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
            onClick={() => setFactionFilter("all")}
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
              onClick={() => setFactionFilter(factionFilter === f ? "all" : f)}
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
            <Link href="/topics" className="theme-button px-4 py-2 text-sm">
              テーマ一覧を見る
            </Link>
            <Link href="/sources" className="theme-button px-4 py-2 text-sm">
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
                    onClick={() => setQuery(suggestion)}
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
            onClick={() => setTab("members")}
            className="theme-button shrink-0 px-3 py-1 text-xs"
          >
            議員タブを見る
          </button>
        </div>
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
          {(showGroupedSessions ? groupedSessions : [{ city: "all", cityName: "すべて", items: sortedSessions }]).map((group) => (
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
                {group.items.map((r, i) => (
                  <Link
                    key={`${group.city}-${i}`}
                    href={r.href}
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
                      {r.committee && r.sourceType !== "decision" && (
                        <span className="theme-pill-soft hidden text-[#1B3A6B] sm:inline-flex">{r.committee}</span>
                      )}
                      {r.label && (
                        <span className="theme-pill-soft hidden sm:inline-flex">{r.label}{r.startTime ? ` ${r.startTime}〜` : ""}</span>
                      )}
                      <span className="theme-pill-soft ml-auto text-[#6B4C11]">ヒット: {r.field}</span>
                    </div>
                    <p className="mb-1 text-[15px] font-black leading-snug text-[#1B3A6B] sm:text-base">{r.title}</p>
                    <p className="text-[12px] leading-relaxed text-[#556170] sm:text-xs">
                      <Highlight text={r.context} tokens={tokens} />
                    </p>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 議員結果 */}
      {tab === "members" && hasQuery && !loading && sortedMembers.length > 0 && (
        <div className="flex flex-col gap-3">
          {(showGroupedMembers ? groupedMembers : [{ city: "all", cityName: "すべて", items: sortedMembers }]).map((group) => (
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
