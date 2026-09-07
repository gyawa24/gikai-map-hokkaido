#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deriveCouncilRecordRevisionContent, validateCouncilRecordV2 } from "./lib/council-record-v2-validation.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function loadRevisionContents(record, repoRoot = REPO_ROOT) {
  const contents = new Map();
  const root = await fs.realpath(repoRoot);
  for (const source of record.source_artifacts ?? []) {
    for (const revision of source.revisions ?? []) {
      if (!revision.snapshot_path) continue;
      const snapshot = path.resolve(root, revision.snapshot_path);
      if (!snapshot.startsWith(`${root}${path.sep}`)) throw new Error(`snapshot outside repository: ${revision.id}`);
      const real = await fs.realpath(snapshot);
      if (!real.startsWith(`${root}${path.sep}`)) throw new Error(`snapshot symlink outside repository: ${revision.id}`);
      const bytes = await fs.readFile(real);
      const content = deriveCouncilRecordRevisionContent(source, bytes);
      contents.set(revision.id, content);
    }
  }
  return contents;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.length === 0) {
    console.log("Usage: node scripts/validate-council-record-v2.mjs <record.json> [--previous <record.json>] [--strict]\nOffline internal-preview verification only. Reads snapshots; never fetches or modifies data. --strict also fails on unverifiable evidence.");
    return;
  }
  const recordPath = args.shift();
  let previousRecord;
  let strict = false;
  while (args.length) {
    const arg = args.shift();
    if (arg === "--strict") strict = true;
    else if (arg === "--previous" && args[0]) previousRecord = JSON.parse(await fs.readFile(args.shift(), "utf8"));
    else throw new Error(`unknown or incomplete option: ${arg}`);
  }
  const record = JSON.parse(await fs.readFile(recordPath, "utf8"));
  const municipalities = JSON.parse(await fs.readFile(path.join(REPO_ROOT, "data", "municipalities.json"), "utf8"));
  const municipality = municipalities.find((item) => item.slug === record.municipality_id);
  const shape = validateCouncilRecordV2(record, { previousRecord, municipality });
  if (shape.errors.some((item) => item.gate === "schema")) {
    console.log(JSON.stringify(shape, null, 2)); process.exitCode = 1; return;
  }
  if (record.publication.state !== "internal_preview" || record.publication.public_visible) throw new Error("this pilot CLI accepts internal_preview/public_visible:false only");
  const revisionContents = await loadRevisionContents(record);
  const result = validateCouncilRecordV2(record, { previousRecord, revisionContents, municipality });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok || (strict && result.warnings.length > 0)) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
