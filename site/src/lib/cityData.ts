import fs from "fs";
import path from "path";
import type { Decision } from "@/types/decision";
import type { Member } from "@/types/member";
import type { MinutesEnriched, MinutesIndexItem } from "@/types/minutes";
import type { Session, SessionSummary } from "@/types/session";

type SearchIndexAgenda = {
  city: string;
  cityName: string;
  council_id: number;
  council_name: string;
  year?: string;
  schedule_index: number;
  schedule_name: string;
  agenda_title: string;
  first_minute_id: number | null;
  text: string;
  truncated: boolean;
};

type SearchIndex = {
  version?: number;
  generated_at?: string;
  excerpt_max?: number;
  count?: number;
  agendas: SearchIndexAgenda[];
};

function getDataRoots(): string[] {
  const cwd = process.cwd();
  return [path.join(/*turbopackIgnore: true*/ cwd, "data")]
    .filter((value, index, list) => list.indexOf(value) === index)
    .filter((value) => fs.existsSync(/*turbopackIgnore: true*/ value));
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    return JSON.parse(
      fs.readFileSync(/*turbopackIgnore: true*/ filePath, "utf-8")
    ) as T;
  } catch {
    return null;
  }
}

function findCityFile(city: string, relativePath: string): string | null {
  for (const root of getDataRoots()) {
    const candidate = path.join(/*turbopackIgnore: true*/ root, city, relativePath);
    if (fs.existsSync(/*turbopackIgnore: true*/ candidate)) return candidate;
  }
  return null;
}

function listCityFiles(city: string, relativeDir: string): string[] {
  for (const root of getDataRoots()) {
    const targetDir = path.join(/*turbopackIgnore: true*/ root, city, relativeDir);
    if (!fs.existsSync(/*turbopackIgnore: true*/ targetDir)) continue;
    try {
      return fs
        .readdirSync(/*turbopackIgnore: true*/ targetDir)
        .filter((name) => name.endsWith(".json"))
        .map((name) => path.join(/*turbopackIgnore: true*/ targetDir, name));
    } catch {
      return [];
    }
  }
  return [];
}

export function readCityJson<T>(city: string, relativePath: string): T | null {
  const target = findCityFile(city, relativePath);
  if (!target) return null;
  return readJsonFile<T>(target);
}

export function getSessionSummaries(city: string): SessionSummary[] {
  return readCityJson<SessionSummary[]>(city, "sessions/index.json") ?? [];
}

export function getSession(city: string, id: string): Session | null {
  return readCityJson<Session>(city, `sessions/${id}.json`);
}

export function getMembers(city: string): Member[] {
  return readCityJson<Member[]>(city, "members.json") ?? [];
}

export function getDecisions(city: string): Decision[] {
  return readCityJson<Decision[]>(city, "decisions.json") ?? [];
}

export function getMinutesIndex(city: string): MinutesIndexItem[] {
  const minutesIndexPath = findCityFile(city, "minutes/index.json");
  if (minutesIndexPath) {
    const index = readJsonFile<MinutesIndexItem[]>(minutesIndexPath);
    return Array.isArray(index) ? index : [];
  }

  const legacyIndex = readCityJson<MinutesIndexItem[]>(city, "index.json");
  return Array.isArray(legacyIndex) ? legacyIndex : [];
}

export function getMinutesEnrichedDocs(city: string): MinutesEnriched[] {
  const publishedCouncilIds = new Set(
    getMinutesIndex(city).map((entry) => String(entry.council_id))
  );
  if (publishedCouncilIds.size === 0) return [];

  return listCityFiles(city, "minutes/enriched")
    .map((filePath) => readJsonFile<MinutesEnriched>(filePath))
    .filter((doc): doc is MinutesEnriched =>
      Boolean(doc) && publishedCouncilIds.has(String(doc?.council_id))
    );
}

export function getSearchIndex(): SearchIndex {
  for (const root of getDataRoots()) {
    const candidate = path.join(/*turbopackIgnore: true*/ root, "_search-index.json");
    if (!fs.existsSync(/*turbopackIgnore: true*/ candidate)) continue;
    const parsed = readJsonFile<SearchIndex>(candidate);
    if (parsed?.agendas && Array.isArray(parsed.agendas)) {
      return parsed;
    }
  }
  return { agendas: [] };
}
