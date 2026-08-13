import fs from "node:fs/promises";
import path from "node:path";

import type { ResearchConfig } from "../../config.js";
import type {
  PolicySourceAdapter,
  PolicySourceDocument,
  ResearchSearchQuery,
} from "../types.js";
import { generateRuleBasedSearchTerms } from "../query/searchTerms.js";

const PLENARY_SOURCE_TYPE = "plenary_minutes" as const;
const SAFE_MUNICIPALITY_ID = /^[a-z0-9_-]+$/;

export interface GikaiAgendaEntry {
  id?: string;
  city: string;
  cityName: string;
  council_id: number | string;
  council_name: string;
  schedule_index: number;
  schedule_name: string;
  agenda_title: string;
  text: string;
  year?: string | number;
  date?: string;
  first_minute_id?: number | null;
  truncated?: boolean;
}

export interface GikaiSearchIndex {
  agendas: GikaiAgendaEntry[];
  municipalities?: Array<{ slug: string; name: string }>;
}

export interface GikaiMunicipalityEntry {
  slug: string;
  name: string;
  active?: boolean;
  minutes_access?: string;
}

export interface GikaiMinutesIndexEntry {
  council_id: number | string;
  name?: string;
  year?: string | number;
  type_label?: string;
}

export interface GikaiIndexSource {
  loadSearchIndex(municipalities?: readonly string[]): Promise<GikaiSearchIndex>;
  loadMunicipalities(): Promise<GikaiMunicipalityEntry[]>;
  loadMinutesIndex(municipalityId: string): Promise<GikaiMinutesIndexEntry[]>;
}

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

interface CachedValue<T> {
  expiresAt: number;
  value: Promise<T>;
}

export interface FileOrHttpGikaiIndexSourceOptions {
  fetch?: FetchLike;
  now?: () => number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSearchIndex(value: unknown): GikaiSearchIndex {
  if (!isRecord(value) || !Array.isArray(value.agendas)) {
    throw new Error("gikai_search_index_invalid");
  }
  return value as unknown as GikaiSearchIndex;
}

function parseArray<T>(value: unknown, errorCode: string): T[] {
  if (!Array.isArray(value)) throw new Error(errorCode);
  return value as T[];
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export class FileOrHttpGikaiIndexSource implements GikaiIndexSource {
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly cache = new Map<string, CachedValue<unknown>>();

  constructor(
    private readonly config: ResearchConfig,
    options: FileOrHttpGikaiIndexSourceOptions = {},
  ) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
  }

  async loadSearchIndex(
    municipalities: readonly string[] = [],
  ): Promise<GikaiSearchIndex> {
    if (this.config.gikaiSearchIndexPath) {
      return parseSearchIndex(
        await this.readLocalJson(
          "search-index:local",
          this.config.gikaiSearchIndexPath,
        ),
      );
    }

    const safeMunicipalities = Array.from(
      new Set(municipalities.filter((id) => SAFE_MUNICIPALITY_ID.test(id))),
    );
    if (safeMunicipalities.length > 0 && safeMunicipalities.length <= 10) {
      const indexes = await Promise.all(
        safeMunicipalities.map((municipalityId) => {
          const url = `${trimTrailingSlash(this.config.gikaiCityIndexBaseUrl)}/${municipalityId}.json`;
          return this.fetchJson(`search-index:city:${municipalityId}`, url).then(
            parseSearchIndex,
          );
        }),
      );
      return {
        agendas: indexes.flatMap((index) => index.agendas),
        municipalities: indexes.flatMap(
          (index) => index.municipalities ?? [],
        ),
      };
    }

    return parseSearchIndex(
      await this.fetchJson("search-index:global", this.config.gikaiSearchIndexUrl),
    );
  }

  async loadMunicipalities(): Promise<GikaiMunicipalityEntry[]> {
    const value = this.config.gikaiDataPath
      ? await this.readLocalJson(
          "municipalities:local",
          path.join(this.config.gikaiDataPath, "municipalities.json"),
        )
      : await this.fetchJson(
          "municipalities:remote",
          `${trimTrailingSlash(this.config.gikaiDataRawBaseUrl)}/municipalities.json`,
        );
    return parseArray<GikaiMunicipalityEntry>(value, "gikai_municipalities_invalid");
  }

  async loadMinutesIndex(
    municipalityId: string,
  ): Promise<GikaiMinutesIndexEntry[]> {
    if (!SAFE_MUNICIPALITY_ID.test(municipalityId)) return [];
    try {
      const value = this.config.gikaiDataPath
        ? await this.readLocalJson(
            `minutes-index:local:${municipalityId}`,
            path.join(
              this.config.gikaiDataPath,
              municipalityId,
              "minutes",
              "index.json",
            ),
          )
        : await this.fetchJson(
            `minutes-index:remote:${municipalityId}`,
            `${trimTrailingSlash(this.config.gikaiDataRawBaseUrl)}/${municipalityId}/minutes/index.json`,
          );
      return parseArray<GikaiMinutesIndexEntry>(
        value,
        "gikai_minutes_index_invalid",
      );
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error.message.includes(":404") ||
          ("code" in error && error.code === "ENOENT"))
      ) {
        return [];
      }
      throw error;
    }
  }

  private async readLocalJson(cacheKey: string, filePath: string): Promise<unknown> {
    return this.cached(cacheKey, async () =>
      JSON.parse(await fs.readFile(filePath, "utf8")),
    );
  }

  private async fetchJson(cacheKey: string, url: string): Promise<unknown> {
    return this.cached(cacheKey, async () => {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        this.config.gikaiFetchTimeoutMs,
      );
      try {
        const response = await this.fetchImpl(url, {
          headers: { accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`gikai_index_fetch_failed:${response.status}`);
        }
        return (await response.json()) as unknown;
      } finally {
        clearTimeout(timeout);
      }
    });
  }

  private cached<T>(cacheKey: string, load: () => Promise<T>): Promise<T> {
    const current = this.cache.get(cacheKey) as CachedValue<T> | undefined;
    if (current && current.expiresAt > this.now()) return current.value;

    const value = load().catch((error: unknown) => {
      this.cache.delete(cacheKey);
      throw error;
    });
    this.cache.set(cacheKey, {
      expiresAt: this.now() + this.config.indexCacheTtlSeconds * 1000,
      value,
    });
    return value;
  }
}

function normalizeForSearch(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\u3000/g, " ")
    .replace(/[ァ-ヶ]/g, (character) =>
      String.fromCharCode(character.charCodeAt(0) - 0x60),
    )
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function searchTokens(query: string): string[] {
  return normalizeForSearch(query).split(/\s+/).filter(Boolean);
}

function matchesEveryToken(text: string, tokens: readonly string[]): boolean {
  const normalized = normalizeForSearch(text);
  const compact = normalized.replace(/\s+/g, "");
  return tokens.every((token) => {
    const compactToken = token.replace(/\s+/g, "");
    return (
      normalized.includes(token) ||
      (compactToken.length >= 2 && compact.includes(compactToken))
    );
  });
}

function occurrenceScore(text: string, token: string): number {
  let score = 0;
  let start = 0;
  while (start < text.length) {
    const index = text.indexOf(token, start);
    if (index < 0) break;
    score += 1;
    start = index + Math.max(1, token.length);
  }
  return score;
}

function scoreAgenda(agenda: GikaiAgendaEntry, tokens: readonly string[]): number {
  const title = normalizeForSearch(agenda.agenda_title ?? "");
  const meeting = normalizeForSearch(agenda.council_name ?? "");
  const body = normalizeForSearch(agenda.text ?? "");
  return tokens.reduce(
    (score, token) =>
      score +
      occurrenceScore(body, token) * 10 +
      occurrenceScore(title, token) * 30 +
      occurrenceScore(meeting, token) * 15,
    0,
  );
}

function agendaIdentity(agenda: GikaiAgendaEntry): string {
  const councilId = String(agenda.council_id);
  const existingId = agenda.id?.trim();
  if (existingId?.startsWith("agenda:")) return existingId;
  return `agenda:${agenda.city}:${councilId}:${agenda.schedule_index}:${agenda.first_minute_id ?? "x"}`;
}

function isPlenaryType(typeLabel: string): boolean {
  return typeLabel.includes("本会議") && !typeLabel.includes("委員会");
}

function numericYear(value: string | number | undefined): number | null {
  const year = Number(value);
  return Number.isInteger(year) && year > 0 ? year : null;
}

function fiscalYearForAgenda(agenda: GikaiAgendaEntry): number | null {
  const calendarYear = numericYear(agenda.year);
  const dateMatch = agenda.date?.match(/^(\d{4})-(\d{2})-/);
  if (!dateMatch) return calendarYear;
  const datedYear = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  if (!Number.isInteger(datedYear) || month < 1 || month > 12) {
    return calendarYear;
  }
  return month <= 3 ? datedYear - 1 : datedYear;
}

function selectBalanced(
  documents: Array<PolicySourceDocument & { metadata: Record<string, unknown> }>,
  limit: number,
): PolicySourceDocument[] {
  const groups = new Map<string, typeof documents>();
  for (const document of documents) {
    const group = groups.get(document.municipalityId) ?? [];
    group.push(document);
    groups.set(document.municipalityId, group);
  }

  const selected: PolicySourceDocument[] = [];
  let offset = 0;
  while (selected.length < limit) {
    let added = false;
    for (const group of groups.values()) {
      const document = group[offset];
      if (!document) continue;
      selected.push(document);
      added = true;
      if (selected.length >= limit) break;
    }
    if (!added) break;
    offset += 1;
  }
  return selected;
}

export interface GikaiMinutesAdapterOptions {
  source?: GikaiIndexSource;
}

export class GikaiMinutesAdapter implements PolicySourceAdapter {
  readonly sourceTypes = [PLENARY_SOURCE_TYPE];
  private readonly source: GikaiIndexSource;

  constructor(
    private readonly config: ResearchConfig,
    options: GikaiMinutesAdapterOptions = {},
  ) {
    this.source = options.source ?? new FileOrHttpGikaiIndexSource(config);
  }

  async resolveMunicipalityNames(
    municipalityIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>> {
    const requested = new Set(municipalityIds);
    return new Map(
      (await this.source.loadMunicipalities())
        .filter((municipality) => requested.has(municipality.slug))
        .map((municipality) => [municipality.slug, municipality.name]),
    );
  }

  async search(query: ResearchSearchQuery): Promise<PolicySourceDocument[]> {
    if (
      query.sourceTypes?.length &&
      !query.sourceTypes.includes(PLENARY_SOURCE_TYPE)
    ) {
      return [];
    }

    const [municipalities, searchIndex] = await Promise.all([
      this.source.loadMunicipalities(),
      this.source.loadSearchIndex(query.municipalities ?? []),
    ]);
    const tokenGroups = generateRuleBasedSearchTerms(
      query.query,
      undefined,
      municipalities.map((municipality) => municipality.name),
    )
      .map(searchTokens)
      .filter((tokens) => tokens.length > 0);
    if (tokenGroups.length === 0) return [];
    const publicMunicipalities = new Map(
      municipalities
        .filter(
          (entry) =>
            entry.active !== false && entry.minutes_access !== "restricted",
        )
        .map((entry) => [entry.slug, entry]),
    );
    const requestedMunicipalities = (query.municipalities ?? []).filter(
      (id) => SAFE_MUNICIPALITY_ID.test(id) && publicMunicipalities.has(id),
    );
    if (query.municipalities?.length && requestedMunicipalities.length === 0) {
      return [];
    }
    const requestedSet = requestedMunicipalities.length
      ? new Set(requestedMunicipalities)
      : null;
    const yearSet = query.fiscalYears?.length
      ? new Set(query.fiscalYears)
      : null;

    const candidates = searchIndex.agendas.filter((agenda) => {
      if (!publicMunicipalities.has(agenda.city)) return false;
      if (requestedSet && !requestedSet.has(agenda.city)) return false;
      const year = fiscalYearForAgenda(agenda);
      if (yearSet && (year === null || !yearSet.has(year))) return false;
      const haystack = [
        agenda.cityName,
        agenda.council_name,
        agenda.schedule_name,
        agenda.agenda_title,
        agenda.text,
      ].join(" ");
      return tokenGroups.some((tokens) => matchesEveryToken(haystack, tokens));
    });
    if (candidates.length === 0) return [];

    const candidateCities = Array.from(
      new Set(candidates.map((agenda) => agenda.city)),
    );
    const minuteIndexes = await Promise.all(
      candidateCities.map(async (municipalityId) => [
        municipalityId,
        await this.source.loadMinutesIndex(municipalityId),
      ] as const),
    );
    const typeLabels = new Map<string, string>();
    for (const [municipalityId, entries] of minuteIndexes) {
      for (const entry of entries) {
        if (typeof entry.type_label !== "string") continue;
        typeLabels.set(
          `${municipalityId}:${String(entry.council_id)}`,
          entry.type_label,
        );
      }
    }

    const documents = candidates.flatMap((agenda) => {
      const councilId = String(agenda.council_id);
      const typeLabel = typeLabels.get(`${agenda.city}:${councilId}`);
      if (!typeLabel || !isPlenaryType(typeLabel)) return [];
      const municipality = publicMunicipalities.get(agenda.city);
      if (!municipality) return [];
      const fiscalYear = fiscalYearForAgenda(agenda);
      const score = Math.max(
        ...tokenGroups.map((tokens) => scoreAgenda(agenda, tokens)),
      );
      const sourceUrl = `${trimTrailingSlash(this.config.gikaiPublicBaseUrl)}/${encodeURIComponent(agenda.city)}/minutes/${encodeURIComponent(councilId)}?q=${encodeURIComponent(query.query)}`;
      const metadata: Record<string, unknown> = {
        councilId,
        scheduleIndex: agenda.schedule_index,
        scheduleName: agenda.schedule_name,
        agendaTitle: agenda.agenda_title,
        meetingCalendarYear: numericYear(agenda.year),
        fiscalYearBasis: agenda.date
          ? "japanese_fiscal_year_derived_from_date"
          : "meeting_calendar_year_fallback",
        searchScore: score,
        searchTextTruncated: agenda.truncated ?? true,
      };
      if (agenda.first_minute_id !== undefined) {
        metadata.firstMinuteId = agenda.first_minute_id;
      }
      const document: PolicySourceDocument & {
        metadata: Record<string, unknown>;
      } = {
        id: agendaIdentity(agenda),
        municipalityId: agenda.city,
        municipalityName: municipality.name || agenda.cityName,
        sourceType: PLENARY_SOURCE_TYPE,
        documentType: typeLabel,
        title: agenda.council_name,
        meetingName: agenda.council_name,
        section: agenda.agenda_title || agenda.schedule_name,
        text: agenda.text,
        sourceUrl,
        evidenceLevel: "excerpt_verified",
        metadata,
        ...(fiscalYear === null ? {} : { fiscalYear }),
        ...(agenda.date ? { date: agenda.date } : {}),
      };
      return [document];
    });

    documents.sort((left, right) => {
      const scoreDifference =
        Number(right.metadata.searchScore ?? 0) -
        Number(left.metadata.searchScore ?? 0);
      if (scoreDifference !== 0) return scoreDifference;
      const dateDifference = (right.date ?? "").localeCompare(left.date ?? "");
      return dateDifference || left.id.localeCompare(right.id);
    });

    const limit = this.config.maxResultsPerSearch;
    const shouldBalance =
      query.mode === "comparison" || requestedMunicipalities.length > 1;
    return shouldBalance
      ? selectBalanced(documents, limit)
      : documents.slice(0, limit);
  }
}
