import fs from "node:fs";
import path from "node:path";
import { getAvailableCityCapabilityKeys, getCityCapability } from "@/lib/cityCapabilities";
import type { Municipality } from "@/lib/municipalities";
import { getMunicipalities } from "@/lib/municipalities";

const OCR_WAIT = new Set(["shosanbetsu", "yubetsu"]);

const ALT_FEATURE_LABELS = new Map([
  ["nakashibetsu", "一般質問・委員会代表質問PDF"],
  ["sarufutsu", "一般質問PDF"],
  ["kaminokuni", "一般質問の質問・答弁要旨"],
  ["toma", "一般質問と答弁"],
  ["minamifurano", "会議結果・一般質問"],
  ["shinshinotsu", "議決結果・一般質問"],
  ["aibetsu", "一般質問動画"],
  ["omu", "一般質問単位の議事録"],
  ["saroma", "令和2年までの古い会議録"],
  ["takinoue", "会議結果・議会広報・瓦版"],
  ["teshio", "議会だより・視察研修報告書"],
  ["kenbuchi", "議会だより・YouTube配信・議会情報"],
  ["rusutsu", "議事日程・議決結果・議会活動"],
  ["iwanai", "議事日程・議会だより・一般質問順序表"],
]);

type BudgetSourceStatus = "取込済み" | "取得候補";

type BudgetSource = {
  slug: string;
  year: string;
  status: BudgetSourceStatus;
  source_label: string;
  source_href: string;
  note: string;
};

export type BudgetEnterpriseCoverage = {
  waterSewer: boolean;
  hospital: boolean;
  other: boolean;
  labels: string[];
};

export type PublicInventoryRow = {
  slug: string;
  name: string;
  councilName: string;
  region: string;
  hasMembers: boolean;
  hasMinutes: boolean;
  hasTopicData: boolean;
  hasSessionsData: boolean;
  otherInfo: string[];
  recordState: string;
  sourceLabel: string;
  sourceHref: string | null;
  sourceNote: string;
  verifiedAt: string | null;
  hasBudget: boolean;
  hasBudgetCandidate: boolean;
  budgetState: BudgetSourceStatus | "未確認";
  budgetYear: string | null;
  budgetSourceLabel: string | null;
  budgetSourceHref: string | null;
  budgetSourceNote: string | null;
  budgetEnterpriseCoverage: BudgetEnterpriseCoverage | null;
};

export type PublicInventorySummary = {
  total: number;
  members: number;
  minutes: number;
  themes: number;
  budgets: number;
  budgetCandidates: number;
  sessionsData: number;
  unavailable: number;
  ocrWait: number;
  altFeature: number;
};

function exists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

function readBudgetEnterpriseCoverage(cityDir: string, year: string | null): BudgetEnterpriseCoverage | null {
  if (!year) return null;

  const manifestPath = path.join(/*turbopackIgnore: true*/ cityDir, "budgets", year, "manifest.json");
  if (!exists(manifestPath)) return null;

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      pages?: { toc_label?: string | null; title?: string; preview?: string }[];
    };
    const labels = new Set<string>();

    for (const page of manifest.pages ?? []) {
      const label = page.toc_label ?? "";

      if (/水道|下水道|工業用水道/.test(label)) labels.add("上下水道");
      if (/病院/.test(label)) labels.add("病院");
      if (/市場|卸売市場|交通|高速電車|軌道整備|港湾整備|空港|駐車場|動物園|企業会計/.test(label)) {
        labels.add("その他");
      }
    }

    return {
      waterSewer: labels.has("上下水道"),
      hospital: labels.has("病院"),
      other: labels.has("その他"),
      labels: Array.from(labels),
    };
  } catch {
    return null;
  }
}

function getBudgetSources(dataRoot: string): Map<string, BudgetSource> {
  const filePath = path.join(/*turbopackIgnore: true*/ dataRoot, "budget_sources.json");
  if (!exists(filePath)) return new Map();

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as BudgetSource[];
    return new Map(parsed.map((source) => [source.slug, source]));
  } catch {
    return new Map();
  }
}

function sourceFor(entry: Municipality, hasMinutes: boolean): {
  label: string;
  href: string | null;
  note: string;
} {
  if (entry.system === "dnp" && entry.tenant_id != null) {
    return {
      label: "公式会議録検索",
      href: `https://ssp.kaigiroku.net/tenant/${entry.slug}/MinuteBrowse.html`,
      note: "会議録検索システムから取得",
    };
  }

  if (entry.system === "gijiroku_com") {
    const subdomain = entry.gijiroku_subdomain ?? entry.slug;
    return {
      label: "公式会議録検索",
      href: `https://${subdomain}.gijiroku.com/voices/`,
      note: "会議録検索システムから取得",
    };
  }

  if (hasMinutes) {
    return {
      label: entry.system === "html_inhouse" ? "公式ページ" : "公式PDF/ページ",
      href: `/${entry.slug}/minutes`,
      note: "自治体公式サイトのPDFやWebページをもとに掲載",
    };
  }

  if (OCR_WAIT.has(entry.slug)) {
    return {
      label: "画像形式のPDF",
      href: `/${entry.slug}`,
      note: "文字起こし結果の確認が必要なため、まだ公開していません",
    };
  }

  if (ALT_FEATURE_LABELS.has(entry.slug)) {
    return {
      label: ALT_FEATURE_LABELS.get(entry.slug) ?? "議事録以外の資料",
      href: `/${entry.slug}`,
      note: "議事録とは別の情報として整理予定",
    };
  }

  return {
    label: "公式サイト確認",
    href: `/${entry.slug}`,
    note: "本会議会議録本文のWeb公開を確認中",
  };
}

function minutesState(entry: Municipality, hasMinutes: boolean): string {
  if (hasMinutes) return "掲載中";
  if (OCR_WAIT.has(entry.slug)) return "文字起こし確認中";
  if (ALT_FEATURE_LABELS.has(entry.slug)) return "別情報として整理予定";
  if (entry.minutes_status === "unavailable") return "再確認予定";
  return "確認中";
}

function otherInfo(capabilityKeys: string[]): string[] {
  const labels: string[] = [];
  if (capabilityKeys.includes("election")) labels.push("選挙");
  if (capabilityKeys.includes("decisions")) labels.push("議決");
  if (capabilityKeys.includes("schedule")) labels.push("行事");
  if (capabilityKeys.includes("newsletter")) labels.push("だより");
  if (capabilityKeys.includes("plan")) labels.push("総合計画");
  return labels;
}

function buildRow(entry: Municipality, budgetSources: Map<string, BudgetSource>): PublicInventoryRow {
  const dataRoot = path.join(/*turbopackIgnore: true*/ process.cwd(), "data");
  const cityDir = path.join(/*turbopackIgnore: true*/ dataRoot, entry.slug);
  const capability = getCityCapability(entry.slug);
  const hasMinutes = capability.capabilities.minutes;
  const source = sourceFor(entry, hasMinutes);
  const budgetSource = budgetSources.get(entry.slug) ?? null;
  const budgetImported = capability.capabilities.budgets;
  const budgetState = budgetImported
    ? "取込済み"
    : budgetSource?.status === "取得候補"
      ? "取得候補"
      : "未確認";
  const budgetYear = budgetSource?.year ?? null;

  return {
    slug: entry.slug,
    name: entry.name,
    councilName: entry.council_name,
    region: entry.region,
    hasMembers: capability.capabilities.members,
    hasMinutes,
    hasTopicData: capability.capabilities.themes,
    hasSessionsData: capability.capabilities.sessions,
    otherInfo: otherInfo(getAvailableCityCapabilityKeys(capability)),
    recordState: minutesState(entry, hasMinutes),
    sourceLabel: source.label,
    sourceHref: source.href,
    sourceNote: source.note,
    verifiedAt: entry.minutes_verified_at ?? null,
    hasBudget: budgetImported,
    hasBudgetCandidate: budgetState === "取得候補",
    budgetState,
    budgetYear,
    budgetSourceLabel: budgetSource?.source_label ?? null,
    budgetSourceHref: budgetSource?.source_href ?? null,
    budgetSourceNote: budgetSource?.note ?? null,
    budgetEnterpriseCoverage: budgetImported ? readBudgetEnterpriseCoverage(cityDir, budgetYear) : null,
  };
}

export function getPublicInformationInventory(): {
  rows: PublicInventoryRow[];
  summary: PublicInventorySummary;
} {
  const dataRoot = path.join(/*turbopackIgnore: true*/ process.cwd(), "data");
  const budgetSources = getBudgetSources(dataRoot);
  const rows = getMunicipalities()
    .filter((entry) => entry.active)
    .sort((a, b) => a.region.localeCompare(b.region, "ja") || a.name.localeCompare(b.name, "ja"))
    .map((entry) => buildRow(entry, budgetSources));

  return {
    rows,
    summary: {
      total: rows.length,
      members: rows.filter((row) => row.hasMembers).length,
      minutes: rows.filter((row) => row.hasMinutes).length,
      themes: rows.filter((row) => row.hasTopicData).length,
      budgets: rows.filter((row) => row.hasBudget).length,
      budgetCandidates: rows.filter((row) => row.hasBudgetCandidate).length,
      sessionsData: rows.filter((row) => row.hasSessionsData).length,
      unavailable: rows.filter((row) => !row.hasMinutes).length,
      ocrWait: rows.filter((row) => row.recordState === "文字起こし確認中").length,
      altFeature: rows.filter((row) => row.recordState === "別情報として整理予定").length,
    },
  };
}
