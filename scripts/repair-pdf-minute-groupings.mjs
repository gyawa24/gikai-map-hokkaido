#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_DATA_ROOT = path.join(REPO_ROOT, "data");

const REPAIRS = Object.freeze({
  biratori: {
    reason: "PDF日付だけで集約されていた複数の定例会・臨時会を、本文冒頭の公式回次で分割する",
    sourceIds: [20241099, 20242099, 20251099, 20252099],
    detector: "numbered",
  },
  rikubetsu: {
    reason: "会議回次ではなく日次の第N号で集約されていた定例会・臨時会を、本文冒頭の公式会議名で分割する",
    sourceIds: [
      20241001, 20241002, 20241003, 20241004, 20241005,
      20251001, 20251002, 20251003, 20251004,
    ],
    detector: "rikubetsu",
  },
  furano: {
    reason: "同じJSONに混在していた第2回・第3回臨時会を、本文冒頭の公式回次で分割する",
    sourceIds: [20242002],
    detector: "numbered",
  },
});

function normalizeText(value) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function reiwaToWestern(rawYear) {
  const value = normalizeText(rawYear);
  const year = value === "元" ? 1 : Number(value);
  if (!Number.isInteger(year) || year < 1 || year > 99) return null;
  return 2018 + year;
}

function japaneseYear(year) {
  return `令和${Number(year) - 2018}年`;
}

function councilIdFor(year, type, sequence) {
  const typeCode = type === "定例会" ? 10 : type === "臨時会" ? 20 : null;
  if (!typeCode || !Number.isInteger(sequence) || sequence < 1 || sequence > 99) {
    throw new Error(`unsupported council identity: ${year}/${type}/${sequence}`);
  }
  return Number(year) * 10_000 + typeCode * 100 + sequence;
}

function sourceText(schedule) {
  return (schedule?.minutes ?? []).map((minute) => String(minute?.text ?? "")).join("\n");
}

function scheduleSourceUrl(schedule, context) {
  const urls = new Set(
    (schedule?.minutes ?? [])
      .map((minute) => String(minute?.source_url ?? "").trim())
      .filter(Boolean),
  );
  if (urls.size !== 1) {
    throw new Error(`${context}: expected exactly one source_url, found ${urls.size}`);
  }
  return [...urls][0];
}

function scheduleDate(schedule, expectedYear, context) {
  const name = normalizeText(schedule?.name);
  const bodyPrefix = normalizeText(sourceText(schedule).slice(0, 2_000));
  const candidates = [name, bodyPrefix];

  for (const text of candidates) {
    const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/u);
    if (iso) return checkedIsoDate(iso[1], iso[2], iso[3], expectedYear, context);

    const reiwa = text.match(/令和\s*(元|\d{1,2})\s*年[^\d]{0,30}?(\d{1,2})\s*月\s*(\d{1,2})\s*日/u);
    if (reiwa) {
      const year = reiwaToWestern(reiwa[1]);
      return checkedIsoDate(year, reiwa[2], reiwa[3], expectedYear, context);
    }

    const monthDay = text.match(/(?:^|\D)(\d{1,2})\s*月\s*(\d{1,2})\s*日/u);
    if (monthDay) {
      return checkedIsoDate(expectedYear, monthDay[1], monthDay[2], expectedYear, context);
    }
  }
  throw new Error(`${context}: official meeting date is not recognizable`);
}

function checkedIsoDate(rawYear, rawMonth, rawDay, expectedYear, context) {
  const year = Number(rawYear);
  const month = Number(rawMonth);
  const day = Number(rawDay);
  const value = new Date(Date.UTC(year, month - 1, day));
  if (
    year !== Number(expectedYear)
    || value.getUTCFullYear() !== year
    || value.getUTCMonth() !== month - 1
    || value.getUTCDate() !== day
  ) {
    throw new Error(`${context}: invalid or mismatched meeting date ${rawYear}-${rawMonth}-${rawDay}`);
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function numberedIdentity(schedule, expectedYear, context) {
  const heading = normalizeText(`${schedule?.name ?? ""}\n${sourceText(schedule).slice(0, 2_000)}`);
  const match = heading.match(
    /令和\s*(元|\d{1,2})\s*年\s*第\s*(\d{1,2})\s*回[^。]{0,80}?(定例会|臨時会)/u,
  );
  if (!match) throw new Error(`${context}: official numbered council heading is not recognizable`);
  const year = reiwaToWestern(match[1]);
  const sequence = Number(match[2]);
  const type = match[3];
  if (year !== Number(expectedYear)) {
    throw new Error(`${context}: heading year ${year} does not match index year ${expectedYear}`);
  }
  return {
    year,
    type,
    sequence,
    councilId: councilIdFor(year, type, sequence),
    name: `${japaneseYear(year)}第${sequence}回${type}`,
  };
}

function rikubetsuIdentity(schedule, expectedYear, context) {
  const heading = normalizeText(sourceText(schedule).slice(0, 1_000));
  const special = heading.match(
    /令和\s*(元|\d{1,2})\s*年[^。]{0,40}?第\s*(\d{1,2})\s*回\s*臨時会/u,
  );
  if (special) {
    const year = reiwaToWestern(special[1]);
    const sequence = Number(special[2]);
    if (year !== Number(expectedYear)) {
      throw new Error(`${context}: heading year ${year} does not match index year ${expectedYear}`);
    }
    return {
      year,
      type: "臨時会",
      sequence,
      councilId: councilIdFor(year, "臨時会", sequence),
      name: `${japaneseYear(year)}第${sequence}回臨時会`,
    };
  }

  const regular = heading.match(
    /令和\s*(元|\d{1,2})\s*年[^。]{0,40}?(\d{1,2})\s*月\s*定例会/u,
  );
  if (!regular) throw new Error(`${context}: official Rikubetsu council heading is not recognizable`);
  const year = reiwaToWestern(regular[1]);
  const month = Number(regular[2]);
  if (year !== Number(expectedYear) || month < 1 || month > 12) {
    throw new Error(`${context}: invalid Rikubetsu regular council identity`);
  }
  return {
    year,
    type: "定例会",
    sequence: month,
    councilId: councilIdFor(year, "定例会", month),
    name: `${japaneseYear(year)}${month}月定例会`,
  };
}

function typeLabelFor(baseLabel, type) {
  const label = String(baseLabel ?? "").trim();
  if (!label) return `全会議 > 本会議 > ${type}`;
  if (/(?:定例会|臨時会)/u.test(label)) return label.replace(/(?:定例会|臨時会)(?!.*(?:定例会|臨時会))/u, type);
  return `${label} > ${type}`;
}

function jsonHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function minutePayloadHash(schedule) {
  return jsonHash(schedule?.minutes ?? []);
}

function assertMinutePayloadsPreserved(sourceSchedules, targetCouncils, slug) {
  const expected = sourceSchedules.map(minutePayloadHash).sort();
  const actual = targetCouncils
    .flatMap((council) => council.schedules.map(minutePayloadHash))
    .sort();
  if (expected.length !== actual.length || expected.some((hash, index) => hash !== actual[index])) {
    throw new Error(`[${slug}] minute payloads changed, disappeared, or were duplicated`);
  }
}

function sortIndex(entries) {
  return [...entries].sort((left, right) => {
    const yearOrder = String(right.year ?? "").localeCompare(String(left.year ?? ""));
    if (yearOrder !== 0) return yearOrder;
    const leftDate = String(left.end_date ?? "");
    const rightDate = String(right.end_date ?? "");
    if (leftDate !== rightDate) return rightDate.localeCompare(leftDate);
    return Number(right.council_id) - Number(left.council_id);
  });
}

function buildRepairPlan(slug, config, index, sourceCouncils, generatedAt) {
  if (!Array.isArray(index)) throw new Error(`[${slug}] minutes/index.json must be an array`);
  const indexIds = new Set();
  for (const entry of index) {
    const id = Number(entry?.council_id);
    if (!Number.isInteger(id) || indexIds.has(id)) {
      throw new Error(`[${slug}] minutes/index.json has an invalid or duplicate council_id`);
    }
    indexIds.add(id);
  }

  const sourceIdSet = new Set(config.sourceIds);
  const sourceEntries = new Map();
  for (const sourceId of config.sourceIds) {
    const entry = index.find((candidate) => Number(candidate.council_id) === sourceId);
    if (!entry) throw new Error(`[${slug}] source council ${sourceId} is missing from index`);
    const council = sourceCouncils.get(sourceId);
    if (!council || Number(council.council_id) !== sourceId || !Array.isArray(council.schedules)) {
      throw new Error(`[${slug}] source council ${sourceId} is missing or malformed`);
    }
    sourceEntries.set(sourceId, entry);
  }

  const groups = new Map();
  const seenSourceUrls = new Map();
  const sourceSchedules = [];
  const scheduleMappings = [];

  for (const sourceId of config.sourceIds) {
    const council = sourceCouncils.get(sourceId);
    const entry = sourceEntries.get(sourceId);
    if (council.schedules.length === 0) throw new Error(`[${slug}/${sourceId}] schedules are empty`);
    for (const schedule of council.schedules) {
      const context = `[${slug}/${sourceId}/schedule ${schedule?.schedule_id ?? "missing"}]`;
      const url = scheduleSourceUrl(schedule, context);
      if (seenSourceUrls.has(url)) {
        throw new Error(`${context}: duplicate source_url also used by ${seenSourceUrls.get(url)}: ${url}`);
      }
      seenSourceUrls.set(url, context);

      const year = String(entry.year ?? council.year ?? "");
      const identity = config.detector === "rikubetsu"
        ? rikubetsuIdentity(schedule, year, context)
        : numberedIdentity(schedule, year, context);
      const date = scheduleDate(schedule, identity.year, context);
      const existing = groups.get(identity.councilId);
      if (existing && (existing.identity.name !== identity.name || existing.identity.type !== identity.type)) {
        throw new Error(`${context}: target council identity collision at ${identity.councilId}`);
      }
      const group = existing ?? {
        identity,
        sourceCouncil: council,
        sourceEntry: entry,
        schedules: [],
        dates: [],
        mappings: [],
      };
      const mapping = {
        source_council_id: sourceId,
        source_schedule_id: schedule.schedule_id ?? null,
        source_url: url,
        target_council_id: identity.councilId,
        target_schedule_id: null,
      };
      group.schedules.push(schedule);
      group.dates.push(date);
      group.mappings.push(mapping);
      groups.set(identity.councilId, group);
      sourceSchedules.push(schedule);
      scheduleMappings.push(mapping);
    }
  }

  const targetIds = new Set(groups.keys());
  for (const targetId of targetIds) {
    if (indexIds.has(targetId) && !sourceIdSet.has(targetId)) {
      throw new Error(`[${slug}] target council_id ${targetId} collides with an unaffected index entry`);
    }
  }

  const targetCouncils = [];
  const targetEntries = [];
  for (const [targetId, group] of groups) {
    const order = group.schedules.map((schedule, position) => ({
      schedule,
      date: group.dates[position],
      mapping: group.mappings[position],
    })).sort((left, right) => left.date.localeCompare(right.date));
    const dates = order.map((item) => item.date);
    const identity = group.identity;
    const normalizedSchedules = order.map((item, position) => {
      item.mapping.target_schedule_id = position + 1;
      return {
        ...item.schedule,
        schedule_id: position + 1,
        page_no: position + 1,
      };
    });
    const council = {
      ...group.sourceCouncil,
      council_id: targetId,
      name: identity.name,
      year: String(identity.year),
      japanese_year: japaneseYear(identity.year),
      type_label: typeLabelFor(group.sourceCouncil.type_label, identity.type),
      schedules: normalizedSchedules,
    };
    const entry = {
      ...group.sourceEntry,
      council_id: targetId,
      name: identity.name,
      year: String(identity.year),
      japanese_year: japaneseYear(identity.year),
      type_label: typeLabelFor(group.sourceEntry.type_label, identity.type),
      file: `${targetId}.json`,
      schedule_count: council.schedules.length,
      start_date: dates[0],
      end_date: dates.at(-1),
      sort_date: dates.at(-1),
      date_precision: "day",
    };
    targetCouncils.push(council);
    targetEntries.push(entry);
  }
  targetCouncils.sort((left, right) => left.council_id - right.council_id);
  assertMinutePayloadsPreserved(sourceSchedules, targetCouncils, slug);

  const nextIndex = sortIndex([
    ...index.filter((entry) => !sourceIdSet.has(Number(entry.council_id))),
    ...targetEntries,
  ]);
  const nextIds = new Set();
  for (const entry of nextIndex) {
    if (nextIds.has(entry.council_id)) throw new Error(`[${slug}] repaired index has duplicate council_id ${entry.council_id}`);
    nextIds.add(entry.council_id);
  }

  const mappings = config.sourceIds.map((sourceId) => ({
    old_council_id: sourceId,
    new_council_ids: [...new Set(
      scheduleMappings
        .filter((mapping) => mapping.source_council_id === sourceId)
        .map((mapping) => mapping.target_council_id),
    )].sort((left, right) => left - right),
  }));
  const manifest = {
    version: 1,
    generated_at: generatedAt,
    slug,
    reason: config.reason,
    source_index: "minutes/index.json",
    source_files: config.sourceIds.map((id) => `minutes/${id}.json`),
    mappings,
    schedule_mappings: scheduleMappings,
    integrity: {
      algorithm: "sha256",
      schedule_count: sourceSchedules.length,
      source_minute_payload_hashes: sourceSchedules.map(minutePayloadHash).sort(),
      target_minute_payload_hashes: targetCouncils
        .flatMap((council) => council.schedules.map(minutePayloadHash))
        .sort(),
      minute_text_modified: false,
    },
  };

  return {
    slug,
    sourceIds: [...config.sourceIds],
    targetIds: targetCouncils.map((council) => council.council_id),
    targetCouncils,
    nextIndex,
    manifest,
  };
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonWithRaw(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return { raw, value: JSON.parse(raw) };
}

async function writePlanAtomically(plan, minutesDir, quarantineDir, originalFiles) {
  if (await pathExists(quarantineDir)) {
    throw new Error(`[${plan.slug}] quarantine destination already exists: ${quarantineDir}`);
  }

  const token = `${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  const quarantineTemp = `${quarantineDir}.${token}.tmp`;
  const staged = [];
  const backups = [];
  const installed = [];
  let committed = false;
  const replacements = [
    ...plan.targetCouncils.map((council) => ({
      targetPath: path.join(minutesDir, `${council.council_id}.json`),
      contents: `${JSON.stringify(council, null, 2)}\n`,
    })),
    {
      targetPath: path.join(minutesDir, "index.json"),
      contents: `${JSON.stringify(plan.nextIndex, null, 2)}\n`,
    },
  ];
  const targetPaths = new Set(replacements.map((replacement) => replacement.targetPath));
  const obsoletePaths = plan.sourceIds
    .map((id) => path.join(minutesDir, `${id}.json`))
    .filter((filePath) => !targetPaths.has(filePath));
  const affectedPaths = [...new Set([...targetPaths, ...obsoletePaths])];

  try {
    await fs.mkdir(quarantineTemp, { recursive: true });
    for (const [fileName, raw] of originalFiles) {
      await fs.writeFile(path.join(quarantineTemp, fileName), raw, "utf8");
    }
    await fs.writeFile(
      path.join(quarantineTemp, "manifest.json"),
      `${JSON.stringify(plan.manifest, null, 2)}\n`,
      "utf8",
    );

    for (const replacement of replacements) {
      const tempPath = path.join(
        path.dirname(replacement.targetPath),
        `.${path.basename(replacement.targetPath)}.${token}.tmp`,
      );
      await fs.writeFile(tempPath, replacement.contents, "utf8");
      staged.push({ tempPath, targetPath: replacement.targetPath });
    }

    await fs.mkdir(path.dirname(quarantineDir), { recursive: true });
    await fs.rename(quarantineTemp, quarantineDir);

    for (const targetPath of affectedPaths) {
      if (!(await pathExists(targetPath))) continue;
      const backupPath = `${targetPath}.${token}.bak`;
      await fs.rename(targetPath, backupPath);
      backups.push({ targetPath, backupPath });
    }
    for (const item of staged) {
      await fs.rename(item.tempPath, item.targetPath);
      installed.push(item.targetPath);
    }
    committed = true;
  } catch (error) {
    const rollbackErrors = [];
    for (const targetPath of installed.reverse()) {
      try {
        await fs.rm(targetPath, { force: true });
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    for (const { targetPath, backupPath } of backups.reverse()) {
      try {
        await fs.rename(backupPath, targetPath);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length === 0) {
      await fs.rm(quarantineDir, { recursive: true, force: true }).catch(() => {});
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError([error, ...rollbackErrors], `[${plan.slug}] repair and rollback both failed`);
    }
    throw error;
  } finally {
    await Promise.all(staged.map(({ tempPath }) => fs.rm(tempPath, { force: true }).catch(() => {})));
    await fs.rm(quarantineTemp, { recursive: true, force: true }).catch(() => {});
  }

  if (committed) {
    const cleanupResults = await Promise.allSettled(
      backups.map(({ backupPath }) => fs.rm(backupPath, { force: true })),
    );
    const cleanupErrors = cleanupResults
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason);
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        cleanupErrors,
        `[${plan.slug}] repair committed, but temporary backup cleanup failed`,
      );
    }
  }
}

export async function repairPdfMinuteGroupings(slug, options = {}) {
  const config = REPAIRS[slug];
  if (!config) throw new Error(`unsupported grouping repair slug: ${slug}`);
  const dataRoot = options.dataRoot ?? DEFAULT_DATA_ROOT;
  const write = options.write ?? false;
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const minutesDir = path.join(dataRoot, slug, "minutes");
  const indexPath = path.join(minutesDir, "index.json");
  const indexFile = await readJsonWithRaw(indexPath);
  const sourceCouncils = new Map();
  const originalFiles = new Map([["index.json", indexFile.raw]]);

  for (const sourceId of config.sourceIds) {
    const sourcePath = path.join(minutesDir, `${sourceId}.json`);
    const sourceFile = await readJsonWithRaw(sourcePath);
    sourceCouncils.set(sourceId, sourceFile.value);
    originalFiles.set(`${sourceId}.json`, sourceFile.raw);
  }

  const plan = buildRepairPlan(
    slug,
    config,
    indexFile.value,
    sourceCouncils,
    generatedAt,
  );
  for (const targetId of plan.targetIds) {
    const targetPath = path.join(minutesDir, `${targetId}.json`);
    if (config.sourceIds.includes(targetId) || !(await pathExists(targetPath))) continue;
    throw new Error(`[${slug}] target file collision: minutes/${targetId}.json`);
  }

  if (write) {
    const quarantineDir = path.join(
      dataRoot,
      slug,
      "quarantine",
      "minutes",
      "grouping-repair",
    );
    await writePlanAtomically(plan, minutesDir, quarantineDir, originalFiles);
  }

  return {
    slug,
    dryRun: !write,
    sourceIds: plan.sourceIds,
    targetIds: plan.targetIds,
    mappings: plan.manifest.mappings,
    scheduleCount: plan.manifest.integrity.schedule_count,
    plan,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const unknownOptions = args.filter((arg) => arg.startsWith("--") && arg !== "--write");
  if (unknownOptions.length) throw new Error(`unknown option: ${unknownOptions.join(", ")}`);
  const requested = args.filter((arg) => !arg.startsWith("--"));
  const slugs = requested.length ? requested : Object.keys(REPAIRS);

  for (const slug of slugs) {
    const result = await repairPdfMinuteGroupings(slug, { write });
    console.log(
      `[${slug}] ${write ? "repaired" : "dry-run"}: `
      + `${result.sourceIds.length} source councils -> ${result.targetIds.length} councils / `
      + `${result.scheduleCount} schedules`,
    );
    for (const mapping of result.mappings) {
      console.log(`  ${mapping.old_council_id} -> ${mapping.new_council_ids.join(", ")}`);
    }
  }
  if (!write) console.log("No files changed. Re-run with --write after reviewing the plan.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
