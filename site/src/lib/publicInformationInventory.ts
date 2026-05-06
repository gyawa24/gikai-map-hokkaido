import fs from "node:fs";
import path from "node:path";
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

export type PublicInventoryRow = {
  slug: string;
  name: string;
  councilName: string;
  region: string;
  features: string[];
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
};

export type PublicInventorySummary = {
  total: number;
  members: number;
  minutes: number;
  themes: number;
  sessionsFeature: number;
  sessionsData: number;
  unavailable: number;
  ocrWait: number;
  altFeature: number;
};

function exists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

function hasMinutesData(cityDir: string): boolean {
  return (
    exists(path.join(cityDir, "minutes", "index.json")) ||
    exists(path.join(cityDir, "index.json"))
  );
}

function hasThemesData(cityDir: string): boolean {
  return exists(path.join(cityDir, "members_activity.json"));
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

function otherInfo(entry: Municipality): string[] {
  const labels: string[] = [];
  if (entry.features.includes("election")) labels.push("選挙");
  if (entry.features.includes("decisions")) labels.push("議決");
  if (entry.features.includes("schedule")) labels.push("行事");
  if (entry.features.includes("newsletter")) labels.push("だより");
  if (entry.features.includes("plan")) labels.push("総合計画");
  return labels;
}

function buildRow(entry: Municipality): PublicInventoryRow {
  const dataRoot = path.join(/*turbopackIgnore: true*/ process.cwd(), "data");
  const cityDir = path.join(/*turbopackIgnore: true*/ dataRoot, entry.slug);
  const hasMinutes = hasMinutesData(cityDir);
  const source = sourceFor(entry, hasMinutes);

  return {
    slug: entry.slug,
    name: entry.name,
    councilName: entry.council_name,
    region: entry.region,
    features: entry.features,
    hasMembers: exists(path.join(cityDir, "members.json")),
    hasMinutes,
    hasTopicData: hasThemesData(cityDir),
    hasSessionsData: exists(path.join(cityDir, "sessions", "index.json")),
    otherInfo: otherInfo(entry),
    recordState: minutesState(entry, hasMinutes),
    sourceLabel: source.label,
    sourceHref: source.href,
    sourceNote: source.note,
    verifiedAt: entry.minutes_verified_at ?? null,
  };
}

export function getPublicInformationInventory(): {
  rows: PublicInventoryRow[];
  summary: PublicInventorySummary;
} {
  const rows = getMunicipalities()
    .filter((entry) => entry.active)
    .sort((a, b) => a.region.localeCompare(b.region, "ja") || a.name.localeCompare(b.name, "ja"))
    .map(buildRow);

  return {
    rows,
    summary: {
      total: rows.length,
      members: rows.filter((row) => row.hasMembers).length,
      minutes: rows.filter((row) => row.hasMinutes).length,
      themes: rows.filter((row) => row.hasTopicData).length,
      sessionsFeature: rows.filter((row) => row.features.includes("sessions")).length,
      sessionsData: rows.filter((row) => row.hasSessionsData).length,
      unavailable: rows.filter((row) => !row.hasMinutes).length,
      ocrWait: rows.filter((row) => row.recordState === "文字起こし確認中").length,
      altFeature: rows.filter((row) => row.recordState === "別情報として整理予定").length,
    },
  };
}
