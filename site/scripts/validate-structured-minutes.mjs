#!/usr/bin/env node

import fs from "node:fs/promises";
import { normalizeStructuredMinutes } from "../src/lib/structured-minutes/read-contract.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SITE_ROOT = path.resolve(__dirname, "..");

async function collectJsonFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fp = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await collectJsonFiles(fp)));
    if (entry.isFile() && entry.name.endsWith(".json")) files.push(fp);
  }
  return files;
}

async function main() {
  if (process.argv.includes("--help")) {
    console.log("Usage: node scripts/validate-structured-minutes.mjs [--strict] [--json]\nRead-only legacy audit. Default checks safe readability and reports limitations; --strict fails on any unverified quality. No v2 certification or data writes.");
    return;
  }
  const root = path.join(SITE_ROOT, "data", "structured-minutes");
  const files = await collectJsonFiles(root);
  let failed = false;
  const report = [];
  for (const fp of files) {
    const data = JSON.parse(await fs.readFile(fp, "utf8"));
    const { data: normalized, validation: result } = normalizeStructuredMinutes(data);
    const label = path.relative(SITE_ROOT, fp);
    report.push({ file: label, readable: result.ok, quality: normalized?.read_quality ?? null, errors: result.errors, warning_count: result.warnings.length });
    if (result.ok) {
      if (!process.argv.includes("--json")) console.log(`readable-legacy ${label} ${JSON.stringify(normalized.read_quality)}`);
      if (process.argv.includes("--strict") && result.warnings.length) failed = true;
      continue;
    }
    failed = true;
    if (!process.argv.includes("--json")) {
      console.error(`ng ${label}`);
      for (const error of result.errors) console.error(`  - ${error}`);
    }
  }
  const summary = {
    files: report.length,
    unreadable_files: report.filter((item) => !item.readable).length,
    withheld_topics: report.reduce((sum, item) => sum + (item.quality?.withheld_topic_count ?? 0), 0),
    unknown_date_fields: report.reduce((sum, item) => sum + (item.quality?.unknown_date_count ?? 0), 0),
    turns_without_source_position: report.reduce((sum, item) => sum + (item.quality?.missing_source_position_count ?? 0), 0),
    provenance: "unverified",
    freshness: "unverified",
  };
  console.log(JSON.stringify(process.argv.includes("--json") ? { summary, files: report } : summary, null, 2));
  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
