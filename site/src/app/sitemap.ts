import type { MetadataRoute } from "next";
import { getMunicipalities } from "@/lib/municipalities";
import { getCityCapability } from "@/lib/cityCapabilities";
import { getAllTags } from "@/lib/topics";
import { getArticles } from "@/lib/articles";
import { getBudgetDocuments } from "@/lib/budgets";

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

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
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

  for (const article of await getArticles()) {
    entries.push(toEntry(`/articles/${article.slug}`, "monthly", 0.6, article.date));
  }

  for (const municipality of getMunicipalities().filter((item) => item.active)) {
    const city = municipality.slug;
    const capabilities = getCityCapability(city).capabilities;

    entries.push(toEntry(`/${city}`, "weekly", municipality.level === "prefecture" ? 0.8 : 0.9));

    if (capabilities.minutes) {
      entries.push(toEntry(`/${city}/minutes`, "weekly", 0.8));
    }

    if (capabilities.sessions) {
      entries.push(toEntry(`/${city}/sessions`, "weekly", 0.7));
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
