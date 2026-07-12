import fs from "node:fs";
import path from "node:path";
import type { MetadataRoute } from "next";
import { getMunicipalities } from "@/lib/municipalities";
import { getCityCapability } from "@/lib/cityCapabilities";
import { getCitizenTopics } from "@/lib/topics";
import { slugForTag } from "@/lib/topicAliases";
import { getArticles } from "@/lib/articles";
import { getBudgetDocuments } from "@/lib/budgets";
import type { Member } from "@/types/member";
import type { MinutesIndexItem } from "@/types/minutes";
import type { SessionSummary } from "@/types/session";

const BASE_URL = "https://chihougikai.com";

function toEntry(
  route: string,
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"],
  priority: number,
  lastModified: Date | string = new Date()
): MetadataRoute.Sitemap[number] {
  return {
    url: `${BASE_URL}${route}`,
    lastModified,
    changeFrequency,
    priority,
  };
}

function readDataArray<T>(...segments: string[]): T[] {
  try {
    const fp = path.join(/*turbopackIgnore: true*/ process.cwd(), "data", ...segments);
    const value = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ fp, "utf-8"));
    return Array.isArray(value) ? (value as T[]) : [];
  } catch {
    return [];
  }
}

function readMinutesIndex(city: string): MinutesIndexItem[] {
  const nested = readDataArray<MinutesIndexItem>(city, "minutes", "index.json");
  return nested.length > 0 ? nested : readDataArray<MinutesIndexItem>(city, "index.json");
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    toEntry("/", "daily", 1.0),
    toEntry("/search", "weekly", 0.9),
    toEntry("/about", "monthly", 0.8),
    toEntry("/topics", "weekly", 0.8),
    toEntry("/articles", "weekly", 0.7),
    toEntry("/news", "weekly", 0.6),
    toEntry("/sources", "weekly", 0.6),
    toEntry("/methodology", "monthly", 0.5),
    toEntry("/privacy", "yearly", 0.3),
    toEntry("/terms", "yearly", 0.3),
  ];

  for (const { tag } of getCitizenTopics()) {
    entries.push(toEntry(`/topics/${slugForTag(tag)}`, "weekly", 0.6));
  }

  for (const article of await getArticles()) {
    entries.push(toEntry(`/articles/${article.slug}`, "monthly", 0.6, article.date));
  }

  for (const municipality of getMunicipalities().filter((item) => item.active)) {
    const city = municipality.slug;
    const capabilities = getCityCapability(city).capabilities;

    entries.push(toEntry(`/${city}`, "weekly", municipality.level === "prefecture" ? 0.8 : 0.9));

    for (const member of readDataArray<Member>(city, "members.json")) {
      if (member.seat_number > 0) {
        entries.push(toEntry(`/${city}/members/${member.seat_number}`, "monthly", 0.6));
      }
    }

    if (capabilities.minutes) {
      entries.push(toEntry(`/${city}/minutes`, "weekly", 0.8));
      if (municipality.minutes_access !== "restricted") {
        for (const minutes of readMinutesIndex(city)) {
          entries.push(toEntry(`/${city}/minutes/${minutes.council_id}`, "monthly", 0.6));
        }
      }
    }

    if (capabilities.sessions) {
      entries.push(toEntry(`/${city}/sessions`, "weekly", 0.7));
      for (const session of readDataArray<SessionSummary>(city, "sessions", "index.json")) {
        entries.push(toEntry(`/${city}/sessions/${session.id}`, "weekly", 0.7, session.date));
      }
    }

    if (capabilities.decisions) entries.push(toEntry(`/${city}/decisions`, "weekly", 0.7));
    if (capabilities.schedule) entries.push(toEntry(`/${city}/schedule`, "weekly", 0.6));
    if (capabilities.newsletter) entries.push(toEntry(`/${city}/newsletter`, "monthly", 0.6));
    const budgetDocuments = getBudgetDocuments(city);
    if (budgetDocuments.length > 0) {
      entries.push(toEntry(`/${city}/budgets`, "monthly", 0.5));
      for (const document of budgetDocuments) {
        entries.push(toEntry(`/${city}/budgets/${document.year}`, "monthly", 0.5, document.generated_at));
      }
    }
    if (capabilities.election) entries.push(toEntry(`/${city}/election`, "monthly", 0.6));
    if (capabilities.plan) entries.push(toEntry(`/${city}/plan`, "monthly", 0.5));
    if (capabilities.themes) entries.push(toEntry(`/${city}/themes`, "weekly", 0.6));
  }

  return entries;
}
