import type { Municipality } from "@/lib/municipalities";
import type { MinuteItem, MinuteSchedule, MinutesSession } from "@/types/minutes";

export type MinutesSource = {
  url: string;
  label: string;
  scope: "document" | "catalog";
};

export function safeMinutesSourceUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function getMinutesCatalogSource(municipality: Municipality | null): MinutesSource | null {
  if (!municipality) return null;
  let url = safeMinutesSourceUrl(municipality.minutes_official_url);
  if (!url && municipality.system === "dnp" && municipality.tenant_id != null) {
    url = `https://ssp.kaigiroku.net/tenant/${municipality.slug}/MinuteBrowse.html`;
  }
  if (!url && municipality.system === "gijiroku_com") {
    const subdomain = municipality.gijiroku_subdomain ?? municipality.slug;
    if (/^[a-z0-9-]+$/u.test(subdomain)) url = `https://${subdomain}.gijiroku.com/voices/`;
  }
  return url ? { url, label: "公式会議録の一覧・検索", scope: "catalog" } : null;
}

export function getMinutesSource({
  item, schedule, session, fallback,
}: {
  item?: MinuteItem;
  schedule?: MinuteSchedule;
  session?: MinutesSession;
  fallback?: MinutesSource | null;
}): MinutesSource | null {
  for (const value of [item?.source_url, schedule?.source_url, session?.source_url]) {
    const url = safeMinutesSourceUrl(value);
    if (url) return { url, label: "この資料の公式原典", scope: "document" };
  }
  const documentUrls = [...new Set((schedule?.minutes ?? [])
    .map((minute) => safeMinutesSourceUrl(minute.source_url)).filter(Boolean))];
  if (documentUrls.length === 1) {
    return { url: documentUrls[0]!, label: "この資料の公式原典", scope: "document" };
  }
  return fallback ?? null;
}

export function buildMinutesCitation({
  item, cityName, councilName, scheduleName, source, permalink,
}: {
  item: MinuteItem;
  cityName: string;
  councilName: string;
  scheduleName: string;
  source?: MinutesSource | null;
  permalink: string;
}): string {
  const sourceLine = source
    ? `${source.scope === "document" ? "公式原典" : "公式会議録の一覧・検索"}: ${source.url}\n`
    : "公式原典URL: 未確認\n";
  return `${item.title}（${cityName}議会 ${councilName} ${scheduleName}）\n\n${item.text}\n\n${sourceLine}掲載ページ: ${permalink}`;
}
