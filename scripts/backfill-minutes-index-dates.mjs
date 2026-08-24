#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT_DATA_DIR = path.join(REPO_ROOT, "data");
const SITE_DATA_DIR = path.join(REPO_ROOT, "site", "data");

function normalizeDigits(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ");
}

function validIsoDate(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y
    || date.getUTCMonth() !== m - 1
    || date.getUTCDate() !== d
  ) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function japaneseEraYear(era, value) {
  const ordinal = value === "元" ? 1 : Number(value);
  if (!Number.isInteger(ordinal) || ordinal < 1) return null;
  const base = { 令和: 2018, 平成: 1988, 昭和: 1925 }[era];
  return base ? base + ordinal : null;
}

export function extractExplicitYears(text) {
  const source = normalizeDigits(text);
  const years = [];
  for (const match of source.matchAll(/(?:\b(19\d{2}|20\d{2})\s*年|\b(19\d{2}|20\d{2})-(?=\d{2}-\d{2})|(令和|平成|昭和)\s*(元|\d{1,2})\s*年)/gu)) {
    const year = match[1]
      ? Number(match[1])
      : match[2]
        ? Number(match[2])
        : japaneseEraYear(match[3], match[4]);
    if (year) years.push(year);
  }
  return [...new Set(years)];
}

export function extractJapaneseDates(text, fallbackYear) {
  const source = normalizeDigits(text);
  const dates = [];
  for (const match of source.matchAll(/(?:(20\d{2})\s*年|(令和|平成|昭和)\s*(元|\d{1,2})\s*年)?\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/gu)) {
    const year = match[1]
      ? Number(match[1])
      : match[2]
        ? japaneseEraYear(match[2], match[3])
        : Number(fallbackYear);
    const iso = validIsoDate(year, match[4], match[5]);
    if (iso) dates.push(iso);
  }
  for (const match of source.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/gu)) {
    const iso = validIsoDate(match[1], match[2], match[3]);
    if (iso) dates.push(iso);
  }
  return [...new Set(dates)];
}

function scheduleBodyPrefix(schedule) {
  return (schedule?.minutes ?? [])
    .filter((minute) => minute && typeof minute === "object")
    .map((minute) => String(minute.text ?? "").slice(0, 1600))
    .join("\n");
}

export function deriveScheduleDates(schedule, fallbackYear) {
  const direct = [schedule?.date, schedule?.start_date, schedule?.end_date]
    .flatMap((value) => extractJapaneseDates(value, fallbackYear));
  if (direct.length) return [...new Set(direct)];

  const nameDates = extractJapaneseDates(schedule?.name, fallbackYear);
  if (nameDates.length) return nameDates;

  const body = normalizeDigits(scheduleBodyPrefix(schedule));
  if (!body) return [];

  const header = body.slice(0, 700);

  const periodMatches = [...header.slice(0, 400).matchAll(/期\s*日\s*([^\n]{0,80})/gu)]
    .flatMap((match) => extractJapaneseDates(match[1], fallbackYear));
  if (periodMatches.length) return [...new Set(periodMatches)];

  const openCloseMatches = [...header.matchAll(/((?:(?:20\d{2})\s*年|(?:令和|平成|昭和)\s*(?:元|\d{1,2})\s*年)?\s*\d{1,2}\s*月\s*\d{1,2}\s*日)\s*(?:開\s*会|開\s*議|閉\s*会|散\s*会|延\s*会)/gu)]
    .flatMap((match) => extractJapaneseDates(match[1], fallbackYear));
  if (openCloseMatches.length) return [...new Set(openCloseMatches)];

  const weekdayMatches = [...header.matchAll(/((?:(?:20\d{2})\s*年|(?:令和|平成|昭和)\s*(?:元|\d{1,2})\s*年)?\s*\d{1,2}\s*月\s*\d{1,2}\s*日?)\s*[（(][月火水木金土日](?:曜日)?[）)]/gu)]
    .flatMap((match) => extractJapaneseDates(`${match[1].replace(/日\s*$/u, "")}日`, fallbackYear));
  if (weekdayMatches.length) return [...new Set(weekdayMatches)];

  return extractJapaneseDates(header.slice(0, 180), fallbackYear);
}

export function deriveCouncilDateRange(indexEntry, council) {
  const fallbackYear = indexEntry?.year ?? council?.year;
  const dates = (council?.schedules ?? [])
    .flatMap((schedule) => deriveScheduleDates(schedule, fallbackYear))
    .filter((date) => !fallbackYear || date.startsWith(`${fallbackYear}-`));
  if (!dates.length) {
    dates.push(...extractJapaneseDates(council?.name ?? indexEntry?.name, fallbackYear));
  }
  const ordered = [...new Set(dates)].sort();
  if (!ordered.length) return null;
  return { start_date: ordered[0], end_date: ordered.at(-1) };
}

export function deriveSortMetadata(indexEntry, range) {
  if (range?.end_date) return { sort_date: range.end_date, date_precision: "day" };
  const source = normalizeDigits(indexEntry?.name);
  const monthMatch = source.match(/(\d{1,2})\s*月/u);
  const year = Number(indexEntry?.year);
  const month = Number(monthMatch?.[1]);
  if (Number.isInteger(year) && month >= 1 && month <= 12) {
    return {
      sort_date: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`,
      date_precision: "month",
    };
  }
  return null;
}

export function sortMinutesIndex(entries) {
  const originalPosition = new Map(entries.map((entry, index) => [entry, index]));
  return [...entries].sort((a, b) => {
    const yearOrder = String(b.year ?? "").localeCompare(String(a.year ?? ""));
    if (yearOrder !== 0) return yearOrder;
    if (a.sort_date && b.sort_date) return b.sort_date.localeCompare(a.sort_date);
    if (a.sort_date && !b.sort_date) return -1;
    if (!a.sort_date && b.sort_date) return 1;
    return originalPosition.get(a) - originalPosition.get(b);
  });
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJsonIfChanged(filePath, value) {
  const next = `${JSON.stringify(value, null, 2)}\n`;
  const current = await fs.readFile(filePath, "utf8").catch(() => null);
  if (current === next) return false;
  await fs.writeFile(filePath, next, "utf8");
  return true;
}

export async function backfillMunicipalityDates(slug) {
  const minutesDir = path.join(ROOT_DATA_DIR, slug, "minutes");
  const indexPath = path.join(minutesDir, "index.json");
  let entries;
  try {
    entries = await readJson(indexPath);
  } catch (error) {
    if (error?.code === "ENOENT") return { slug, skipped: true, entries: 0, dated: 0, changed: false };
    throw error;
  }
  if (!Array.isArray(entries)) throw new Error(`[${slug}] minutes/index.json must be an array`);

  let dated = 0;
  for (const entry of entries) {
    const file = entry.file ?? `${entry.council_id}.json`;
    let council;
    try {
      council = await readJson(path.join(minutesDir, file));
    } catch {
      continue;
    }
    const range = deriveCouncilDateRange(entry, council);
    if (range) {
      entry.start_date = range.start_date;
      entry.end_date = range.end_date;
      dated += 1;
    } else {
      delete entry.start_date;
      delete entry.end_date;
    }
    const sortMetadata = deriveSortMetadata(entry, range);
    if (sortMetadata) {
      Object.assign(entry, sortMetadata);
    } else {
      delete entry.sort_date;
      delete entry.date_precision;
    }
  }

  const sorted = sortMinutesIndex(entries);
  const changed = await writeJsonIfChanged(indexPath, sorted);
  const siteIndexPath = path.join(SITE_DATA_DIR, slug, "minutes", "index.json");
  try {
    await fs.access(siteIndexPath);
    await writeJsonIfChanged(siteIndexPath, sorted);
  } catch {
    // Site mirror is created by the normal municipality sync when absent.
  }
  return { slug, skipped: false, entries: entries.length, dated, changed };
}

async function main() {
  const args = process.argv.slice(2);
  const slugIndex = args.indexOf("--slug");
  const slugs = slugIndex >= 0
    ? String(args[slugIndex + 1] ?? "").split(",").filter(Boolean)
    : (await fs.readdir(ROOT_DATA_DIR, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  if (!slugs.length) throw new Error("--slug requires at least one municipality");

  let entries = 0;
  let dated = 0;
  let changed = 0;
  for (const slug of slugs) {
    const result = await backfillMunicipalityDates(slug);
    if (result.skipped) continue;
    entries += result.entries;
    dated += result.dated;
    if (result.changed) changed += 1;
    console.log(`[${slug}] dated ${result.dated}/${result.entries}${result.changed ? " / updated" : ""}`);
  }
  console.log(`minutes dates: ${dated}/${entries} entries across ${slugs.length} requested municipalities; ${changed} indexes updated`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
