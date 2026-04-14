#!/usr/bin/env node
/**
 * vocabulary.json の corrections を既存データに一括適用するスクリプト
 * 対象: sessions/*.json, minutes/enriched/*.json
 *
 * 使い方:
 *   node scripts/fix-vocabulary.mjs --city chitose
 *   node scripts/fix-vocabulary.mjs --city chitose --dry-run
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const SITE_ROOT = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
const city = args[args.indexOf("--city") + 1] ?? "chitose";
const dryRun = args.includes("--dry-run");

const vocabPath = path.join(ROOT, "data", city, "vocabulary.json");
if (!fs.existsSync(vocabPath)) {
  console.error(`vocabulary.json not found: ${vocabPath}`);
  process.exit(1);
}
const vocab = JSON.parse(fs.readFileSync(vocabPath, "utf-8"));
const corrections = vocab.corrections ?? [];
if (corrections.length === 0) {
  console.log("補正ルールなし");
  process.exit(0);
}
console.log(`補正ルール: ${corrections.map(c => `${c.wrong}→${c.right}`).join(", ")}`);

function applyCorrections(text) {
  let result = text;
  for (const { wrong, right } of corrections) {
    result = result.replaceAll(wrong, right);
  }
  return result;
}

function fixJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  const fixed = applyCorrections(raw);
  if (raw === fixed) return false;
  if (!dryRun) fs.writeFileSync(filePath, fixed, "utf-8");
  return true;
}

let totalFixed = 0;

// sessions/*.json（両ディレクトリ）
for (const dir of [
  path.join(ROOT, "data", city, "sessions"),
  path.join(SITE_ROOT, "data", city, "sessions"),
]) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".json") && f !== "index.json")) {
    const fp = path.join(dir, f);
    if (fixJsonFile(fp)) {
      console.log(`  ${dryRun ? "[dry]" : "✓"} ${path.relative(ROOT, fp)}`);
      totalFixed++;
    }
  }
}

// minutes/enriched/*.json（両ディレクトリ）
for (const dir of [
  path.join(ROOT, "data", city, "minutes", "enriched"),
  path.join(SITE_ROOT, "data", city, "minutes", "enriched"),
]) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".json"))) {
    const fp = path.join(dir, f);
    if (fixJsonFile(fp)) {
      console.log(`  ${dryRun ? "[dry]" : "✓"} ${path.relative(ROOT, fp)}`);
      totalFixed++;
    }
  }
}

console.log(`\n${dryRun ? "[dry-run] " : ""}${totalFixed}ファイルを修正しました`);
