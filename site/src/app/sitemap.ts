import fs from "fs";
import path from "path";
import type { MetadataRoute } from "next";
import { getMunicipalities } from "@/lib/municipalities";
import { getAllTags } from "@/lib/topics";
import { getArticles } from "@/lib/articles";

const BASE_URL = "https://chihougikai.com";

interface MinutesIndexItem {
  council_id: number;
}

interface Member {
  seat_number: number;
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
  const minutesPath = path.join(/*turbopackIgnore: true*/ cwd, "data", city, "minutes", "index.json");
  const directPath = path.join(/*turbopackIgnore: true*/ cwd, "data", city, "index.json");
  const data =
    readJson<MinutesIndexItem[]>(minutesPath) ??
    readJson<MinutesIndexItem[]>(directPath);
  return data ? data.map((item) => item.council_id) : [];
}

function getMemberIds(city: string): number[] {
  const fp = path.join(/*turbopackIgnore: true*/ process.cwd(), "data", city, "members.json");
  const data = readJson<Member[]>(fp);
  return data ? data.map((member) => member.seat_number) : [];
}

function getSessionIds(city: string): string[] {
  const sessionsDir = path.join(/*turbopackIgnore: true*/ process.cwd(), "data", city, "sessions");
  try {
    return fs.readdirSync(sessionsDir)
      .filter((file) => file !== "index.json" && file.endsWith(".json"))
      .map((file) => file.replace(/\.json$/, ""));
  } catch {
    return [];
  }
}

function toEntry(
  route: string,
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"],
  priority: number
): MetadataRoute.Sitemap[number] {
  return {
    url: `${BASE_URL}${route}`,
    lastModified: new Date(),
    changeFrequency,
    priority,
  };
}

export default function sitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [
    toEntry("/", "daily", 1.0),
    toEntry("/search", "weekly", 0.9),
    toEntry("/topics", "weekly", 0.8),
    toEntry("/articles", "weekly", 0.7),
    toEntry("/news", "weekly", 0.6),
    toEntry("/sources", "weekly", 0.6),
    toEntry("/decisions", "weekly", 0.5),
    toEntry("/schedule", "weekly", 0.5),
    toEntry("/newsletter", "weekly", 0.5),
    toEntry("/privacy", "yearly", 0.3),
    toEntry("/terms", "yearly", 0.3),
  ];

  for (const { tag } of getAllTags()) {
    entries.push(toEntry(`/topics/${encodeURIComponent(tag)}`, "weekly", 0.6));
  }

  for (const article of getArticles()) {
    entries.push(toEntry(`/articles/${article.slug}`, "monthly", 0.6));
  }

  for (const municipality of getMunicipalities().filter((item) => item.active)) {
    const city = municipality.slug;
    const featureSet = new Set(municipality.features);

    entries.push(toEntry(`/${city}`, "weekly", municipality.level === "prefecture" ? 0.8 : 0.9));

    if (featureSet.has("minutes")) {
      entries.push(toEntry(`/${city}/minutes`, "weekly", 0.8));
      for (const id of getMinutesIds(city)) {
        entries.push(toEntry(`/${city}/minutes/${id}`, "weekly", 0.7));
      }
    }

    if (featureSet.has("members")) {
      for (const id of getMemberIds(city)) {
        entries.push(toEntry(`/${city}/members/${id}`, "monthly", 0.7));
      }
    }

    if (featureSet.has("sessions")) {
      entries.push(toEntry(`/${city}/sessions`, "weekly", 0.7));
      for (const id of getSessionIds(city)) {
        entries.push(toEntry(`/${city}/sessions/${id}`, "weekly", 0.7));
      }
    }

    if (featureSet.has("decisions")) entries.push(toEntry(`/${city}/decisions`, "weekly", 0.7));
    if (featureSet.has("schedule")) entries.push(toEntry(`/${city}/schedule`, "weekly", 0.6));
    if (featureSet.has("newsletter")) entries.push(toEntry(`/${city}/newsletter`, "monthly", 0.6));
    if (featureSet.has("election")) entries.push(toEntry(`/${city}/election`, "monthly", 0.6));
    if (featureSet.has("plan")) entries.push(toEntry(`/${city}/plan`, "monthly", 0.5));
    if (featureSet.has("themes")) entries.push(toEntry(`/${city}/themes`, "weekly", 0.6));
  }

  return entries;
}
