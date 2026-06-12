#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const MUNICIPALITIES_PATH = path.join(REPO_ROOT, "data", "municipalities.json");

// 統一地方選の対象期間は、地方公共団体の長及び議会の議員の任期満了による
// 選挙期日等の臨時特例に関する法律で毎回定まるため、2027年向けの運用定数として持つ。
const UNIFIED_LOCAL_ELECTION_2027_START = "2027-03-01";
const UNIFIED_LOCAL_ELECTION_2027_END = "2027-05-31";

function compareDateText(a, b) {
  return a.localeCompare(b);
}

function isInRange(dateText, startText, endText) {
  return compareDateText(dateText, startText) >= 0 && compareDateText(dateText, endText) <= 0;
}

function monthKey(dateText) {
  return dateText.slice(0, 7);
}

function formatMunicipality(row) {
  return `${row.name} (${row.slug}) ${row.council_term_end}`;
}

async function main() {
  const rows = JSON.parse(await fs.readFile(MUNICIPALITIES_PATH, "utf8"));
  const municipalities = rows
    .filter((row) => row.active && row.level === "municipality")
    .sort((a, b) => a.slug.localeCompare(b.slug));
  const entered = municipalities.filter((row) => typeof row.council_term_end === "string" && row.council_term_end);
  const missing = municipalities.filter((row) => !row.council_term_end);
  const unifiedTargets = entered
    .filter((row) =>
      isInRange(row.council_term_end, UNIFIED_LOCAL_ELECTION_2027_START, UNIFIED_LOCAL_ELECTION_2027_END)
    )
    .sort((a, b) => a.council_term_end.localeCompare(b.council_term_end) || a.name.localeCompare(b.name, "ja"));
  const monthlyDistribution = new Map();

  for (const row of entered) {
    const key = monthKey(row.council_term_end);
    monthlyDistribution.set(key, (monthlyDistribution.get(key) ?? 0) + 1);
  }

  console.log("# election term report");
  console.log(`source: data/municipalities.json`);
  console.log(`municipal councils: ${municipalities.length}`);
  console.log(`entered: ${entered.length}`);
  console.log(`missing: ${missing.length}`);

  console.log("");
  console.log(`## unified local election 2027 candidates`);
  console.log(`window: ${UNIFIED_LOCAL_ELECTION_2027_START} to ${UNIFIED_LOCAL_ELECTION_2027_END}`);
  console.log(`count: ${unifiedTargets.length}`);
  if (unifiedTargets.length) {
    for (const row of unifiedTargets) {
      console.log(`- ${formatMunicipality(row)}`);
    }
  } else {
    console.log("- none");
  }

  console.log("");
  console.log("## monthly distribution");
  if (monthlyDistribution.size) {
    for (const [key, count] of [...monthlyDistribution.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      console.log(`- ${key}: ${count}`);
    }
  } else {
    console.log("- none");
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
