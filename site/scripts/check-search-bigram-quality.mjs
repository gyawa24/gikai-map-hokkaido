#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { invalidateSearchBuildState } from "./build-search-index.mjs";
import { compactForSearch } from "../src/lib/searchNormalization.mjs";
import {
  searchPostingBucket as bigramBucket,
  searchPostingBucketAssetFile as bigramBucketFile,
} from "../src/lib/searchBigramCandidates.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SITE_DIR = path.resolve(SCRIPT_DIR, "..");
const DATA_DIR = path.join(SITE_DIR, "data");
const PUBLIC_GENERATED_DIR = path.join(SITE_DIR, "public", "generated");
const BIGRAM_DIR = path.join(PUBLIC_GENERATED_DIR, "search-bigram-cities");
const STATEWIDE_BIGRAM_DIR = path.join(PUBLIC_GENERATED_DIR, "search-bigram-statewide");
const CASES_FILE = path.join(DATA_DIR, "search_quality_cases.json");

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (fallback !== undefined) return fallback;
    throw error;
  }
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

function trigrams(text) {
  const compact = compactForSearch(text);
  if (compact.length < 3) return [];
  const terms = [];
  for (let i = 0; i < compact.length - 2; i += 1) {
    terms.push(compact.slice(i, i + 3));
  }
  return terms;
}

function candidateNgrams(text) {
  const compact = compactForSearch(text);
  return compact.length >= 3 ? trigrams(compact) : bigrams(compact);
}

function queryTerms(query, exactTerms = []) {
  const exactTermSet = new Set(exactTerms);
  return Array.from(
    new Set(
      String(query ?? "")
        .trim()
        .split(/\s+/)
        .flatMap((token) => {
          const normalized = compactForSearch(token);
          return exactTermSet.has(normalized) ? [normalized] : candidateNgrams(normalized);
        })
    )
  );
}


function readUnsignedPostingVarint(buffer, state) {
  let value = 0;
  let multiplier = 1;
  while (state.offset < buffer.length) {
    const byte = buffer[state.offset];
    state.offset += 1;
    value += (byte & 0x7f) * multiplier;
    if ((byte & 0x80) === 0) return value;
    multiplier *= 128;
  }
    throw new Error("検索postingが途中で切れています");
}

function postingDocumentIds(value, postingValueEncoding) {
  if (Array.isArray(value) && value.length === 0) return [];
  if (typeof value !== "string" || postingValueEncoding !== "delta-varint-v1") {
    throw new Error("postingが壊れています");
  }
  const buffer = Buffer.from(value, "base64");
  const state = { offset: 0 };
  const documentIds = [];
  let previousDocumentId = -1;
  while (state.offset < buffer.length) {
    const delta = readUnsignedPostingVarint(buffer, state);
    if (delta <= 0) throw new Error("posting差分が壊れています");
    const documentId = previousDocumentId + delta;
    documentIds.push(documentId);
    previousDocumentId = documentId;
  }
  return documentIds;
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

function matchScore(text, terms) {
  const compact = compactForSearch(text);
  return terms.reduce((score, term) => score + (compact.includes(term) ? 1 : 0), 0);
}

const payloadCache = new Map();

function readGeneratedUrl(url) {
  if (!payloadCache.has(url)) {
    const filePath = path.join(PUBLIC_GENERATED_DIR, url.replace(/^\/generated\//, ""));
    const buffer = fs.readFileSync(filePath);
    payloadCache.set(
      url,
      JSON.parse(
        filePath.endsWith(".gz")
          ? zlib.gunzipSync(buffer).toString("utf8")
          : buffer.toString("utf8")
      )
    );
  }
  return payloadCache.get(url);
}

function payloadValue(manifest, rangesKey, urlKey, documentId) {
  const range = manifest[rangesKey]?.find(
    (candidate) => documentId >= candidate.start && documentId < candidate.end
  );
  if (!range) throw new Error(`${manifest.city}: ${rangesKey} が文書 ${documentId} を含みません`);
  const payload = readGeneratedUrl(range[urlKey]);
  if (!Array.isArray(payload) || payload.length < range.payload_end) {
    throw new Error(`${range[urlKey]} が壊れています`);
  }
  return payload[range.payload_start + documentId - range.start];
}

const exactTextBlockCache = new Map();

function exactEvidenceValue(manifest, documentId) {
  const range = manifest.exact_text_ranges?.find(
    (candidate) => documentId >= candidate.start && documentId < candidate.end
  );
  if (!range) throw new Error(`${manifest.city}: exact_text_ranges が文書 ${documentId} を含みません`);
  const key = `${range.exact_text_url}:${range.byte_start}:${range.byte_length}`;
  if (!exactTextBlockCache.has(key)) {
    const filePath = path.join(
      PUBLIC_GENERATED_DIR,
      range.exact_text_url.replace(/^\/generated\//, "")
    );
    const file = fs.openSync(filePath, "r");
    const compressed = Buffer.allocUnsafe(range.byte_length);
    try {
      const bytesRead = fs.readSync(file, compressed, 0, compressed.length, range.byte_start);
      if (bytesRead !== compressed.length) throw new Error(`${range.exact_text_url} が途中で切れています`);
    } finally {
      fs.closeSync(file);
    }
    const raw = zlib.gunzipSync(compressed);
    if (raw.length !== range.raw_bytes) throw new Error(`${range.exact_text_url} が壊れています`);
    const values = JSON.parse(raw.toString("utf8"));
    if (
      !Array.isArray(values)
      || values.length !== range.end - range.start
      || !values.every((value) => typeof value === "string")
    ) {
      throw new Error(`${range.exact_text_url} が壊れています`);
    }
    exactTextBlockCache.set(key, values);
  }
  return exactTextBlockCache.get(key)[documentId - range.start];
}

function exactSearchText(doc, evidenceText) {
  if (doc.source !== "member_activity") return evidenceText;
  return [
    doc.cityName,
    doc.member_name,
    doc.title,
    doc.committee,
    doc.label,
    doc.metaText,
    evidenceText,
  ].filter(Boolean).join(" ");
}

function loadBigramCity(city) {
  const cityDir = path.join(BIGRAM_DIR, city);
  const manifestPath = path.join(cityDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) return null;
  const manifest = readJson(manifestPath);
  if (!Array.isArray(manifest.document_ranges) || !Array.isArray(manifest.exact_text_ranges)) {
    throw new Error(`document range manifest が壊れています: ${city}`);
  }
  return { city, cityDir, manifest };
}

function searchBigramCity(cityData, query, operator) {
  const terms = queryTerms(query, cityData.manifest.exact_terms);
  if (terms.length === 0) return [];
  const postingsByTerm = new Map();
  const bucketFiles = Array.from(new Set(terms.map((term) => bigramBucketFile(bigramBucket(term)))));

  for (const file of bucketFiles) {
    const bucketPath = path.join(STATEWIDE_BIGRAM_DIR, "postings", file);
    const bucketBuffer = fs.readFileSync(bucketPath);
    const postings = JSON.parse(zlib.gunzipSync(bucketBuffer).toString("utf8"));
    for (const term of terms) {
      if (postings[term]?.[cityData.city]) {
        postingsByTerm.set(
          term,
          postingDocumentIds(
            postings[term][cityData.city],
            cityData.manifest.posting_value_encoding
          )
        );
      }
    }
  }

  const lists = terms.map((term) => postingsByTerm.get(term) ?? []);
  if (lists.some((list) => list.length === 0)) return [];
  const candidateIds = operator === "or"
    ? union(lists)
    : lists.slice(1).reduce((acc, list) => intersect(acc, list), lists[0] ?? []);

  return candidateIds
    .map((index) => {
      const doc = payloadValue(cityData.manifest, "document_ranges", "documents_url", index);
      const evidenceText = exactEvidenceValue(cityData.manifest, index);
      return {
        ...doc,
        _exactEvidenceText: evidenceText,
        _exactSearchText: exactSearchText(doc, evidenceText),
      };
    })
    .filter((doc) => {
      const normalized = compactForSearch(doc._exactSearchText);
      const tokenMatches = String(query ?? "")
        .trim()
        .split(/\s+/)
        .map(compactForSearch)
        .filter(Boolean)
        .map((token) => normalized.includes(token));
      return operator === "or" ? tokenMatches.some(Boolean) : tokenMatches.every(Boolean);
    })
    .map((doc) => ({ ...doc, score: matchScore(doc._exactSearchText, terms) }))
    .sort((a, b) => b.score - a.score || String(a.title).localeCompare(String(b.title), "ja"));
}

function documentMatchesExpected(doc, expected) {
  if (expected.source && doc.source !== expected.source) return false;
  if (expected.council_id && Number(doc.council_id) !== Number(expected.council_id)) return false;
  if (expected.member_name && compactForSearch(doc.member_name) !== compactForSearch(expected.member_name)) return false;
  if (expected.source_status && doc.source_status !== expected.source_status) return false;
  if (expected.session_id && doc.session_id !== expected.session_id) return false;
  if (
    Object.hasOwn(expected, "segment_index")
    && Number(doc.segment_index) !== Number(expected.segment_index)
  ) return false;
  const text = doc.source === "member_activity"
    ? doc._exactEvidenceText
    : doc._exactSearchText || documentText(doc);
  for (const included of expected.textIncludes ?? []) {
    const normalizedIncluded = compactForSearch(included);
    if (compactForSearch(text).includes(normalizedIncluded)) continue;
    if (
      (included === "公式会議録" || included === "動画会議録速報")
      && compactForSearch([doc.label, doc.metaText].filter(Boolean).join(" ")).includes(normalizedIncluded)
    ) {
      continue;
    }
    return false;
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
    if (
      testCase.expected?.source === "session"
      && (
        !testCase.expected.session_id
        || !Object.hasOwn(testCase.expected, "segment_index")
        || testCase.expected.segment_index === null
        || !Number.isInteger(Number(testCase.expected.segment_index))
      )
    ) {
      throw new Error(`${testCase.id}: session品質ケースにはsession_idとsegment_indexが必要です`);
    }

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

  if (!ok) {
    invalidateSearchBuildState();
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  invalidateSearchBuildState();
  throw error;
}
