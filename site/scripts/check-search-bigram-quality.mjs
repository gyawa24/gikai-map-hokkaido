#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SITE_DIR = path.resolve(SCRIPT_DIR, "..");
const DATA_DIR = path.join(SITE_DIR, "data");
const PUBLIC_GENERATED_DIR = path.join(SITE_DIR, "public", "generated");
const BIGRAM_DIR = path.join(PUBLIC_GENERATED_DIR, "search-bigram-cities");
const CASES_FILE = path.join(DATA_DIR, "search_quality_cases.json");
const BIGRAM_BUCKET_COUNT = 64;

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (fallback !== undefined) return fallback;
    throw error;
  }
}

function normalizeForSearch(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .replace(/\u3000/g, " ")
    .replace(/[ァ-ヶ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60))
    .toLowerCase()
    .trim();
}

function compactForSearch(text) {
  return normalizeForSearch(text).replace(/[^\p{L}\p{N}]+/gu, "");
}

function bigrams(text) {
  const compact = compactForSearch(text);
  if (!compact) return [];
  if (compact.length === 1) return [compact];
  const terms = [];
  for (let i = 0; i < compact.length - 1; i += 1) {
    terms.push(compact.slice(i, i + 2));
  }
  return Array.from(new Set(terms));
}

function queryTerms(query) {
  return Array.from(
    new Set(
      String(query ?? "")
        .trim()
        .split(/\s+/)
        .flatMap((token) => bigrams(token))
    )
  );
}

function bigramBucket(term) {
  let hash = 0;
  for (let i = 0; i < term.length; i += 1) {
    hash = ((hash * 31) + term.charCodeAt(i)) >>> 0;
  }
  return hash % BIGRAM_BUCKET_COUNT;
}

function bigramBucketFile(bucket) {
  return `${bucket.toString(16).padStart(2, "0")}.json`;
}

function intersect(left, right) {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
}

function union(arrays) {
  return Array.from(new Set(arrays.flat()));
}

function documentText(doc) {
  return [
    doc.cityName,
    doc.title,
    doc.body,
    doc.context,
    doc.metaText,
    doc.member_name,
    doc.name,
    doc.furigana,
    doc.party,
    doc.faction,
    ...(doc.committees ?? []),
  ].filter(Boolean).join(" ");
}

function matchScore(doc, terms) {
  const compact = compactForSearch(documentText(doc));
  return terms.reduce((score, term) => score + (compact.includes(term) ? 1 : 0), 0);
}

function loadBigramCity(city) {
  const cityDir = path.join(BIGRAM_DIR, city);
  const manifestPath = path.join(cityDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) return null;
  const manifest = readJson(manifestPath);
  const documents = readJson(path.join(cityDir, "documents.json"));
  if (!Array.isArray(documents)) {
    throw new Error(`documents.json が壊れています: ${city}`);
  }
  return { cityDir, manifest, documents };
}

function searchBigramCity(cityData, query, operator) {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  const postingsByTerm = new Map();
  const bucketFiles = Array.from(new Set(terms.map((term) => bigramBucketFile(bigramBucket(term)))));

  for (const file of bucketFiles) {
    const bucketPath = path.join(cityData.cityDir, "postings", file);
    const postings = readJson(bucketPath, {});
    for (const term of terms) {
      if (postings[term]) postingsByTerm.set(term, postings[term]);
    }
  }

  const lists = terms.map((term) => postingsByTerm.get(term) ?? []);
  if (lists.some((list) => list.length === 0)) return [];
  const candidateIds = operator === "or"
    ? union(lists)
    : lists.slice(1).reduce((acc, list) => intersect(acc, list), lists[0] ?? []);

  return candidateIds
    .map((index) => cityData.documents[index])
    .filter(Boolean)
    .map((doc) => ({ ...doc, score: matchScore(doc, terms) }))
    .sort((a, b) => b.score - a.score || String(a.title).localeCompare(String(b.title), "ja"));
}

function documentMatchesExpected(doc, expected) {
  if (expected.source && doc.source !== expected.source) return false;
  if (expected.council_id && Number(doc.council_id) !== Number(expected.council_id)) return false;
  if (expected.member_name && compactForSearch(doc.member_name) !== compactForSearch(expected.member_name)) return false;
  const text = documentText(doc);
  for (const included of expected.textIncludes ?? []) {
    if (!compactForSearch(text).includes(compactForSearch(included))) return false;
  }
  return true;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { ids: new Set(), city: "", json: false };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--id") {
      options.ids.add(args[i + 1]);
      i += 1;
    } else if (arg === "--city") {
      options.city = args[i + 1] ?? "";
      i += 1;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/check-search-bigram-quality.mjs [--id CASE_ID] [--city SLUG] [--json]");
      process.exit(0);
    } else {
      throw new Error(`未知の引数です: ${arg}`);
    }
  }
  return options;
}

function main() {
  if (!fs.existsSync(BIGRAM_DIR)) {
    throw new Error("bigram検索索引が見つかりません。先に npm run build-search-index を実行してください。");
  }

  const options = parseArgs();
  const cases = readJson(CASES_FILE);
  const results = [];
  const skipped = [];

  for (const testCase of cases) {
    if (options.ids.size > 0 && !options.ids.has(testCase.id)) continue;
    if (options.city && testCase.city !== options.city) continue;

    const cityData = loadBigramCity(testCase.city);
    if (!cityData) {
      skipped.push({ id: testCase.id, city: testCase.city, reason: "bigram対象外" });
      continue;
    }

    const matches = searchBigramCity(cityData, testCase.query, testCase.operator === "or" ? "or" : "and");
    const expectedHit = matches.find((doc) => documentMatchesExpected(doc, testCase.expected ?? {}));
    results.push({
      id: testCase.id,
      city: testCase.city,
      query: testCase.query,
      ok: Boolean(expectedHit),
      expected: testCase.expected,
      hit: expectedHit
        ? {
            source: expectedHit.source,
            council_id: expectedHit.council_id ?? null,
            member_name: expectedHit.member_name ?? null,
            title: expectedHit.title,
          }
        : null,
      top: matches.slice(0, 3).map((doc) => ({
        source: doc.source,
        council_id: doc.council_id ?? null,
        member_name: doc.member_name ?? null,
        title: doc.title,
        score: doc.score,
      })),
      manifest: path.relative(PUBLIC_GENERATED_DIR, path.join(cityData.cityDir, "manifest.json")),
    });
  }

  if (results.length === 0) {
    throw new Error("対象のbigram検索品質ケースがありません。");
  }

  const ok = results.every((result) => result.ok);
  if (options.json) {
    console.log(JSON.stringify({ ok, results, skipped }, null, 2));
  } else {
    for (const result of results) {
      console.log(`${result.ok ? "PASS" : "FAIL"} ${result.id}: ${result.query}`);
      if (result.hit) {
        console.log(`  hit: ${result.hit.source} ${result.hit.title}`);
      } else {
        console.log(`  top: ${result.top.map((row) => `${row.source} ${row.title}`).join(" / ") || "(none)"}`);
      }
    }
    if (skipped.length > 0) {
      console.log(`\nskipped: ${skipped.length} cases without bigram city index`);
    }
    console.log(`\nbigram search quality: ${results.filter((result) => result.ok).length}/${results.length} passed`);
  }

  if (!ok) process.exitCode = 1;
}

main();
