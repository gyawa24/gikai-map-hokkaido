#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  deriveScheduleDates,
  extractExplicitYears,
  extractJapaneseDates,
  sortMinutesIndex,
} from "./backfill-minutes-index-dates.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_DATA_DIR = path.join(REPO_ROOT, "data");

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function scheduleHeader(schedule) {
  return (schedule?.minutes ?? [])
    .map((minute) => String(minute?.text ?? ""))
    .join("\n")
    .slice(0, 260);
}

function sourceUrls(schedule) {
  return [...new Set(
    (schedule?.minutes ?? [])
      .map((minute) => minute?.source_url)
      .filter(Boolean),
  )];
}

export function detectScheduleYearMismatch(schedule, expectedYear) {
  const expected = Number(expectedYear);
  const dates = deriveScheduleDates(schedule, expectedYear);
  const dateYears = [...new Set(dates.map((value) => Number(value.slice(0, 4))))];
  const header = scheduleHeader(schedule);
  const headerYears = extractExplicitYears(header);
  const headerYear = headerYears[0] ?? null;
  const headerDates = extractJapaneseDates(`${schedule?.name ?? ""}\n${header}`, expectedYear);
  const headerDateYears = new Set(headerDates.map((value) => Number(value.slice(0, 4))));
  const headerConfirmsMismatch = headerYear !== null && headerYear !== expected;

  if (!headerConfirmsMismatch || !headerDateYears.has(headerYear)) return null;
  return {
    expected_year: expected,
    detected_year: headerYear,
    detected_date_years: dateYears,
    dates: headerDates.length > 0 ? headerDates : dates,
  };
}

export async function auditMunicipalityYearContamination(slug, options = {}) {
  const dataDir = options.dataDir ?? DEFAULT_DATA_DIR;
  const minutesDir = path.join(dataDir, slug, "minutes");
  const indexPath = path.join(minutesDir, "index.json");
  let index;
  try {
    index = await readJson(indexPath);
  } catch (error) {
    if (error?.code === "ENOENT") return { slug, councils: [] };
    throw error;
  }
  if (!Array.isArray(index)) throw new Error(`[${slug}] minutes/index.json must be an array`);

  const councils = [];
  for (const entry of index) {
    const councilPath = path.join(minutesDir, entry.file ?? `${entry.council_id}.json`);
    const council = await readJson(councilPath);
    const mismatches = [];
    for (const schedule of council.schedules ?? []) {
      const evidence = detectScheduleYearMismatch(schedule, entry.year);
      if (!evidence) continue;
      mismatches.push({
        schedule_id: schedule.schedule_id,
        name: schedule.name ?? "",
        source_urls: sourceUrls(schedule),
        ...evidence,
      });
    }
    if (mismatches.length === 0) continue;
    councils.push({
      council_id: entry.council_id,
      file: path.basename(councilPath),
      published_year: Number(entry.year),
      schedule_count: (council.schedules ?? []).length,
      mismatches,
      entry,
      council,
    });
  }
  return { slug, councils };
}

function publicIndexEntry(entry, retainedCount) {
  const next = { ...entry, schedule_count: retainedCount };
  delete next.start_date;
  delete next.end_date;
  delete next.sort_date;
  delete next.date_precision;
  return next;
}

async function verifyOrCreateBackup(backupPath, council, write) {
  try {
    const existing = await readJson(backupPath);
    if (JSON.stringify(existing) === JSON.stringify(council)) return;
    const existingSchedules = new Map(
      (existing?.schedules ?? []).map((schedule) => [String(schedule.schedule_id), schedule]),
    );
    const isPublishedSubset = (council?.schedules ?? []).every((schedule) => {
      const original = existingSchedules.get(String(schedule.schedule_id));
      return original && JSON.stringify(original) === JSON.stringify(schedule);
    });
    if (!isPublishedSubset) {
      throw new Error(`backup collision: ${path.relative(REPO_ROOT, backupPath)}`);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    if (write) await writeJson(backupPath, council);
  }
}

export async function repairMunicipalityYearContamination(slug, options = {}) {
  const dataDir = options.dataDir ?? DEFAULT_DATA_DIR;
  const write = options.write === true;
  const audit = await auditMunicipalityYearContamination(slug, { dataDir });
  if (audit.councils.length === 0) {
    return { slug, changed: false, councils: 0, removedSchedules: 0, removedCouncils: 0 };
  }

  const minutesDir = path.join(dataDir, slug, "minutes");
  const indexPath = path.join(minutesDir, "index.json");
  const index = await readJson(indexPath);
  const repairs = new Map(audit.councils.map((item) => [String(item.council_id), item]));
  const nextIndex = [];
  let removedSchedules = 0;
  let removedCouncils = 0;
  const manifestCouncils = [];

  for (const entry of index) {
    const issue = repairs.get(String(entry.council_id));
    if (!issue) {
      nextIndex.push(entry);
      continue;
    }

    const badIds = new Set(issue.mismatches.map((item) => String(item.schedule_id)));
    const retained = (issue.council.schedules ?? []).filter(
      (schedule) => !badIds.has(String(schedule.schedule_id)),
    );
    const backupPath = path.join(
      dataDir,
      slug,
      "quarantine",
      "minutes",
      "year-mismatch",
      issue.file,
    );
    await verifyOrCreateBackup(backupPath, issue.council, write);

    if (retained.length > 0) {
      const repairedCouncil = { ...issue.council, schedules: retained };
      if (write) await writeJson(path.join(minutesDir, issue.file), repairedCouncil);
      nextIndex.push(publicIndexEntry(entry, retained.length));
    } else {
      removedCouncils += 1;
    }

    removedSchedules += issue.mismatches.length;
    manifestCouncils.push({
      council_id: issue.council_id,
      published_year: issue.published_year,
      original_schedule_count: issue.schedule_count,
      retained_schedule_count: retained.length,
      removed_schedules: issue.mismatches.map(({ expected_year, ...item }) => item),
      backup_file: path.relative(path.join(dataDir, slug), backupPath),
    });
  }

  if (write) {
    await writeJson(indexPath, sortMinutesIndex(nextIndex));
    const manifestPath = path.join(dataDir, slug, "quarantine", "minutes.json");
    let manifest = { updated_at: new Date().toISOString().slice(0, 10), records: [] };
    try {
      manifest = await readJson(manifestPath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const records = Array.isArray(manifest.records) ? manifest.records : [];
    records.push({
      status: "filtered_from_publication",
      reason: "schedule_year_mismatch_high_confidence",
      councils: manifestCouncils,
      note: "日程名・開催日抽出と本文冒頭の年が公開年と一致しない日程を除外。原本はquarantine配下に保存。",
    });
    await writeJson(manifestPath, {
      ...manifest,
      updated_at: new Date().toISOString().slice(0, 10),
      records,
    });
  }

  return {
    slug,
    changed: true,
    councils: audit.councils.length,
    removedSchedules,
    removedCouncils,
    write,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const slugIndex = args.indexOf("--slug");
  const slugs = slugIndex >= 0
    ? String(args[slugIndex + 1] ?? "").split(",").filter(Boolean)
    : (await fs.readdir(DEFAULT_DATA_DIR, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  if (slugs.length === 0) throw new Error("--slug requires at least one municipality");

  let councils = 0;
  let schedules = 0;
  const affected = [];
  for (const slug of slugs) {
    const result = await repairMunicipalityYearContamination(slug, { write });
    if (!result.changed) continue;
    affected.push(slug);
    councils += result.councils;
    schedules += result.removedSchedules;
    console.log(
      `[${slug}] ${result.councils} council(s), ${result.removedSchedules} mismatched schedule(s)${write ? " repaired" : " detected"}`,
    );
  }
  console.log(
    `${write ? "repaired" : "dry-run"}: ${schedules} schedule(s) in ${councils} council(s) / ${affected.length} municipality(s)`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
