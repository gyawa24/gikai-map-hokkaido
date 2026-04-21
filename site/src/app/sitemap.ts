import fs from "fs";
import path from "path";
import type { MetadataRoute } from "next";

const BASE_URL = "https://chihougikai.com";

interface MinutesIndexItem {
  council_id: number;
}

interface Member {
  seat_number: number;
}

interface SessionSummary {
  id: string;
}

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

function getMinutesIds(city: string): number[] {
  const cwd = process.cwd();
  // Try minutes/ subdir first (chitose, eniwa, tomakomai), then direct (asahikawa, hakodate, muroran, kushiro)
  const minutesPath = path.join(cwd, "data", city, "minutes", "index.json");
  const directPath = path.join(cwd, "data", city, "index.json");
  const data =
    readJson<MinutesIndexItem[]>(minutesPath) ??
    readJson<MinutesIndexItem[]>(directPath);
  return data ? data.map((item) => item.council_id) : [];
}

function getMemberIds(city: string): number[] {
  const fp = path.join(process.cwd(), "data", city, "members.json");
  const data = readJson<Member[]>(fp);
  return data ? data.map((m) => m.seat_number) : [];
}

function getSessionIds(city: string): string[] {
  const sessionsDir = path.join(process.cwd(), "data", city, "sessions");
  try {
    const files = fs.readdirSync(sessionsDir);
    return files
      .filter((f) => f !== "index.json" && f.endsWith(".json"))
      .map((f) => f.replace(".json", ""));
  } catch {
    return [];
  }
}

function hasFile(city: string, file: string): boolean {
  const fp = path.join(process.cwd(), "data", city, file);
  return fs.existsSync(fp);
}

// Cities with full feature set (members, minutes, decisions, etc.)
const FULL_CITIES = ["chitose", "eniwa", "tomakomai"] as const;

// Cities with minutes only (no members page)
const MINUTES_ONLY_CITIES = [
  "asahikawa",
  "hakodate",
  "muroran",
  "kushiro",
  "wakkanai",
  "kitami",
  "obihiro",
  "nayoro",
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [];

  // ── Static pages ──────────────────────────────────────────────────────────
  entries.push(
    { url: BASE_URL, lastModified: new Date(), changeFrequency: "daily", priority: 1.0 },
    { url: `${BASE_URL}/search`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.6 },
    { url: `${BASE_URL}/map`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE_URL}/decisions`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.5 },
    { url: `${BASE_URL}/schedule`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.5 },
    { url: `${BASE_URL}/newsletter`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.5 }
  );

  // ── Full-feature cities (chitose, eniwa, tomakomai) ───────────────────────
  for (const city of FULL_CITIES) {
    // City top (members list)
    entries.push({
      url: `${BASE_URL}/${city}`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.9,
    });

    // Member detail pages
    const memberIds = getMemberIds(city);
    for (const id of memberIds) {
      entries.push({
        url: `${BASE_URL}/${city}/members/${id}`,
        lastModified: new Date(),
        changeFrequency: "monthly",
        priority: 0.7,
      });
    }

    // Minutes list
    entries.push({
      url: `${BASE_URL}/${city}/minutes`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.8,
    });

    // Minutes detail pages
    const minutesIds = getMinutesIds(city);
    for (const id of minutesIds) {
      entries.push({
        url: `${BASE_URL}/${city}/minutes/${id}`,
        lastModified: new Date(),
        changeFrequency: "weekly",
        priority: 0.7,
      });
    }

    // Optional pages (decisions, schedule, newsletter)
    if (hasFile(city, "decisions.json")) {
      entries.push({
        url: `${BASE_URL}/${city}/decisions`,
        lastModified: new Date(),
        changeFrequency: "weekly",
        priority: 0.7,
      });
    }
    if (hasFile(city, "schedule.json")) {
      entries.push({
        url: `${BASE_URL}/${city}/schedule`,
        lastModified: new Date(),
        changeFrequency: "weekly",
        priority: 0.7,
      });
    }
    if (hasFile(city, "newsletter.json")) {
      entries.push({
        url: `${BASE_URL}/${city}/newsletter`,
        lastModified: new Date(),
        changeFrequency: "monthly",
        priority: 0.6,
      });
    }
  }

  // ── Chitose-specific: sessions ─────────────────────────────────────────────
  const sessionIds = getSessionIds("chitose");
  if (sessionIds.length > 0) {
    entries.push({
      url: `${BASE_URL}/chitose/sessions`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.8,
    });
    for (const id of sessionIds) {
      entries.push({
        url: `${BASE_URL}/chitose/sessions/${id}`,
        lastModified: new Date(),
        changeFrequency: "weekly",
        priority: 0.7,
      });
    }
  }

  // ── Minutes-only cities ────────────────────────────────────────────────────
  for (const city of MINUTES_ONLY_CITIES) {
    // City top
    entries.push({
      url: `${BASE_URL}/${city}`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.8,
    });

    // Minutes list
    entries.push({
      url: `${BASE_URL}/${city}/minutes`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.8,
    });

    // Minutes detail pages
    const minutesIds = getMinutesIds(city);
    for (const id of minutesIds) {
      entries.push({
        url: `${BASE_URL}/${city}/minutes/${id}`,
        lastModified: new Date(),
        changeFrequency: "weekly",
        priority: 0.7,
      });
    }
  }

  return entries;
}
