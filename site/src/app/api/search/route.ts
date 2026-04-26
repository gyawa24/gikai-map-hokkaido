import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { getMunicipalities } from "@/lib/municipalities";
import {
  buildExpansionSummary,
  buildQuerySuggestions,
  buildTokenGroups,
  normalizeForSearch,
  type SearchTokenGroup,
} from "@/lib/searchSynonyms";

// ---------------------------------------------------------------------------
// Rate limiting (in-memory)
// ---------------------------------------------------------------------------
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();
const MAX_SEARCH_PER_MINUTE = 30;
const MINUTE_MS = 60 * 1000;

function getClientIP(req: NextRequest): string {
  return (
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

function checkSearchRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(ip);
  if (!entry || now > entry.resetTime) {
    rateLimitStore.set(ip, { count: 1, resetTime: now + MINUTE_MS });
    return true;
  }
  if (entry.count >= MAX_SEARCH_PER_MINUTE) return false;
  entry.count++;
  return true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function tokenize(query: string): string[] {
  return query.trim().split(/\s+/).filter(Boolean);
}

function bestGroupMatch(text: string, tokenGroup: SearchTokenGroup, mode: "exact" | "prefix" | "includes"): number {
  const normalizedText = normalizeForSearch(text);
  let best = 0;

  for (const variant of tokenGroup) {
    const hit =
      mode === "exact"
        ? normalizedText === variant.normalized
        : mode === "prefix"
          ? normalizedText.startsWith(variant.normalized)
          : normalizedText.includes(variant.normalized);
    if (hit) best = Math.max(best, variant.boost);
  }

  return best;
}

function matchesAll(text: string, tokenGroups: SearchTokenGroup[]): boolean {
  return tokenGroups.every((group) => bestGroupMatch(text, group, "includes") > 0);
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

function excerpt(text: string, tokens: string[], radius = 60): string {
  const first = tokens[0] ?? "";
  const idx = normalizeForSearch(text).indexOf(normalizeForSearch(first));
  if (idx === -1) return text.slice(0, radius * 2);
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + first.length + radius);
  return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}

function includesNormalized(text: string, token: string): boolean {
  return normalizeForSearch(text).includes(normalizeForSearch(token));
}

function exactNormalized(text: string, query: string): boolean {
  return normalizeForSearch(text) === normalizeForSearch(query);
}

function prefixNormalized(text: string, query: string): boolean {
  return normalizeForSearch(text).startsWith(normalizeForSearch(query));
}

function computeSessionScore(params: {
  query: string;
  tokenGroups: SearchTokenGroup[];
  title: string;
  committee?: string;
  label?: string;
  context?: string;
  field: string;
  sourceType: SessionHit["sourceType"];
  year?: string;
}): number {
  const { query, tokenGroups, title, committee = "", label = "", context = "", field, sourceType, year = "" } = params;
  let score = 0;

  if (exactNormalized(title, query)) score += 200;
  else if (prefixNormalized(title, query)) score += 120;

  if (exactNormalized(committee, query)) score += 140;
  else if (prefixNormalized(committee, query)) score += 90;

  if (exactNormalized(label, query)) score += 80;
  if (includesNormalized(context, query)) score += 32;

  for (const group of tokenGroups) {
    const titlePrefix = bestGroupMatch(title, group, "prefix");
    const titleIncludes = bestGroupMatch(title, group, "includes");
    const committeePrefix = bestGroupMatch(committee, group, "prefix");
    const committeeIncludes = bestGroupMatch(committee, group, "includes");
    const labelIncludes = bestGroupMatch(label, group, "includes");
    const contextIncludes = bestGroupMatch(context, group, "includes");

    if (titlePrefix > 0) score += Math.round(26 * titlePrefix);
    else if (titleIncludes > 0) score += Math.round(18 * titleIncludes);

    if (committeePrefix > 0) score += Math.round(18 * committeePrefix);
    else if (committeeIncludes > 0) score += Math.round(12 * committeeIncludes);

    if (labelIncludes > 0) score += Math.round(10 * labelIncludes);
    if (contextIncludes > 0) score += Math.round(6 * contextIncludes);
  }

  if (field === "会議名") score += 32;
  if (field === "要約") score += 18;
  if (field === "トピック") score += 16;
  if (field === "議決") score += 12;
  if (sourceType === "session") score += 14;
  if (sourceType === "minutes") score += 8;
  if (year) score += Math.min(20, Math.max(0, Number(year) - 2020));

  return score;
}

function computeMemberScore(params: {
  query: string;
  tokenGroups: SearchTokenGroup[];
  name: string;
  furigana?: string;
  party?: string;
  faction?: string;
  committees: string[];
}): number {
  const { query, tokenGroups, name, furigana = "", party = "", faction = "", committees } = params;
  let score = 0;

  if (exactNormalized(name, query)) score += 240;
  else if (prefixNormalized(name, query)) score += 150;

  if (exactNormalized(furigana, query)) score += 110;
  else if (prefixNormalized(furigana, query)) score += 70;

  if (exactNormalized(party, query) || exactNormalized(faction, query)) score += 90;

  for (const group of tokenGroups) {
    const namePrefix = bestGroupMatch(name, group, "prefix");
    const nameIncludes = bestGroupMatch(name, group, "includes");
    const furiganaIncludes = bestGroupMatch(furigana, group, "includes");
    const partyIncludes = bestGroupMatch(party, group, "includes");
    const factionIncludes = bestGroupMatch(faction, group, "includes");

    if (namePrefix > 0) score += Math.round(30 * namePrefix);
    else if (nameIncludes > 0) score += Math.round(20 * nameIncludes);

    if (furiganaIncludes > 0) score += Math.round(14 * furiganaIncludes);
    if (partyIncludes > 0) score += Math.round(10 * partyIncludes);
    if (factionIncludes > 0) score += Math.round(10 * factionIncludes);

    for (const committee of committees) {
      const committeeIncludes = bestGroupMatch(committee, group, "includes");
      if (committeeIncludes > 0) score += Math.round(6 * committeeIncludes);
    }
  }

  return score;
}

// ---------------------------------------------------------------------------
// Build city name map dynamically
// ---------------------------------------------------------------------------
let _cityMap: Record<string, string> | null = null;
function getCityMap(): Record<string, string> {
  if (_cityMap) return _cityMap;
  const munis = getMunicipalities().filter((m) => m.active);
  _cityMap = Object.fromEntries(munis.map((m) => [m.slug, m.name]));
  return _cityMap;
}

let _citySlugByName: Record<string, string> | null = null;
function getCitySlugByName(): Record<string, string> {
  if (_citySlugByName) return _citySlugByName;
  const munis = getMunicipalities().filter((m) => m.active);
  _citySlugByName = Object.fromEntries(munis.map((m) => [m.name, m.slug]));
  return _citySlugByName;
}

const minutesMeetingCache = new Map<string, Record<string, number>>();
function getMinutesMeetingMap(slug: string): Record<string, number> {
  const cached = minutesMeetingCache.get(slug);
  if (cached) return cached;

  const candidates = [
    path.join(process.cwd(), "data", slug, "minutes", "index.json"),
    path.join(process.cwd(), "data", slug, "index.json"),
  ];

  for (const fp of candidates) {
    try {
      const index = JSON.parse(fs.readFileSync(fp, "utf-8")) as Array<Record<string, unknown>>;
      const map = Object.fromEntries(
        index
          .filter((entry) => entry.name && typeof entry.council_id === "number")
          .map((entry) => [entry.name as string, entry.council_id as number])
      );
      minutesMeetingCache.set(slug, map);
      return map;
    } catch {
      // try next
    }
  }

  minutesMeetingCache.set(slug, {});
  return {};
}

function scoreAiSource(source: AiSearchSource, query: string, tokenGroups: SearchTokenGroup[]): number {
  const haystack = [
    source.municipality,
    source.meeting_name,
    source.agenda_title ?? "",
    source.speaker_name ?? source.speaker,
    source.content,
  ].join(" ");
  let score = (source.similarity ?? 0) * 100;

  if (includesNormalized(haystack, query)) score += 12;
  if (source.agenda_title && includesNormalized(source.agenda_title, query)) score += 6;
  if (includesNormalized(source.meeting_name, query)) score += 4;

  for (const group of tokenGroups) {
    score += Math.round(bestGroupMatch(haystack, group, "includes") * 4);
    if (source.agenda_title) {
      score += Math.round(bestGroupMatch(source.agenda_title, group, "includes") * 6);
    }
    score += Math.round(bestGroupMatch(source.meeting_name, group, "includes") * 4);
  }

  return score;
}

function enrichAiSource(source: AiSearchSource): AiSearchSource {
  if (source.href) return source;
  const slug = source.slug ?? getCitySlugByName()[source.municipality];
  if (!slug) return source;

  const councilId = source.council_id ?? getMinutesMeetingMap(slug)[source.meeting_name];
  if (!councilId) return { ...source, slug };

  const hrefBase = `/${slug}/minutes/${councilId}`;
  const href =
    typeof source.schedule_id === "number" && typeof source.minute_id === "number"
      ? `${hrefBase}#minute-${source.schedule_id}-${source.minute_id}`
      : hrefBase;

  return { ...source, slug, council_id: councilId, href };
}

function selectAiSources(sources: AiSearchSource[], query: string, tokenGroups: SearchTokenGroup[]): AiSearchSource[] {
  const scored = sources
    .map((source) => {
      const enriched = enrichAiSource(source);
      return { source: enriched, score: scoreAiSource(enriched, query, tokenGroups) };
    })
    .sort((a, b) => b.score - a.score);

  const seenContents = new Set<string>();
  const selected: AiSearchSource[] = [];
  const meetingCounts = new Map<string, number>();

  const take = (maxPerMeeting: number) => {
    for (const entry of scored) {
      if (selected.length >= AI_SOURCE_COUNT) break;
      const meetingKey = `${entry.source.municipality}::${entry.source.meeting_name}`;
      const contentKey = normalizeForSearch(entry.source.content).slice(0, 180);
      if (seenContents.has(contentKey)) continue;
      if ((meetingCounts.get(meetingKey) ?? 0) >= maxPerMeeting) continue;
      seenContents.add(contentKey);
      meetingCounts.set(meetingKey, (meetingCounts.get(meetingKey) ?? 0) + 1);
      selected.push(entry.source);
    }
  };

  take(1);
  if (selected.length < AI_SOURCE_COUNT) take(2);
  return selected;
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

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  const ip = getClientIP(request);
  if (!checkSearchRateLimit(ip)) {
    return NextResponse.json(
      { error: "検索回数の上限に達しました。少し待ってから再度お試しください。", sessionResults: [], memberResults: [] },
      { status: 429 }
    );
  }

  const q = (request.nextUrl.searchParams.get("q") ?? "").slice(0, 500);
  const tokens = tokenize(q);
  const tokenGroups = buildTokenGroups(tokens);
  const expansionSummary = buildExpansionSummary(tokenGroups);
  const expandedTerms = Array.from(new Set([
    ...expansionSummary.exactTerms,
    ...expansionSummary.relatedTerms,
  ])).slice(0, 16);
  const searchSuggestions = buildQuerySuggestions(q, tokenGroups);

  if (!tokens.length) {
    return NextResponse.json({ sessionResults: [], memberResults: [] });
  }

  const dataRoot = path.join(process.cwd(), "data");
  const cityMap = getCityMap();
  const allCities = Object.keys(cityMap);
  const scoredSessionResults: Array<{ score: number; item: SessionHit }> = [];

  // -----------------------------------------------------------------------
  // 会議録・速報（sessions/ がある全市）
  // -----------------------------------------------------------------------
  for (const city of allCities) {
    const indexPath = path.join(dataRoot, city, "sessions", "index.json");
    if (!fs.existsSync(indexPath)) continue;
    const cityName = cityMap[city];
    let index: Array<{ id: string; has_summary?: boolean; segment_count?: number }>;
    try { index = JSON.parse(fs.readFileSync(indexPath, "utf-8")); } catch { continue; }
    for (const entry of index) {
      if (!entry.has_summary || (entry.segment_count ?? 0) === 0) continue;
      const fp = path.join(dataRoot, city, "sessions", `${entry.id}.json`);
      if (!fs.existsSync(fp)) continue;
      let s: Record<string, unknown>;
      try { s = JSON.parse(fs.readFileSync(fp, "utf-8")); } catch { continue; }
      const committee = (s.committee as string) ?? "";
      const sessionYear = yearFromDate(s.date as string | undefined);
      const segments = (s.segments as Array<Record<string, unknown>>) ?? [];
      let pushed = false;
      for (const seg of segments) {
        const fields = [
          { text: (seg.summary as string) ?? "", field: "要約" },
          { text: ((seg.topics as string[]) ?? []).join(" "), field: "トピック" },
          { text: (seg.transcript as string) ?? "", field: "全文" },
        ];
        for (const { text, field } of fields) {
          if (matchesAll(text, tokenGroups)) {
            const item: SessionHit = {
              id: s.id as string,
              city,
              cityName,
              sourceType: "session",
              title: s.title as string,
              committee,
              href: `/${city}/sessions/${s.id}`,
              segIndex: seg.index as number,
              label: (seg.label as string) ?? "",
              startTime: (seg.start_time as string) ?? "",
              context: excerpt(text, tokens),
              field,
              year: sessionYear,
            };
            scoredSessionResults.push({
              score: computeSessionScore({
                query: q,
                tokenGroups,
                title: item.title,
                committee: item.committee,
                label: item.label,
                context: item.context,
                field: item.field,
                sourceType: item.sourceType,
                year: item.year,
              }),
              item,
            });
            pushed = true;
            break;
          }
        }
        if (pushed) break;
      }
      if (!pushed && matchesAll((s.title as string) + committee, tokenGroups)) {
        const item: SessionHit = {
          id: s.id as string,
          city,
          cityName,
          sourceType: "session",
          title: s.title as string,
          committee,
          href: `/${city}/sessions/${s.id}`,
          segIndex: 0,
          label: "",
          startTime: "",
          context: committee,
          field: "会議名",
          year: sessionYear,
        };
        scoredSessionResults.push({
          score: computeSessionScore({
            query: q,
            tokenGroups,
            title: item.title,
            committee: item.committee,
            label: item.label,
            context: item.context,
            field: item.field,
            sourceType: item.sourceType,
            year: item.year,
          }),
          item,
        });
      }
    }
  }

  // -----------------------------------------------------------------------
  // 公式議事録（build 時生成の _search-index.json から議題単位で検索）
  // Vercel Function 250MB 制限の都合、議事録本文を Function に含められない
  // ため、scripts/build-search-index.mjs で生成した軽量 index を使う。
  // -----------------------------------------------------------------------
  const seenMinutes = new Set<string>();
  interface AgendaEntry {
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
    year?: string;
  }
  const searchIndexPath = path.join(dataRoot, "_search-index.json");
  if (fs.existsSync(searchIndexPath)) {
    let searchIndex: { agendas: AgendaEntry[] };
    try {
      searchIndex = JSON.parse(fs.readFileSync(searchIndexPath, "utf-8"));
    } catch {
      searchIndex = { agendas: [] };
    }
    for (const a of searchIndex.agendas) {
      const haystack = `${a.agenda_title} ${a.text}`;
      if (!matchesAll(haystack, tokenGroups)) continue;
      const minuteKey = `${a.city}_${a.council_id}`;
      const item: SessionHit = {
        id: `${a.city}_minutes_${a.council_id}_${a.schedule_index}_${a.first_minute_id ?? 0}`,
        city: a.city,
        cityName: a.cityName,
        sourceType: "minutes",
        title: a.council_name,
        committee: a.agenda_title || "議題",
        href:
          a.first_minute_id !== null
            ? `/${a.city}/minutes/${a.council_id}?q=${encodeURIComponent(q)}`
            : `/${a.city}/minutes/${a.council_id}`,
        segIndex: a.schedule_index,
        label: a.schedule_name,
        startTime: "",
        context: excerpt(haystack, tokens, 100),
        field: "議事録",
        year: a.year ?? yearFromCouncilName(a.council_name),
      };
      scoredSessionResults.push({
        score: computeSessionScore({
          query: q,
          tokenGroups,
          title: item.title,
          committee: item.committee,
          label: item.label,
          context: item.context,
          field: item.field,
          sourceType: item.sourceType,
          year: item.year,
        }),
        item,
      });
      seenMinutes.add(minuteKey);
    }
  }

  // -----------------------------------------------------------------------
  // enriched議事録（index.jsonがない市のenriched/のみ）
  // -----------------------------------------------------------------------
  interface EnrichedDoc {
    council_id: number;
    name: string;
    generated_at?: string;
    summary?: string;
    highlights?: string[];
    tags?: string[];
  }
  for (const city of allCities) {
    const enrichedDir = path.join(dataRoot, city, "minutes", "enriched");
    if (!fs.existsSync(enrichedDir)) continue;
    const cityName = cityMap[city];
    let files: string[];
    try { files = fs.readdirSync(enrichedDir).filter((f) => f.endsWith(".json")); }
    catch { continue; }
    for (const file of files) {
      const fp = path.join(enrichedDir, file);
      let doc: EnrichedDoc;
      try { doc = JSON.parse(fs.readFileSync(fp, "utf-8")) as EnrichedDoc; }
      catch { continue; }
      const minuteKey = `${city}_${doc.council_id}`;
      if (seenMinutes.has(minuteKey)) continue;
      const searchText = [
        doc.name,
        doc.summary ?? "",
        ...(doc.highlights ?? []),
        ...(doc.tags ?? []),
      ].join(" ");
      if (!matchesAll(searchText, tokenGroups)) continue;
      const contextText = doc.summary
        ? excerpt(doc.summary, tokens, 120)
        : (doc.highlights ?? []).slice(0, 2).join("、");
      const item: SessionHit = {
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
        year: yearFromDate(doc.generated_at) || yearFromCouncilName(doc.name),
      };
      scoredSessionResults.push({
        score: computeSessionScore({
          query: q,
          tokenGroups,
          title: item.title,
          committee: item.committee,
          label: item.label,
          context: item.context,
          field: item.field,
          sourceType: item.sourceType,
          year: item.year,
        }),
        item,
      });
      seenMinutes.add(minuteKey);
    }
  }

  // -----------------------------------------------------------------------
  // 議決結果（decisions.json がある全市）
  // -----------------------------------------------------------------------
  for (const city of allCities) {
    const decisionsPath = path.join(dataRoot, city, "decisions.json");
    if (!fs.existsSync(decisionsPath)) continue;
    const cityName = cityMap[city];
    let decisions: Array<{ session: string; source_url: string; description?: string }>;
    try { decisions = JSON.parse(fs.readFileSync(decisionsPath, "utf-8")); } catch { continue; }
    for (const d of decisions) {
      const text = [d.session, d.description ?? ""].join(" ");
      if (matchesAll(text, tokenGroups)) {
        const item: SessionHit = {
          id: `${city}_decision_${d.session}`,
          city,
          cityName,
          sourceType: "decision",
          title: d.session,
          committee: "議決結果",
          href: `/${city}/decisions`,
          segIndex: 0,
          label: "",
          startTime: "",
          context: excerpt(text, tokens),
          field: "議決",
          year: yearFromCouncilName(d.session),
        };
        scoredSessionResults.push({
          score: computeSessionScore({
            query: q,
            tokenGroups,
            title: item.title,
            committee: item.committee,
            label: item.label,
            context: item.context,
            field: item.field,
            sourceType: item.sourceType,
            year: item.year,
          }),
          item,
        });
      }
    }
  }

  // -----------------------------------------------------------------------
  // 議員検索（members.json がある全市）
  // -----------------------------------------------------------------------
  const scoredMemberResults: Array<{ score: number; item: MemberHit }> = [];
  for (const city of allCities) {
    const cityName = cityMap[city];
    const membersPath = path.join(dataRoot, city, "members.json");
    if (fs.existsSync(membersPath)) {
      let list: Array<Record<string, unknown>>;
      try { list = JSON.parse(fs.readFileSync(membersPath, "utf-8")); } catch { continue; }
      if (!Array.isArray(list)) continue;
      for (const m of list) {
        const committees = Array.isArray(m.committees) ? m.committees.filter((c): c is string => typeof c === "string") : [];
        const searchText = [m.name ?? "", m.furigana ?? "", m.party ?? "", m.faction ?? "", ...committees].join(" ");
        if (matchesAll(searchText, tokenGroups)) {
          const item: MemberHit = {
            city,
            cityName,
            href: `/${city}`,
            name: (m.name as string) ?? "",
            furigana: (m.furigana as string) ?? "",
            party: (m.party as string) ?? "",
            faction: (m.faction as string) ?? "",
            committees,
          };
          scoredMemberResults.push({
            score: computeMemberScore({
              query: q,
              tokenGroups,
              name: item.name,
              furigana: item.furigana,
              party: item.party,
              faction: item.faction,
              committees: item.committees,
            }),
            item,
          });
        }
      }
    } else {
      const electionPath = path.join(dataRoot, city, "election.json");
      if (!fs.existsSync(electionPath)) continue;
      let data: Record<string, unknown>;
      try { data = JSON.parse(fs.readFileSync(electionPath, "utf-8")); } catch { continue; }
      const candidates = (data.candidates as Array<Record<string, unknown>>) ?? [];
      for (const c of candidates) {
        if ((c.result as string) !== "当選") continue;
        const searchText = [c.name ?? "", c.furigana ?? "", c.party ?? ""].join(" ");
        if (matchesAll(searchText, tokenGroups)) {
          const item: MemberHit = {
            city,
            cityName,
            href: `/${city}`,
            name: (c.name as string) ?? "",
            furigana: (c.furigana as string) ?? "",
            party: (c.party as string) ?? "",
            faction: (c.party as string) ?? "",
            committees: [],
          };
          scoredMemberResults.push({
            score: computeMemberScore({
              query: q,
              tokenGroups,
              name: item.name,
              furigana: item.furigana,
              party: item.party,
              faction: item.faction,
              committees: item.committees,
            }),
            item,
          });
        }
      }
    }
  }

  const MAX_RESULTS = 200;
  const sessionResults = scoredSessionResults
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.item.year !== a.item.year) return (b.item.year || "").localeCompare(a.item.year || "");
      if (a.item.cityName !== b.item.cityName) return a.item.cityName.localeCompare(b.item.cityName, "ja");
      return a.item.title.localeCompare(b.item.title, "ja");
    })
    .map((entry) => entry.item);
  const memberResults = scoredMemberResults
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.item.cityName !== b.item.cityName) return a.item.cityName.localeCompare(b.item.cityName, "ja");
      return a.item.name.localeCompare(b.item.name, "ja");
    })
    .map((entry) => entry.item);

  return NextResponse.json({
    sessionResults: sessionResults.slice(0, MAX_RESULTS),
    memberResults: memberResults.slice(0, MAX_RESULTS),
    sessionTotal: sessionResults.length,
    memberTotal: memberResults.length,
    truncated: sessionResults.length > MAX_RESULTS || memberResults.length > MAX_RESULTS,
    expandedTerms,
    exactExpandedTerms: expansionSummary.exactTerms.slice(0, 12),
    relatedExpandedTerms: expansionSummary.relatedTerms.slice(0, 12),
    searchSuggestions,
  });
}

// ---------------------------------------------------------------------------
// POST handler — AI 検索
// 議事録 embeddings (Supabase pgvector) を Gemini で埋め込んだクエリと照合し、
// 上位 5 件を Groq llama-3.3-70b-versatile に渡して根拠付き回答を生成する。
// ---------------------------------------------------------------------------
export type AiSearchSource = {
  id?: number;
  municipality: string;
  slug?: string;
  meeting_name: string;
  council_id?: number;
  schedule_id?: number;
  minute_id?: number;
  speaker: string;
  speaker_name?: string;
  speaker_role?: string;
  agenda_title?: string;
  content: string;
  similarity: number;
  href?: string;
};

export type AiSearchResponse = {
  answer: string;
  sources: AiSearchSource[];
};

const AI_MAX_QUERY_LEN = 500;
const AI_RPC_MATCH_COUNT = 12;
const AI_SOURCE_COUNT = 6;

export async function POST(request: NextRequest) {
  const ip = getClientIP(request);
  if (!checkSearchRateLimit(ip)) {
    return NextResponse.json(
      { error: "検索回数の上限に達しました。少し待ってから再度お試しください。" },
      { status: 429 }
    );
  }

  let body: { query?: string; municipality?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "リクエストの形式が不正です。" }, { status: 400 });
  }

  const query = (body.query ?? "").trim().slice(0, AI_MAX_QUERY_LEN);
  const municipality = (body.municipality ?? "").trim() || null;
  if (!query) {
    return NextResponse.json({ error: "質問を入力してください。" }, { status: 400 });
  }
  const tokenGroups = buildTokenGroups(tokenize(query));

  const {
    GEMINI_API_KEY,
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    GROQ_API_KEY,
  } = process.env;
  if (!GEMINI_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !GROQ_API_KEY) {
    return NextResponse.json(
      { error: "AI検索の環境変数が未設定です。" },
      { status: 500 }
    );
  }

  // 1) クエリの埋め込み
  let queryEmbedding: number[] | null = null;
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "models/gemini-embedding-001",
          content: { parts: [{ text: query }] },
          taskType: "RETRIEVAL_QUERY",
          outputDimensionality: 768,
        }),
      }
    );
    if (!r.ok) {
      return NextResponse.json(
        { error: `Gemini embedding error: ${r.status}` },
        { status: 502 }
      );
    }
    const j = (await r.json()) as { embedding?: { values?: number[] } };
    queryEmbedding = j.embedding?.values ?? null;
  } catch (e) {
    return NextResponse.json(
      { error: `Gemini呼び出しに失敗しました: ${(e as Error).message}` },
      { status: 502 }
    );
  }
  if (!queryEmbedding || queryEmbedding.length === 0) {
    return NextResponse.json({ error: "クエリの埋め込みに失敗しました。" }, { status: 502 });
  }

  // 2) Supabase pgvector で類似検索
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const { data: matches, error: rpcErr } = await sb.rpc("match_council_chunks", {
    query_embedding: queryEmbedding,
    match_count: AI_RPC_MATCH_COUNT,
    filter_municipality: municipality,
  });
  if (rpcErr) {
    return NextResponse.json(
      { error: `Supabase検索エラー: ${rpcErr.message}` },
      { status: 500 }
    );
  }
  const sources = selectAiSources((matches as AiSearchSource[] | null) ?? [], query, tokenGroups);

  // 3) Groq で根拠付き回答を生成
  if (sources.length === 0) {
    return NextResponse.json({
      answer: "関連する議事録が見つかりませんでした。",
      sources: [],
    } satisfies AiSearchResponse);
  }

  const contextBlock = sources
    .map(
      (s, i) =>
        `[${i + 1}] ${s.municipality} ${s.meeting_name}${s.agenda_title ? `／${s.agenda_title}` : ""}${(s.speaker_name ?? s.speaker) ? `／${s.speaker_name ?? s.speaker}` : ""}\n${s.content}`
    )
    .join("\n\n");

  const userPrompt = `以下は北海道の地方議会の議事録抜粋です。これを根拠として、市民の質問に日本語で答えてください。

ルール:
- 抜粋に書かれていない事柄は推測しないこと
- 不明な場合は「議事録から確認できませんでした」と答えること
- 回答末尾で根拠とした抜粋番号を [1] [2] のように明記すること

【参考議事録】
${contextBlock}

【質問】
${query}`;

  let answer = "";
  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          {
            role: "system",
            content:
              "あなたは地方議会の議事録に基づいて市民の質問に答えるアシスタントです。提示された抜粋以外の知識で回答してはいけません。",
          },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
      }),
    });
    if (!r.ok) {
      return NextResponse.json(
        { error: `Groqエラー: ${r.status}` },
        { status: 502 }
      );
    }
    const j = (await r.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    answer = j.choices?.[0]?.message?.content ?? "";
  } catch (e) {
    return NextResponse.json(
      { error: `Groq呼び出しに失敗しました: ${(e as Error).message}` },
      { status: 502 }
    );
  }

  return NextResponse.json({ answer, sources } satisfies AiSearchResponse);
}
