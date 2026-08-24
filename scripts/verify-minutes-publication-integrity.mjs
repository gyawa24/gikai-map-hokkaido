#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  deriveCouncilDateRange,
  deriveSortMetadata,
} from "./backfill-minutes-index-dates.mjs";
import { detectScheduleYearMismatch } from "./repair-minutes-year-contamination.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_DATA_DIR = path.join(REPO_ROOT, "data");
const DEFAULT_MAX_SPAN_DAYS = 45;

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function dateSpanDays(startDate, endDate) {
  if (!startDate || !endDate) return 0;
  return (Date.parse(endDate) - Date.parse(startDate)) / 86_400_000;
}

export async function verifyMinutesPublicationIntegrity(options = {}) {
  const dataDir = options.dataDir ?? DEFAULT_DATA_DIR;
  const maxSpanDays = options.maxSpanDays ?? DEFAULT_MAX_SPAN_DAYS;
  const requestedSlugs = options.slugs?.length
    ? options.slugs
    : (await fs.readdir(dataDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  const errors = [];
  let municipalityCount = 0;
  let councilCount = 0;
  let exactDateCount = 0;

  for (const slug of requestedSlugs) {
    const minutesDir = path.join(dataDir, slug, "minutes");
    const indexPath = path.join(minutesDir, "index.json");
    if (!(await pathExists(indexPath))) continue;
    municipalityCount += 1;
    let index;
    try {
      index = await readJson(indexPath);
    } catch (error) {
      errors.push(`[${slug}] minutes/index.json is not valid JSON: ${error.message}`);
      continue;
    }
    if (!Array.isArray(index)) {
      errors.push(`[${slug}] minutes/index.json must be an array`);
      continue;
    }

    const seenIds = new Set();
    for (const entry of index) {
      const councilId = String(entry?.council_id ?? "");
      councilCount += 1;
      if (!councilId || seenIds.has(councilId)) {
        errors.push(`[${slug}] invalid or duplicate council_id: ${councilId || "missing"}`);
        continue;
      }
      seenIds.add(councilId);
      const fileName = entry.file ?? `${councilId}.json`;
      const councilPath = path.join(minutesDir, fileName);
      let council;
      try {
        council = await readJson(councilPath);
      } catch (error) {
        errors.push(`[${slug}/${councilId}] cannot read ${fileName}: ${error.message}`);
        continue;
      }
      if (String(council.council_id) !== councilId) {
        errors.push(`[${slug}/${councilId}] council_id differs between index and file`);
      }
      if (String(council.year) !== String(entry.year)) {
        errors.push(`[${slug}/${councilId}] year differs between index and file`);
      }
      const schedules = Array.isArray(council.schedules) ? council.schedules : [];
      if (schedules.length === 0) {
        errors.push(`[${slug}/${councilId}] published council has no schedules`);
      }
      if (entry.schedule_count !== undefined && Number(entry.schedule_count) !== schedules.length) {
        errors.push(
          `[${slug}/${councilId}] schedule_count=${entry.schedule_count} but file has ${schedules.length}`,
        );
      }
      for (const schedule of schedules) {
        const mismatch = detectScheduleYearMismatch(schedule, entry.year);
        if (mismatch) {
          errors.push(
            `[${slug}/${councilId}/schedule ${schedule.schedule_id}] publication year ${entry.year} conflicts with header year ${mismatch.detected_year}`,
          );
        }
      }

      const range = deriveCouncilDateRange(entry, council);
      const sort = deriveSortMetadata(entry, range);
      if (range) exactDateCount += 1;
      for (const key of ["start_date", "end_date"]) {
        if ((entry[key] ?? null) !== (range?.[key] ?? null)) {
          errors.push(`[${slug}/${councilId}] stale or incorrect ${key}`);
        }
      }
      for (const key of ["sort_date", "date_precision"]) {
        if ((entry[key] ?? null) !== (sort?.[key] ?? null)) {
          errors.push(`[${slug}/${councilId}] stale or incorrect ${key}`);
        }
      }
      const span = dateSpanDays(range?.start_date, range?.end_date);
      if (span > maxSpanDays && entry.date_span_reviewed !== true) {
        errors.push(
          `[${slug}/${councilId}] schedules span ${span} days; split the meeting or set date_span_reviewed after source review`,
        );
      }
    }
  }

  return { errors, municipalityCount, councilCount, exactDateCount };
}

async function main() {
  const args = process.argv.slice(2);
  const slugIndex = args.indexOf("--slug");
  const slugs = slugIndex >= 0
    ? String(args[slugIndex + 1] ?? "").split(",").filter(Boolean)
    : undefined;
  if (slugIndex >= 0 && !slugs.length) throw new Error("--slug requires at least one municipality");
  const result = await verifyMinutesPublicationIntegrity({ slugs });
  if (result.errors.length > 0) {
    for (const error of result.errors) console.error(`error - ${error}`);
    console.error(
      `minutes publication integrity: ${result.errors.length} error(s) / ${result.councilCount} councils`,
    );
    process.exit(1);
  }
  console.log(
    `minutes publication integrity: ${result.councilCount} councils / ${result.exactDateCount} exact-date councils / ${result.municipalityCount} municipalities`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
