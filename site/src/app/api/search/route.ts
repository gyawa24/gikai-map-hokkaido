import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import type { MinutesIndexItem, MinutesSession } from "@/types/minutes";
import { getMunicipalities } from "@/lib/municipalities";

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

function matchesAll(text: string, tokens: string[]): boolean {
  const lower = text.toLowerCase();
  return tokens.every((t) => lower.includes(t.toLowerCase()));
}

function excerpt(text: string, tokens: string[], radius = 60): string {
  const first = tokens[0] ?? "";
  const idx = text.toLowerCase().indexOf(first.toLowerCase());
  if (idx === -1) return text.slice(0, radius * 2);
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + first.length + radius);
  return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
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

  if (!tokens.length) {
    return NextResponse.json({ sessionResults: [], memberResults: [] });
  }

  const dataRoot = path.join(process.cwd(), "data");
  const cityMap = getCityMap();
  const allCities = Object.keys(cityMap);
  const sessionResults: SessionHit[] = [];

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
      const segments = (s.segments as Array<Record<string, unknown>>) ?? [];
      let pushed = false;
      for (const seg of segments) {
        const fields = [
          { text: (seg.summary as string) ?? "", field: "要約" },
          { text: ((seg.topics as string[]) ?? []).join(" "), field: "トピック" },
          { text: (seg.transcript as string) ?? "", field: "全文" },
        ];
        for (const { text, field } of fields) {
          if (matchesAll(text, tokens)) {
            sessionResults.push({
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
            });
            pushed = true;
            break;
          }
        }
        if (pushed) break;
      }
      if (!pushed && matchesAll((s.title as string) + committee, tokens)) {
        sessionResults.push({
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
        });
      }
    }
  }

  // -----------------------------------------------------------------------
  // 公式議事録（minutes/index.json がある全市）
  // -----------------------------------------------------------------------
  const seenMinutes = new Set<string>();
  for (const city of allCities) {
    const indexPath = path.join(dataRoot, city, "minutes", "index.json");
    if (!fs.existsSync(indexPath)) continue;
    const cityName = cityMap[city];
    let index: MinutesIndexItem[];
    try { index = JSON.parse(fs.readFileSync(indexPath, "utf-8")); } catch { continue; }
    for (const entry of index) {
      const fp = path.join(dataRoot, city, "minutes", entry.file);
      if (!fs.existsSync(fp)) continue;
      let s: MinutesSession;
      try { s = JSON.parse(fs.readFileSync(fp, "utf-8")); } catch { continue; }
      const committee = entry.type_label.split(">").pop()?.trim() ?? "";
      const minuteKey = `${city}_${s.council_id}`;
      let pushed = false;
      for (let i = 0; i < s.schedules.length; i++) {
        const sch = s.schedules[i];
        const text = sch.minutes
          .filter((m) => m.minute_type !== "名簿")
          .map((m) => `${m.title} ${m.text}`)
          .join("\n");
        if (matchesAll(text, tokens)) {
          sessionResults.push({
            id: `${city}_minutes_${s.council_id}`,
            city,
            cityName,
            sourceType: "minutes",
            title: s.name,
            committee,
            href: `/${city}/minutes/${s.council_id}`,
            segIndex: i,
            label: sch.name,
            startTime: "",
            context: excerpt(text, tokens),
            field: "議事録",
          });
          seenMinutes.add(minuteKey);
          pushed = true;
          break;
        }
      }
      if (!pushed && matchesAll(s.name + committee, tokens)) {
        sessionResults.push({
          id: `${city}_minutes_${s.council_id}`,
          city,
          cityName,
          sourceType: "minutes",
          title: s.name,
          committee,
          href: `/${city}/minutes/${s.council_id}`,
          segIndex: 0,
          label: "",
          startTime: "",
          context: committee,
          field: "会議名",
        });
        seenMinutes.add(minuteKey);
      }
    }
  }

  // -----------------------------------------------------------------------
  // enriched議事録（index.jsonがない市のenriched/のみ）
  // -----------------------------------------------------------------------
  interface EnrichedDoc {
    council_id: number;
    name: string;
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
      if (!matchesAll(searchText, tokens)) continue;
      const contextText = doc.summary
        ? excerpt(doc.summary, tokens, 120)
        : (doc.highlights ?? []).slice(0, 2).join("、");
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
      if (matchesAll(text, tokens)) {
        sessionResults.push({
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
        });
      }
    }
  }

  // -----------------------------------------------------------------------
  // 議員検索（members.json がある全市）
  // -----------------------------------------------------------------------
  const memberResults: MemberHit[] = [];
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
        if (matchesAll(searchText, tokens)) {
          memberResults.push({
            city,
            cityName,
            href: `/${city}`,
            name: (m.name as string) ?? "",
            furigana: (m.furigana as string) ?? "",
            party: (m.party as string) ?? "",
            faction: (m.faction as string) ?? "",
            committees,
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
        if (matchesAll(searchText, tokens)) {
          memberResults.push({
            city,
            cityName,
            href: `/${city}`,
            name: (c.name as string) ?? "",
            furigana: (c.furigana as string) ?? "",
            party: (c.party as string) ?? "",
            faction: (c.party as string) ?? "",
            committees: [],
          });
        }
      }
    }
  }

  return NextResponse.json({ sessionResults: sessionResults.slice(0, 50), memberResults: memberResults.slice(0, 50) });
}
