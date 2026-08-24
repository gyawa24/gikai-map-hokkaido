#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildMemberIndex,
  matchMember,
} from "./build-segments.mjs";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

async function writePlansAtomically(plans) {
  const staged = [];
  const backups = [];
  try {
    for (const plan of plans) {
      const tempPath = path.join(
        path.dirname(plan.targetPath),
        `.${path.basename(plan.targetPath)}.${process.pid}.tmp`,
      );
      await fs.writeFile(tempPath, plan.contents, "utf8");
      staged.push({ tempPath, targetPath: plan.targetPath });
    }
    for (const plan of staged) {
      const backupPath = `${plan.targetPath}.${process.pid}.bak`;
      await fs.rename(plan.targetPath, backupPath);
      backups.push({ backupPath, targetPath: plan.targetPath });
      await fs.rename(plan.tempPath, plan.targetPath);
    }
  } catch (error) {
    for (const { backupPath, targetPath } of backups.reverse()) {
      await fs.rm(targetPath, { force: true });
      await fs.rename(backupPath, targetPath);
    }
    throw error;
  } finally {
    await Promise.all(staged.map(({ tempPath }) => fs.rm(tempPath, { force: true })));
    await Promise.all(backups.map(({ backupPath }) => fs.rm(backupPath, { force: true })));
  }
}

function sameAttribution(row, expected) {
  return (row.member_name ?? null) === (expected?.name ?? null);
}

export async function repairMunicipalityMemberAttributions(slug, options = {}) {
  const dataRoot = options.dataRoot ?? path.join(PROJECT_ROOT, "data");
  const write = options.write ?? false;
  const cityDir = path.join(dataRoot, slug);
  const minutesIndexPath = path.join(cityDir, "minutes", "index.json");
  const membersPath = path.join(cityDir, "members.json");
  const segmentsDir = path.join(cityDir, "segments");
  const segmentIndexPath = path.join(segmentsDir, "_index.json");

  if (
    !(await pathExists(minutesIndexPath))
    || !(await pathExists(membersPath))
    || !(await pathExists(segmentIndexPath))
  ) {
    return { slug, skipped: true, changedSegments: 0, changedIndexEntries: 0 };
  }

  const publicationIndex = await readJson(minutesIndexPath);
  if (!Array.isArray(publicationIndex)) {
    throw new Error(`[${slug}] minutes/index.json must be an array`);
  }
  const publishedCouncilIds = new Set(
    publicationIndex.map((entry) => String(entry.council_id ?? entry.id ?? "")),
  );
  const memberIndex = buildMemberIndex(await readJson(membersPath));
  const expectedBySegmentId = new Map();
  let changedSegments = 0;
  let changedFiles = 0;
  const writePlans = [];

  for (const councilId of publishedCouncilIds) {
    if (!councilId) continue;
    const segmentPath = path.join(segmentsDir, `${councilId}.json`);
    if (!(await pathExists(segmentPath))) continue;
    const segments = await readJson(segmentPath);
    if (!Array.isArray(segments)) {
      throw new Error(`[${slug}] segments/${councilId}.json must be an array`);
    }

    let fileChanged = false;
    for (const segment of segments) {
      const expected = matchMember(segment.speaker, memberIndex, segment.text);
      const segmentId = String(segment.id ?? "");
      if (!segmentId || expectedBySegmentId.has(segmentId)) {
        throw new Error(`[${slug}] duplicate or missing published segment id: ${segmentId || "missing"}`);
      }
      expectedBySegmentId.set(segmentId, expected);
      if (sameAttribution(segment, expected)) continue;
      segment.member_name = expected?.name ?? null;
      changedSegments += 1;
      fileChanged = true;
    }

    if (fileChanged) writePlans.push({
      targetPath: segmentPath,
      contents: `${JSON.stringify(segments, null, 2)}\n`,
    });
    if (fileChanged) changedFiles += 1;
  }

  const segmentIndex = await readJson(segmentIndexPath);
  if (!Array.isArray(segmentIndex)) {
    throw new Error(`[${slug}] segments/_index.json must be an array`);
  }
  const seenIndexIds = new Set();
  let changedIndexEntries = 0;
  for (const entry of segmentIndex) {
    const entryId = String(entry.id ?? "");
    if (!entryId || seenIndexIds.has(entryId)) {
      throw new Error(`[${slug}] duplicate or missing segment index id: ${entryId || "missing"}`);
    }
    seenIndexIds.add(entryId);
    const expected = expectedBySegmentId.get(entryId);
    if (!expectedBySegmentId.has(entryId) || sameAttribution(entry, expected)) continue;
    entry.member_name = expected?.name ?? null;
    changedIndexEntries += 1;
  }
  for (const segmentId of expectedBySegmentId.keys()) {
    if (!seenIndexIds.has(segmentId)) {
      throw new Error(`[${slug}] published segment is missing from _index.json: ${segmentId}`);
    }
  }

  if (changedSegments !== changedIndexEntries) {
    throw new Error(
      `[${slug}] segment/index attribution mismatch: segments=${changedSegments}, index=${changedIndexEntries}`,
    );
  }
  if (changedIndexEntries > 0) writePlans.push({
    targetPath: segmentIndexPath,
    contents: `${JSON.stringify(segmentIndex, null, 2)}\n`,
  });
  if (write && writePlans.length > 0) await writePlansAtomically(writePlans);

  return {
    slug,
    skipped: false,
    changedSegments,
    changedIndexEntries,
    changedFiles,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const requestedSlugs = args.filter((arg) => !arg.startsWith("--"));
  const slugs = requestedSlugs.length > 0
    ? requestedSlugs
    : (await fs.readdir(path.join(PROJECT_ROOT, "data"), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

  let changedSegments = 0;
  let changedCities = 0;
  for (const slug of slugs) {
    const result = await repairMunicipalityMemberAttributions(slug, { write });
    if (result.changedSegments === 0) continue;
    changedSegments += result.changedSegments;
    changedCities += 1;
    console.log(
      `[${slug}] ${result.changedSegments} member attributions ${write ? "repaired" : "need repair"}`,
    );
  }
  console.log(
    `${write ? "Repaired" : "Found"} ${changedSegments} member attributions across ${changedCities} municipalities${write ? "" : " (dry run)"}.`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
