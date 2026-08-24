#!/usr/bin/env node
// Static Assets だけで全道の議事録全文を検索する索引を生成する。
//
// 本文候補は2-gram・3-gramの文書単位delta postingで絞り込む。
// 2/3文字と専用exact postingは候補時点で確定し、その他はgzip memberを
// Range取得して原文を再確認する。候補過多は取得前にfail-closedにする。
// 表示用文書・posting・原文ブロックは分離し、1 asset 24MiB、
// generated全体16,500 files / 750MiBのgate内に収める。
// 1文字検索は取得前に拒否し、非Cloudflare server modeはdataの索引を直接読む。
//
// 実行: `npm run build-search-index` または `npm run build` の prebuild で自動実行

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { SEARCH_EXACT_POSTING_TERMS } from "../src/lib/searchExactPostingTerms.mjs";
import { compactForSearch } from "../src/lib/searchNormalization.mjs";
import {
  SEARCH_POSTING_BUCKET_COUNT,
  searchPostingBucket as bigramBucket,
  searchPostingBucketFile as bigramBucketFile,
} from "../src/lib/searchBigramCandidates.mjs";

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const __dirname = path.dirname(SCRIPT_FILE);
const SITE_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(SITE_DIR, "data");
const SOURCE_DATA_DIR = path.resolve(SITE_DIR, "..", "data");
const OUT_FILE = path.join(DATA_DIR, "_search-index.json");
const PUBLIC_GENERATED_DIR = path.join(SITE_DIR, "public", "generated");
const PUBLIC_SEARCH_INDEX_FILE = path.join(PUBLIC_GENERATED_DIR, "search-index.json");
const PUBLIC_RESEARCH_COVERAGE_FILE = path.join(PUBLIC_GENERATED_DIR, "research-coverage.json");
const PUBLIC_CITY_SEARCH_INDEX_DIR = path.join(PUBLIC_GENERATED_DIR, "search-indexes");
const LEGACY_PUBLIC_RECENT_SEARCH_INDEX_FILE = path.join(PUBLIC_GENERATED_DIR, "search-index-recent.json");
const LEGACY_PUBLIC_SEARCH_INDEX_SHARDS_DIR = path.join(PUBLIC_GENERATED_DIR, "search-index-shards");
const PUBLIC_CITY_BIGRAM_INDEX_DIR = path.join(PUBLIC_GENERATED_DIR, "search-bigram-cities");
const PUBLIC_STATEWIDE_BIGRAM_INDEX_DIR = path.join(PUBLIC_GENERATED_DIR, "search-bigram-statewide");
const PUBLIC_MEMBER_ACTIVITY_DIR = path.join(PUBLIC_GENERATED_DIR, "member-activity");
const PUBLIC_TOPICS_INDEX_FILE = path.join(PUBLIC_GENERATED_DIR, "topics-index.json");
const PUBLIC_SEARCH_BUILD_STATE_FILE = path.join(PUBLIC_GENERATED_DIR, "search-build-state.json");
const SEGMENT_FALLBACKS_FILE = path.join(DATA_DIR, "search_segment_fallbacks.json");

const AGENDA_MARKER = "△議題";
const DISCUSSION_TYPES = new Set([
  "◆質問",
  "◎答弁",
  "◎市長",
  "○一般質問",
]);
const RAW_MINUTE_EXCLUDED_TYPES = /^(?:名簿|手続|議事手続|会議手続)$/u;
const RAW_MINUTE_SUBSTANTIVE_MARKERS = /(?:◆質問|◎答弁|○議長|○一般質問|これより[、,]?\s*採決|お答えいたします|質問いたします)/u;
const EXCERPT_MAX = 400;
const FULL_SEARCH_TEXT = Symbol("fullSearchText");
const MEMBER_ACTIVITY_SEARCH_TEXT = Symbol("memberActivitySearchText");
const POSTING_BATCH_DOCUMENTS = 64;
const EXACT_POSTING_TERMS = Object.freeze(
  Array.from(new Set([
    "一般質問",
    "代表質問",
    "委員会質疑",
    "本会議質疑",
    "道路整備",
    "地域活性化",
    ...SEARCH_EXACT_POSTING_TERMS,
  ].map(compactForSearch).filter((term) => term.length > 2)))
);
const BIGRAM_DOCUMENT_RANGE_TARGET_BYTES = 4 * 1024 * 1024;
const BIGRAM_DOCUMENT_RANGE_MAX_DOCUMENTS = 4096;
const EXACT_TEXT_ASSET_TARGET_BYTES = 20 * 1024 * 1024;
const EXACT_TEXT_BLOCK_TARGET_BYTES = 128 * 1024;
const EXACT_TEXT_BLOCK_MAX_DOCUMENTS = 64;
const STATIC_ASSET_MAX_BYTES = 24 * 1024 * 1024;
const CITY_SEARCH_MANIFEST_MAX_BYTES = 512 * 1024;
const STATEWIDE_SEARCH_MANIFEST_MAX_BYTES = 2 * 1024 * 1024;
const GENERATED_ASSET_MAX_FILES = 16_500;
const GENERATED_ASSET_MAX_BYTES = 750 * 1024 * 1024;
const POSTING_SPOOL_MAX_BYTES = 8 * 1024 * 1024 * 1024;
export const POSTING_SPOOL_OPEN_HANDLE_LIMIT = 64;

export function addSearchAssetCatalogEntry(assetCatalog, key, entry) {
  if (Object.hasOwn(assetCatalog, key)) {
    throw new Error(`duplicate search asset catalog key: ${key}`);
  }
  assetCatalog[key] = entry;
}
const SEARCH_BUILD_STATE_VERSION = 1;

function formatMiB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

function sha256(text) {
  return createHash("sha256").update(String(text ?? "")).digest("hex");
}

function assertStaticAssetSize(filePath) {
  const bytes = fs.statSync(filePath).size;
  if (bytes > STATIC_ASSET_MAX_BYTES) {
    throw new Error(
      `static asset exceeds ${formatMiB(STATIC_ASSET_MAX_BYTES)}: ${filePath.replace(SITE_DIR, "site")} (${formatMiB(bytes)})`
    );
  }
  return bytes;
}

function staticAssetTreeStats(rootDir) {
  const stats = { files: 0, bytes: 0 };
  if (!fs.existsSync(rootDir)) return stats;
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(entryPath);
      else if (entry.isFile()) {
        stats.files += 1;
        stats.bytes += assertStaticAssetSize(entryPath);
      }
    }
  }
  return stats;
}

function assertStaticAssetTree(rootDir) {
  const stats = staticAssetTreeStats(rootDir);
  if (stats.files > GENERATED_ASSET_MAX_FILES) {
    throw new Error(
      `generated static asset count exceeds ${GENERATED_ASSET_MAX_FILES.toLocaleString()}: ${stats.files.toLocaleString()}`
    );
  }
  if (stats.bytes > GENERATED_ASSET_MAX_BYTES) {
    throw new Error(
      `generated static asset bytes exceed ${formatMiB(GENERATED_ASSET_MAX_BYTES)}: ${formatMiB(stats.bytes)}`
    );
  }
  return stats;
}

function walkInputFiles(rootDir, accept = () => true) {
  if (!fs.existsSync(rootDir)) return [];
  const files = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(entryPath);
      else if (entry.isFile() && accept(entryPath)) files.push(entryPath);
    }
  }
  return files;
}

export function searchIndexInputFiles() {
  const files = [
    SCRIPT_FILE,
    path.join(SITE_DIR, "src", "lib", "searchBigramCandidates.mjs"),
    path.join(SITE_DIR, "src", "lib", "searchExactPostingTerms.mjs"),
    path.join(SITE_DIR, "src", "lib", "searchNormalization.mjs"),
    path.join(SITE_DIR, "src", "lib", "searchSynonyms.ts"),
    path.join(DATA_DIR, "municipalities.json"),
    SEGMENT_FALLBACKS_FILE,
  ];
  for (const entry of fs.readdirSync(DATA_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
    const cityDir = path.join(DATA_DIR, entry.name);
    for (const directory of ["minutes", "segments", "sessions"]) {
      files.push(...walkInputFiles(path.join(cityDir, directory), (filePath) => filePath.endsWith(".json")));
    }
    for (const file of ["members.json", "members_activity.json", "election.json", "decisions.json"]) {
      const filePath = path.join(cityDir, file);
      if (fs.existsSync(filePath)) files.push(filePath);
    }
  }
  files.push(...walkInputFiles(
    path.join(DATA_DIR, "structured-minutes"),
    (filePath) => filePath.endsWith(".json")
  ));
  for (const entry of fs.readdirSync(SOURCE_DATA_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
    files.push(...walkInputFiles(
      path.join(SOURCE_DATA_DIR, entry.name, "segments"),
      (filePath) => filePath.endsWith(".json")
    ));
  }
  return Array.from(new Set(files.filter((filePath) => fs.existsSync(filePath)))).sort();
}

export function fingerprintSearchInputMetadata(entries) {
  const hash = createHash("sha256");
  for (const entry of entries) {
    hash.update(`${entry.path}\0${entry.size}\0${entry.mtimeMs}\n`);
  }
  return hash.digest("hex");
}

export function computeSearchIndexInputFingerprint() {
  return fingerprintSearchInputMetadata(searchIndexInputFiles().map((filePath) => {
    const stat = fs.statSync(filePath);
    return {
      path: path.relative(path.resolve(SITE_DIR, ".."), filePath),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    };
  }));
}

export function searchIndexBuildStateIsFresh({
  inputFingerprint,
  buildState,
  statewideManifest,
  assetExists,
}) {
  return Boolean(
    buildState?.version === SEARCH_BUILD_STATE_VERSION
    && buildState.input_fingerprint === inputFingerprint
    && statewideManifest?.version === 5
    && statewideManifest?.generated_at === buildState.generated_at
    && Array.isArray(buildState.required_assets)
    && buildState.required_assets.length > 0
    && buildState.required_assets.every((assetPath) => assetExists(assetPath))
  );
}

function searchIndexOwnedAssets() {
  const roots = [
    OUT_FILE,
    PUBLIC_SEARCH_INDEX_FILE,
    PUBLIC_RESEARCH_COVERAGE_FILE,
    PUBLIC_TOPICS_INDEX_FILE,
    PUBLIC_CITY_SEARCH_INDEX_DIR,
    PUBLIC_CITY_BIGRAM_INDEX_DIR,
    PUBLIC_STATEWIDE_BIGRAM_INDEX_DIR,
    PUBLIC_MEMBER_ACTIVITY_DIR,
  ];
  return roots.flatMap((root) => {
    if (!fs.existsSync(root)) return [];
    if (fs.statSync(root).isFile()) return [root];
    return walkInputFiles(root);
  }).map((filePath) => path.relative(SITE_DIR, filePath)).sort();
}

function currentSearchBuildIsFresh(inputFingerprint) {
  const buildState = readJson(PUBLIC_SEARCH_BUILD_STATE_FILE, null);
  const statewideManifest = readJson(
    path.join(PUBLIC_STATEWIDE_BIGRAM_INDEX_DIR, "manifest.json"),
    null
  );
  return searchIndexBuildStateIsFresh({
    inputFingerprint,
    buildState,
    statewideManifest,
    assetExists: (assetPath) => fs.existsSync(path.join(SITE_DIR, assetPath)),
  });
}

export function invalidateSearchBuildState(stateFile = PUBLIC_SEARCH_BUILD_STATE_FILE) {
  fs.rmSync(stateFile, { force: true });
  const stateDirectory = path.dirname(stateFile);
  if (!fs.existsSync(stateDirectory)) return;
  for (const entry of fs.readdirSync(stateDirectory)) {
    if (entry.startsWith(`${path.basename(stateFile)}.`) && entry.endsWith(".tmp")) {
      fs.rmSync(path.join(stateDirectory, entry), { force: true });
    }
  }
}

export function writeSearchBuildStateAtomically({ stateFile, payload, validateAssets }) {
  const tempFile = `${stateFile}.${process.pid}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(payload));
  try {
    assertStaticAssetSize(tempFile);
    const assetStats = validateAssets();
    fs.renameSync(tempFile, stateFile);
    return assetStats;
  } catch (error) {
    fs.rmSync(tempFile, { force: true });
    throw error;
  }
}

function writeMemberActivityShards(municipalities, generatedAt, restrictedMinutesCities) {
  fs.rmSync(PUBLIC_MEMBER_ACTIVITY_DIR, { recursive: true, force: true });
  fs.mkdirSync(PUBLIC_MEMBER_ACTIVITY_DIR, { recursive: true });

  const cityManifests = [];
  for (const municipality of municipalities) {
    const city = municipality.slug;
    const minutesRestricted = restrictedMinutesCities.has(city);
    const members = readJson(path.join(DATA_DIR, city, "members.json"), []);
    const activity = minutesRestricted
      ? {}
      : readJson(path.join(DATA_DIR, city, "members_activity.json"), {});
    if (!Array.isArray(members)) continue;

    const cityDir = path.join(PUBLIC_MEMBER_ACTIVITY_DIR, city);
    fs.mkdirSync(cityDir, { recursive: true });
    const seenSeats = new Set();
    const entries = [];
    const unshardedMembers = [];

    for (const member of members) {
      const seatNumber = Number(member?.seat_number);
      if (!Number.isInteger(seatNumber) || seatNumber <= 0) {
        unshardedMembers.push({
          member_name: cleanText(member?.name),
          seat_number: member?.seat_number ?? null,
          reason: "valid seat_number is unavailable",
        });
        continue;
      }
      if (seenSeats.has(seatNumber)) {
        throw new Error(`${city}: duplicate member seat_number ${seatNumber}`);
      }
      seenSeats.add(seatNumber);

      const memberName = String(member?.name ?? "").trim();
      const activityKey = memberName.replace(/\s/g, "");
      const sourceActivity = activity?.[activityKey];
      const publishedActivity = sourceActivity?.classification_status === "classified"
        ? sourceActivity
        : null;
      const payload = {
        version: 1,
        city,
        seat_number: seatNumber,
        member_name: memberName,
        activity: minutesRestricted ? null : publishedActivity,
        minutes_access: minutesRestricted ? "restricted" : "public",
      };
      const filePath = path.join(cityDir, `${seatNumber}.json`);
      fs.writeFileSync(filePath, JSON.stringify(payload));
      const bytes = assertStaticAssetSize(filePath);
      entries.push({
        seat_number: seatNumber,
        member_name: memberName,
        has_activity: payload.activity !== null,
        bytes,
      });
    }

    entries.sort((left, right) => left.seat_number - right.seat_number);
    const cityManifest = {
      version: 1,
      generated_at: generatedAt,
      city,
      minutes_access: minutesRestricted ? "restricted" : "public",
      count: entries.length,
      members: entries,
      unsharded_members: unshardedMembers,
    };
    const cityManifestPath = path.join(cityDir, "manifest.json");
    fs.writeFileSync(cityManifestPath, JSON.stringify(cityManifest));
    assertStaticAssetSize(cityManifestPath);
    cityManifests.push({
      city,
      minutes_access: minutesRestricted ? "restricted" : "public",
      count: entries.length,
      activity_count: entries.filter((entry) => entry.has_activity).length,
      unsharded_count: unshardedMembers.length,
    });
  }

  const manifest = {
    version: 1,
    generated_at: generatedAt,
    count: cityManifests.length,
    cities: cityManifests,
  };
  const manifestPath = path.join(PUBLIC_MEMBER_ACTIVITY_DIR, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assertStaticAssetSize(manifestPath);
  return manifest;
}

function cleanText(s) {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

export function positiveSeatNumber(value) {
  const seatNumber = Number(value);
  return Number.isInteger(seatNumber) && seatNumber > 0 ? seatNumber : null;
}

export function memberSearchDocumentIds(rows) {
  const seen = new Map();
  return rows.map((row) => {
    const city = cleanText(row?.city) || "unknown";
    const seatNumber = positiveSeatNumber(row?.seat_number);
    const stableIdentity = seatNumber !== null
      ? `seat:${seatNumber}`
      : `identity:${sha256([
          cleanText(row?.name),
          cleanText(row?.furigana),
          cleanText(row?.party),
          cleanText(row?.faction),
        ].join("\u001f")).slice(0, 16)}`;
    const baseId = `member:${city}:${stableIdentity}`;
    const occurrence = (seen.get(baseId) ?? 0) + 1;
    seen.set(baseId, occurrence);
    return occurrence === 1 ? baseId : `${baseId}:${occurrence}`;
  });
}

function claimsMinutesBodyIsMissing(summary) {
  return /本文(?:データ)?(?:が|は)?[^。]{0,40}(?:含まれていない|収録されていない|取得できていない)/u.test(
    String(summary ?? "")
  );
}

function hasStructuredMinutesDocument(city, councilId) {
  return fs.existsSync(
    path.join(DATA_DIR, "structured-minutes", city, `${councilId}.json`)
  );
}

function compactForBigramSearch(text) {
  return compactForSearch(text);
}

function addDocumentPostings(buckets, text, documentIndex) {
  const compact = compactForBigramSearch(text);
  const bigramTerms = new Set();
  const trigramTerms = new Set();
  for (let index = 0; index < compact.length - 1; index += 1) {
    bigramTerms.add(compact.slice(index, index + 2));
    if (index < compact.length - 2) {
      trigramTerms.add(compact.slice(index, index + 3));
    }
  }

  for (const term of bigramTerms) {
    const bucket = bigramBucket(term);
    if (!buckets.has(bucket)) buckets.set(bucket, {});
    const postings = buckets.get(bucket);
    if (!postings[term]) postings[term] = [];
    postings[term].push(documentIndex);
  }
  for (const term of trigramTerms) {
    const bucket = bigramBucket(term);
    if (!buckets.has(bucket)) buckets.set(bucket, {});
    const postings = buckets.get(bucket);
    if (!postings[term]) postings[term] = [];
    postings[term].push(documentIndex);
  }
  for (const exactTerm of EXACT_POSTING_TERMS) {
    if (exactTerm.length <= 3 || !compact.includes(exactTerm)) continue;
    const bucket = bigramBucket(exactTerm);
    if (!buckets.has(bucket)) buckets.set(bucket, {});
    const postings = buckets.get(bucket);
    if (!postings[exactTerm]) postings[exactTerm] = [];
    postings[exactTerm].push(documentIndex);
  }
}

function encodeUnsignedVarints(values) {
  const bytes = [];
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`invalid unsigned posting value: ${value}`);
    }
    let remaining = value;
    do {
      let byte = remaining & 0x7f;
      remaining = Math.floor(remaining / 128);
      if (remaining > 0) byte |= 0x80;
      bytes.push(byte);
    } while (remaining > 0);
  }
  return Buffer.from(bytes).toString("base64");
}

export function encodeDocumentIds(documentIds) {
  const deltas = [];
  let previousDocumentId = -1;
  for (const documentId of documentIds) {
    if (!Number.isSafeInteger(documentId) || documentId <= previousDocumentId) {
      throw new Error(`document posting ids must be unique and strictly increasing: ${documentId}`);
    }
    deltas.push(documentId - previousDocumentId);
    previousDocumentId = documentId;
  }
  return encodeUnsignedVarints(deltas);
}

function serializeCityPostingBatch(postings) {
  const serialized = {};
  for (const [term, value] of Object.entries(postings)) {
    serialized[term] = value;
  }
  return serialized;
}

function createStatewidePostingSpool() {
  const directory = path.join(PUBLIC_STATEWIDE_BIGRAM_INDEX_DIR, "_postings-build");
  fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(directory, { recursive: true });
  let bytesWritten = 0;
  let openHandles = 0;
  let peakOpenHandles = 0;

  return {
    addCity(city, buckets) {
      for (const [bucket, postings] of buckets) {
        const line = `${JSON.stringify([city, serializeCityPostingBatch(postings)])}\n`;
        const lineBytes = Buffer.byteLength(line);
        if (bytesWritten + lineBytes > POSTING_SPOOL_MAX_BYTES) {
          throw new Error(
            `posting spool exceeds ${formatMiB(POSTING_SPOOL_MAX_BYTES)} safety limit`
          );
        }
        const handle = fs.openSync(path.join(directory, `${bigramBucketFile(bucket)}l`), "a");
        openHandles += 1;
        peakOpenHandles = Math.max(peakOpenHandles, openHandles);
        if (peakOpenHandles > POSTING_SPOOL_OPEN_HANDLE_LIMIT) {
          fs.closeSync(handle);
          openHandles -= 1;
          throw new Error(`posting spool exceeded ${POSTING_SPOOL_OPEN_HANDLE_LIMIT} open handles`);
        }
        try {
          fs.writeSync(handle, line);
        } finally {
          fs.closeSync(handle);
          openHandles -= 1;
        }
        bytesWritten += lineBytes;
      }
    },
    finish() {},
    readBucket(bucket) {
      const filePath = path.join(directory, `${bigramBucketFile(bucket)}l`);
      if (!fs.existsSync(filePath)) return [];
      return fs.readFileSync(filePath, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    },
    cleanup() {
      this.finish();
      fs.rmSync(directory, { recursive: true, force: true });
    },
    get bytesWritten() {
      return bytesWritten;
    },
    get peakOpenHandles() {
      return peakOpenHandles;
    },
  };
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dateFromScheduleName(year, scheduleName) {
  const normalized = cleanText(scheduleName).replace(/[０-９]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xfee0)
  );
  const match = normalized.match(/(\d{1,2})月(\d{1,2})日/);
  if (!year || !match) return "";
  const month = match[1].padStart(2, "0");
  const day = match[2].padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function stripMinuteSpeakerPrefix(speaker, text) {
  const normalizedSpeaker = cleanText(speaker);
  let body = text;
  if (!normalizedSpeaker || !body) return body;
  body = body.replace(new RegExp(`^[◆◎○]?\\s*${escapeRegExp(normalizedSpeaker)}\\s*`), "");
  return body.trim();
}

export function normalizeMinuteBodyForSearchEvidence(speaker, text) {
  return stripMinuteSpeakerPrefix(speaker, cleanText(text));
}

function normalizeRawMinuteForIndex(minute) {
  const speaker = cleanText(minute?.title);
  const body = stripMinuteSpeakerPrefix(
    speaker,
    cleanText(
      String(minute?.text ?? "")
        .replace(/\0/g, " ")
        .replace(/\(cid:\d+\)/giu, " ")
    )
  );
  if (!body) return "";
  return speaker ? `${speaker}: ${body}` : body;
}

export function excludedRawMinuteHasSubstantiveText(minute) {
  const minuteType = cleanText(minute?.minute_type);
  const explicitlyExcluded = minute?.is_procedural === true
    || RAW_MINUTE_EXCLUDED_TYPES.test(minuteType);
  return explicitlyExcluded
    && RAW_MINUTE_SUBSTANTIVE_MARKERS.test(cleanText(minute?.text));
}

function yearFromDate(date) {
  return cleanText(date).match(/^(\d{4})/)?.[1] ?? "";
}

function memberActivityQuestionLabel(questionKind) {
  if (questionKind === "general_question") return "一般質問";
  if (questionKind === "representative_question") return "代表質問";
  if (questionKind === "committee_question") return "委員会質疑";
  if (questionKind === "plenary_question") return "本会議質疑";
  if (questionKind === "other_question") return "質問";
  return "質問記録";
}

function memberActivitySearchSourceType(activity) {
  return activity.source_status === "preliminary"
    || activity.source_type === "video_transcript"
    || String(activity.href ?? "").includes("/sessions/")
    ? "session"
    : "minutes";
}

// 会議名から西暦を推定（令和◯年 → 2018+N）
function yearFromCouncilName(name) {
  const norm = (name ?? "").replace(/[０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0)
  );
  const reiwa = norm.match(/令和\s*(\d+)/);
  if (reiwa) return String(2018 + Number(reiwa[1]));
  const heisei = norm.match(/平成\s*(\d+)/);
  if (heisei) return String(1988 + Number(heisei[1]));
  const west = norm.match(/(\d{4})/);
  if (west) return west[1];
  return "";
}

function normalizeYearValue(value) {
  const text = cleanText(value);
  if (!text) return "";
  return yearFromCouncilName(text) || yearFromDate(text);
}

function pushSearchDocument(documents, doc, additionalSearchText = "", searchTextOverride = "") {
  const searchText = cleanText(
    searchTextOverride
    || [
      doc.cityName,
      doc.title,
      doc.committee,
      doc.label,
      doc.speaker,
      doc.body,
      doc.context,
      doc.metaText,
      doc.member_name,
      doc.name,
      doc.furigana,
      doc.party,
      doc.faction,
      ...(doc.committees ?? []),
      additionalSearchText,
    ].filter(Boolean).join(" ")
  );
  if (!searchText) return;
  documents.push({
    ...doc,
    body: cleanText(doc.body).slice(0, 240),
    context: cleanText(doc.context || doc.body).slice(0, 360),
    metaText: cleanText(doc.metaText),
    _searchText: searchText,
  });
}

export function buildRawScheduleFallbackText(schedule) {
  const minutes = schedule?.minutes ?? [];
  const rows = [];
  for (const minute of minutes) {
    const minuteType = cleanText(minute?.minute_type);
    if (minute?.is_procedural === true || RAW_MINUTE_EXCLUDED_TYPES.test(minuteType)) continue;
    const rowText = normalizeRawMinuteForIndex(minute);
    if (rowText) rows.push(rowText);
  }
  return rows.join(" ");
}

export function buildRawCouncilFallbackText(council) {
  return (council?.schedules ?? [])
    .map(buildRawScheduleFallbackText)
    .filter(Boolean)
    .join(" ");
}

function markScheduleLedgerIgnored(rawStats, reason) {
  const scheduleReason = `schedule-${reason}`;
  return {
    ...rawStats,
    minute_type_ledger: rawStats.minute_type_ledger.map((row) => {
      const excludedReasons = { ...row.excluded_reasons };
      if (row.indexed_rows > 0) {
        excludedReasons[scheduleReason] =
          (excludedReasons[scheduleReason] ?? 0) + row.indexed_rows;
      }
      return {
        ...row,
        indexed_rows: 0,
        indexed_schedules: 0,
        indexed_compact_chars: 0,
        excluded_rows: row.source_rows,
        excluded_schedules: row.source_rows > 0 ? 1 : 0,
        excluded_body_compact_chars: row.source_body_compact_chars,
        excluded_reasons: Object.fromEntries(
          Object.entries(excludedReasons).sort(([left], [right]) => left.localeCompare(right))
        ),
      };
    }),
  };
}

export function classifyRawScheduleFallback(schedule) {
  const scheduleName = cleanText(schedule?.name);
  const minutes = schedule?.minutes ?? [];
  const eligibleMinutes = minutes.filter((minute) => {
    const minuteType = cleanText(minute?.minute_type);
    return minute?.is_procedural !== true && !RAW_MINUTE_EXCLUDED_TYPES.test(minuteType);
  });
  const sourceText = eligibleMinutes
    .map((minute) => String(minute?.text ?? "").replace(/\0/g, " "))
    .join(" ");
  const cidTokens = sourceText.match(/\(cid:\d+\)/giu) ?? [];
  const cidBytes = cidTokens.reduce((sum, token) => sum + token.length, 0);
  const text = buildRawScheduleFallbackText(schedule);
  const canonical = compactForSearch(text);
  const japaneseCharacters = canonical.match(/[ぁ-ヿ㐀-龿]/gu)?.length ?? 0;
  const japaneseRatio = japaneseCharacters / Math.max(1, canonical.length);
  const rawStats = {
    raw_sha256: sha256(canonical),
    raw_compact_chars: canonical.length,
    minute_type_ledger: Array.from(
      minutes.reduce((ledger, minute) => {
        const minuteType = cleanText(minute?.minute_type) || "(未分類)";
        const current = ledger.get(minuteType) ?? {
          minute_type: minuteType,
          source_rows: 0,
          source_schedules: 1,
          source_body_compact_chars: 0,
          indexed_rows: 0,
          indexed_schedules: 0,
          indexed_compact_chars: 0,
          excluded_rows: 0,
          excluded_schedules: 0,
          excluded_body_compact_chars: 0,
          excluded_reasons: {},
        };
        current.source_rows += 1;
        const sourceBody = cleanText(String(minute?.text ?? "").replace(/\0/g, " "));
        const sourceBodyCharacters = compactForSearch(sourceBody).length;
        current.source_body_compact_chars += sourceBodyCharacters;
        let excludedReason = "";
        if (minute?.is_procedural === true) {
          excludedReason = "explicit-procedural-flag";
        } else if (RAW_MINUTE_EXCLUDED_TYPES.test(minuteType)) {
          excludedReason = "excluded-minute-type";
        } else if (!sourceBody) {
          excludedReason = "empty-body";
        }
        const indexedText = excludedReason ? "" : normalizeRawMinuteForIndex(minute);
        if (!excludedReason && !indexedText) {
          excludedReason = "empty-after-normalization";
        }
        if (excludedReason) {
          current.excluded_rows += 1;
          current.excluded_body_compact_chars += sourceBodyCharacters;
          current.excluded_reasons[excludedReason] =
            (current.excluded_reasons[excludedReason] ?? 0) + 1;
        } else {
          current.indexed_rows += 1;
          current.indexed_compact_chars += compactForSearch(indexedText).length;
        }
        ledger.set(minuteType, current);
        return ledger;
      }, new Map()).values()
    ).map((row) => ({
      ...row,
      indexed_schedules: row.indexed_rows > 0 ? 1 : 0,
      excluded_schedules: row.excluded_rows > 0 ? 1 : 0,
      excluded_reasons: Object.fromEntries(
        Object.entries(row.excluded_reasons).sort(([left], [right]) => left.localeCompare(right))
      ),
    })).sort((left, right) => left.minute_type.localeCompare(right.minute_type, "ja")),
  };
  if (/目次/u.test(scheduleName)) {
    return {
      status: "ignored",
      reason: "toc-explicit",
      text: "",
      ...markScheduleLedgerIgnored(rawStats, "toc-explicit"),
    };
  }
  if (
    cidTokens.length >= 10
    && cidBytes / Math.max(1, sourceText.length) >= 0.8
    && japaneseCharacters < 10
  ) {
    return {
      status: "ignored",
      reason: "unreadable-cid",
      text: "",
      ...markScheduleLedgerIgnored(rawStats, "unreadable-cid"),
    };
  }
  const hasExplicitImagePdfSource = eligibleMinutes.length > 0
    && eligibleMinutes.every((minute) =>
      !cleanText(minute?.text)
      && /^https?:\/\/[^\s]+\.pdf(?:[?#].*)?$/iu.test(cleanText(minute?.source_url))
    );
  if (hasExplicitImagePdfSource) {
    return {
      status: "ignored",
      reason: "image-pdf-needs-ocr-review",
      text: "",
      ...markScheduleLedgerIgnored(rawStats, "image-pdf-needs-ocr-review"),
    };
  }
  if (
    text
    && (
      (japaneseCharacters >= 10 && japaneseRatio >= 0.2)
      || (canonical.length < 100 && japaneseCharacters > 0)
    )
  ) {
    return { status: "covered", reason: "raw-minutes", text, ...rawStats };
  }
  const ignoredReason = sourceText.trim()
    ? "unreadable-or-non-japanese"
    : eligibleMinutes.length === 0 && (schedule?.minutes ?? []).length > 0
      ? "roster-or-procedure-only"
      : "empty-source-text";
  return {
    status: "ignored",
    reason: ignoredReason,
    text: "",
    ...markScheduleLedgerIgnored(rawStats, ignoredReason),
  };
}

export function hasSubstantiveAgendaSearchText(rows) {
  return compactForSearch(
    (Array.isArray(rows) ? rows : [])
      .map((row) => row?.full_search_text ?? row?.text ?? "")
      .join(" ")
  ).length > 0;
}

export function selectScheduleExactSource({ agendaText, rawFallback, segmentText }) {
  const agendaCanonical = compactForSearch(agendaText);
  if (
    agendaCanonical
    && rawFallback?.status === "covered"
    && rawFallback.raw_sha256 === sha256(agendaCanonical)
    && rawFallback.raw_compact_chars === agendaCanonical.length
  ) {
    return { source: "agenda", text: cleanText(agendaText) };
  }
  if (rawFallback?.status === "covered") {
    return { source: "raw-minutes", text: rawFallback.text };
  }
  const cleanedSegmentText = cleanText(segmentText);
  return cleanedSegmentText
    ? { source: "segments", text: cleanedSegmentText }
    : null;
}

export function agendaSearchDocumentId(row) {
  const agendaIdentity = Number.isInteger(Number(row?.agenda_index))
    ? Number(row.agenda_index)
    : row?.first_minute_id ?? "x";
  return `agenda:${row?.city}:${row?.council_id}:${row?.schedule_index}:${agendaIdentity}`;
}

function buildFullTextCouncilDocuments(city, cityRuntimeOut) {
  const agendaRowsByScheduleKey = new Map();
  for (const row of cityRuntimeOut.agendas ?? []) {
    const key = `${Number(row.council_id)}:${Number(row.schedule_index)}`;
    const rows = agendaRowsByScheduleKey.get(key) ?? [];
    rows.push(row);
    agendaRowsByScheduleKey.set(key, rows);
  }
  const minutesIndex = readJson(path.join(DATA_DIR, city, "minutes", "index.json"), []);
  if (!Array.isArray(minutesIndex)) {
    return {
      documents: [],
      suppressedAgendaDocumentIds: new Set(),
      scheduleCoverage: {
        total_schedules: 0,
        published_councils: 0,
        ledger_councils: 0,
        covered_schedules: 0,
        covered_by: {},
        minute_type_totals: {},
        excluded_minute_types: [],
        ignored_by: {},
        ignored_schedules: [],
        schedules: [],
      },
    };
  }

  const cityName = cityRuntimeOut.municipalities?.[0]?.name
    ?? cityRuntimeOut.agendas?.[0]?.cityName
    ?? cityRuntimeOut.members?.[0]?.cityName
    ?? city;
  const documents = [];
  const suppressedAgendaDocumentIds = new Set();
  const coverage = {
    total_schedules: 0,
    published_councils: 0,
    ledger_councils: 0,
    covered_schedules: 0,
    covered_by: {},
    minute_type_totals: {},
    excluded_minute_types: [],
    ignored_by: {},
    ignored_schedules: [],
    schedules: [],
  };
  const scheduleKeys = new Set();
  const ledgerCouncils = new Set();

  const markCovered = (source) => {
    coverage.covered_schedules += 1;
    coverage.covered_by[source] = (coverage.covered_by[source] ?? 0) + 1;
  };

  for (const entry of minutesIndex) {
    const councilId = Number(entry?.council_id);
    if (!Number.isFinite(councilId)) continue;
    coverage.published_councils += 1;

    const siteSegmentsPath = path.join(DATA_DIR, city, "segments", `${councilId}.json`);
    const segments = readJson(
      path.join(SOURCE_DATA_DIR, city, "segments", `${councilId}.json`),
      readJson(siteSegmentsPath, [])
    );
    const searchableSegments = (Array.isArray(segments) ? segments : []).filter(
      (segment) => !segment?.is_procedural && cleanText(segment?.text)
    );

    const councilFile = cleanText(entry?.file) || `${councilId}.json`;
    const councilPath = path.join(DATA_DIR, city, "minutes", councilFile);
    if (!fs.existsSync(councilPath)) {
      throw new Error(`${city}/${councilId}: published council file is missing`);
    }
    const council = readJson(councilPath, null);
    if (
      !council
      || Number(council.council_id) !== councilId
      || !Array.isArray(council.schedules)
      || council.schedules.length === 0
    ) {
      throw new Error(`${city}/${councilId}: published council file is malformed or has no schedules`);
    }
    ledgerCouncils.add(councilId);

    const councilName = cleanText(entry?.name)
      || cleanText(searchableSegments[0]?.council_name)
      || cleanText(council?.name)
      || `会議録 ${councilId}`;
    const year = normalizeYearValue(entry?.year) || yearFromCouncilName(councilName);
    const schedules = Array.isArray(council?.schedules) ? council.schedules : [];
    let councilHasDocument = false;
    const unusedSegments = new Set(searchableSegments.map((_, index) => index));

    schedules.forEach((schedule, scheduleIndex) => {
      coverage.total_schedules += 1;
      const scheduleIdValue = Number(schedule?.schedule_id);
      const scheduleId = Number.isFinite(scheduleIdValue) ? scheduleIdValue : null;
      if (scheduleId === null) {
        throw new Error(`${city}/${councilId}: schedule_id is missing at ${scheduleIndex}`);
      }
      const scheduleName = cleanText(schedule?.name);
      const scheduleKey = `${councilId}:${scheduleIndex}`;
      const sourceScheduleKey = `${councilId}:${scheduleId}`;
      if (scheduleKeys.has(sourceScheduleKey)) {
        throw new Error(`${city}: duplicate publication schedule key ${sourceScheduleKey}`);
      }
      scheduleKeys.add(sourceScheduleKey);
      const suspiciousExcludedMinute = (schedule?.minutes ?? []).find(
        excludedRawMinuteHasSubstantiveText
      );
      if (suspiciousExcludedMinute) {
        throw new Error(
          `${city}/${councilId}/${scheduleId}: excluded ${cleanText(suspiciousExcludedMinute.minute_type) || "procedural"} row contains discussion text`
        );
      }
      const rawFallback = classifyRawScheduleFallback(schedule);
      for (const row of rawFallback.minute_type_ledger) {
        const excludedReasonRows = Object.values(row.excluded_reasons)
          .reduce((sum, count) => sum + count, 0);
        if (
          row.source_rows !== row.indexed_rows + row.excluded_rows
          || excludedReasonRows !== row.excluded_rows
        ) {
          throw new Error(
            `${city}/${councilId}/${scheduleId}: unbalanced minute type ledger (${row.minute_type})`
          );
        }
      }
      const ledgerIndexedCharacters = rawFallback.minute_type_ledger.reduce(
        (sum, row) => sum + row.indexed_compact_chars,
        0
      );
      if (
        rawFallback.status === "covered"
        && ledgerIndexedCharacters !== rawFallback.raw_compact_chars
      ) {
        throw new Error(`${city}/${councilId}/${scheduleId}: minute type ledger differs from raw source`);
      }
      if (rawFallback.status === "ignored" && ledgerIndexedCharacters !== 0) {
        throw new Error(`${city}/${councilId}/${scheduleId}: ignored minute type ledger claims indexed text`);
      }
      for (const row of rawFallback.minute_type_ledger) {
        const total = coverage.minute_type_totals[row.minute_type] ?? {
          source_rows: 0,
          source_schedules: 0,
          source_body_compact_chars: 0,
          indexed_rows: 0,
          indexed_schedules: 0,
          indexed_compact_chars: 0,
          excluded_rows: 0,
          excluded_schedules: 0,
          excluded_body_compact_chars: 0,
          excluded_reasons: {},
        };
        total.source_rows += row.source_rows;
        total.source_schedules += row.source_schedules;
        total.source_body_compact_chars += row.source_body_compact_chars;
        total.indexed_rows += row.indexed_rows;
        total.indexed_schedules += row.indexed_schedules;
        total.indexed_compact_chars += row.indexed_compact_chars;
        total.excluded_rows += row.excluded_rows;
        total.excluded_schedules += row.excluded_schedules;
        total.excluded_body_compact_chars += row.excluded_body_compact_chars;
        for (const [reason, count] of Object.entries(row.excluded_reasons)) {
          total.excluded_reasons[reason] = (total.excluded_reasons[reason] ?? 0) + count;
        }
        coverage.minute_type_totals[row.minute_type] = total;
      }
      const baseLedger = {
        city,
        council_id: councilId,
        schedule_id: scheduleId,
        schedule_index: scheduleIndex,
        schedule_name: scheduleName,
        raw_sha256: rawFallback.raw_sha256,
        raw_compact_chars: rawFallback.raw_compact_chars,
        minute_type_ledger: rawFallback.minute_type_ledger,
      };
      const agendaRows = agendaRowsByScheduleKey.get(scheduleKey) ?? [];
      const agendaIndexedPayload = agendaRows
        .map((row) => row[FULL_SEARCH_TEXT])
        .filter(Boolean)
        .join(" ");
      const hasAgendaPayload = hasSubstantiveAgendaSearchText([
        { full_search_text: agendaIndexedPayload },
      ]);
      const agendaCanonical = compactForSearch(agendaIndexedPayload);
      const agendaMatchesRaw = hasAgendaPayload
        && rawFallback.status === "covered"
        && rawFallback.raw_sha256 === sha256(agendaCanonical)
        && rawFallback.raw_compact_chars === agendaCanonical.length;
      if (agendaMatchesRaw) {
        const agendaSourceDocs = agendaRows
          .filter((row) => compactForSearch(row[FULL_SEARCH_TEXT]))
          .map((row) => {
            const payload = compactForSearch(row[FULL_SEARCH_TEXT]);
            return {
              id: agendaSearchDocumentId(row),
              payload_sha256: sha256(payload),
              compact_chars: payload.length,
            };
          });
        coverage.schedules.push({
          ...baseLedger,
          status: "covered_exact",
          source: "agenda",
          search_source_doc_ids: agendaSourceDocs.map((document) => document.id),
          search_source_docs: agendaSourceDocs,
          indexed_payload_sha256: sha256(compactForSearch(agendaIndexedPayload)),
          indexed_compact_chars: compactForSearch(agendaIndexedPayload).length,
        });
        councilHasDocument = true;
        markCovered("agenda");
        return;
      }
      for (const row of agendaRows) {
        suppressedAgendaDocumentIds.add(agendaSearchDocumentId(row));
      }

      const matchingSegmentIndexes = Array.from(unusedSegments).filter((segmentIndex) => {
        const segment = searchableSegments[segmentIndex];
        const segmentScheduleId = Number(segment?.schedule_id);
        const idsMatch = scheduleId !== null
          && Number.isFinite(segmentScheduleId)
          && segmentScheduleId === scheduleId;
        const namesMatch = scheduleName
          && cleanText(segment?.schedule_name) === scheduleName;
        return idsMatch || namesMatch || (schedules.length === 1);
      });
      const scheduleSegments = matchingSegmentIndexes.map(
        (segmentIndex) => searchableSegments[segmentIndex]
      );
      for (const segmentIndex of matchingSegmentIndexes) unusedSegments.delete(segmentIndex);

      const segmentText = scheduleSegments
        .map((segment) => [
          segment.speaker,
          segment.speaker_role,
          segment.member_name,
          segment.text,
        ].filter(Boolean).join(" "))
        .join(" ");
      const selectedSource = selectScheduleExactSource({
        agendaText: agendaIndexedPayload,
        rawFallback,
        segmentText,
      });
      if (!selectedSource) {
        if (
          rawFallback.reason !== "toc-explicit"
          && rawFallback.reason !== "unreadable-cid"
          && rawFallback.reason !== "roster-or-procedure-only"
          && rawFallback.reason !== "image-pdf-needs-ocr-review"
        ) {
          throw new Error(
            `${city}/${councilId}/${scheduleId}: unclassified schedule body (${rawFallback.reason})`
          );
        }
        const ignored = {
          ...baseLedger,
          status: "ignored",
          reason: rawFallback.reason,
          search_source_doc_ids: [],
          search_source_docs: [],
          indexed_payload_sha256: sha256(""),
          indexed_compact_chars: 0,
        };
        coverage.ignored_schedules.push(ignored);
        coverage.schedules.push(ignored);
        coverage.ignored_by[rawFallback.reason] =
          (coverage.ignored_by[rawFallback.reason] ?? 0) + 1;
        return;
      }

      const date = cleanText(scheduleSegments.find((segment) => cleanText(segment?.date))?.date)
        || dateFromScheduleName(year, scheduleName)
        || cleanText(entry?.start_date);
      const fullTextSource = selectedSource.source === "segments" ? "会議録全文" : "会議録原文";
      const documentId = `agenda-fulltext:${city}:${councilId}:${scheduleIndex}`;
      pushSearchDocument(
        documents,
        {
          id: documentId,
          source: "agenda",
          sourceType: "minutes",
          city,
          cityName,
          council_id: councilId,
          schedule_id: scheduleId,
          schedule_index: scheduleIndex,
          title: councilName,
          committee: "公式議事録",
          label: [scheduleName, fullTextSource].filter(Boolean).join("・"),
          body: "",
          context: "公式議事録の全文を検索対象にしています。",
          metaText: [year, date, scheduleName].filter(Boolean).join(" "),
          href: `/${city}/minutes/${councilId}`,
          date,
          year,
          field: "議事録本文",
          fullTextIndexed: true,
          _exactEvidenceText: selectedSource.text,
          indexed_payload_sha256: sha256(compactForSearch(selectedSource.text)),
          indexed_compact_chars: compactForSearch(selectedSource.text).length,
        },
        selectedSource.text
      );
      councilHasDocument = true;
      const indexedCanonical = compactForSearch(selectedSource.text);
      if (
        selectedSource.source === "raw-minutes"
        && (
          rawFallback.raw_sha256 !== sha256(indexedCanonical)
          || rawFallback.raw_compact_chars !== indexedCanonical.length
        )
      ) {
        throw new Error(`${city}/${councilId}/${scheduleId}: raw schedule payload changed before indexing`);
      }
      coverage.schedules.push({
        ...baseLedger,
        status: "covered_exact",
        source: selectedSource.source,
        search_source_doc_ids: [documentId],
        search_source_docs: [{
          id: documentId,
          payload_sha256: sha256(indexedCanonical),
          compact_chars: indexedCanonical.length,
        }],
        indexed_payload_sha256: sha256(indexedCanonical),
        indexed_compact_chars: indexedCanonical.length,
      });
      markCovered(selectedSource.source);
    });

    if (!councilHasDocument) {
      const date = cleanText(entry?.start_date);
      pushSearchDocument(
        documents,
        {
          id: `agenda-metadata:${city}:${councilId}`,
          source: "agenda",
          sourceType: "minutes",
          city,
          cityName,
          council_id: councilId,
          title: councilName,
          committee: "公式議事録",
          label: "会議録情報",
          body: "",
          context: "公式会議録の公開情報を検索対象にしています。",
          metaText: [year, date].filter(Boolean).join(" "),
          href: `/${city}/minutes/${councilId}`,
          date,
          year,
          field: "会議録情報",
          fullTextIndexed: false,
        },
        "",
        [cityName, councilName, year, date].filter(Boolean).join(" ")
      );
    }
  }

  if (
    coverage.schedules.length !== coverage.total_schedules
    || coverage.covered_schedules + coverage.ignored_schedules.length !== coverage.total_schedules
  ) {
    throw new Error(`${city}: publication schedule coverage ledger is incomplete`);
  }
  coverage.ledger_councils = ledgerCouncils.size;
  if (coverage.ledger_councils !== coverage.published_councils) {
    throw new Error(`${city}: publication council coverage ledger is incomplete`);
  }
  for (const total of Object.values(coverage.minute_type_totals)) {
    total.excluded_reasons = Object.fromEntries(
      Object.entries(total.excluded_reasons).sort(([left], [right]) => left.localeCompare(right))
    );
  }
  coverage.excluded_minute_types = Object.entries(coverage.minute_type_totals)
    .filter(([, total]) => total.excluded_rows > 0)
    .map(([minuteType, total]) => ({
      minute_type: minuteType,
      excluded_rows: total.excluded_rows,
      excluded_schedules: total.excluded_schedules,
      excluded_body_compact_chars: total.excluded_body_compact_chars,
      excluded_reasons: Object.fromEntries(
        Object.entries(total.excluded_reasons).sort(([left], [right]) => left.localeCompare(right))
      ),
    }))
    .sort((left, right) => left.minute_type.localeCompare(right.minute_type, "ja"));
  coverage.ignored_by = Object.fromEntries(
    Object.entries(coverage.ignored_by).sort(([left], [right]) => left.localeCompare(right))
  );
  return { documents, scheduleCoverage: coverage, suppressedAgendaDocumentIds };
}

function buildCityBigramDocuments(city, cityRuntimeOut, minutesRestricted = false) {
  const documents = [];

  const fullTextCouncilDocuments = minutesRestricted
    ? {
        documents: [],
        scheduleCoverage: restrictedScheduleCoverage(city),
        suppressedAgendaDocumentIds: new Set(),
      }
    : buildFullTextCouncilDocuments(city, cityRuntimeOut);

  for (const row of cityRuntimeOut.agendas ?? []) {
    if (fullTextCouncilDocuments.suppressedAgendaDocumentIds.has(agendaSearchDocumentId(row))) {
      continue;
    }
    pushSearchDocument(
      documents,
      {
        id: agendaSearchDocumentId(row),
        source: "agenda",
        sourceType: "minutes",
        city: row.city,
        cityName: row.cityName,
        council_id: row.council_id,
        schedule_id: row.schedule_id,
        schedule_index: row.schedule_index,
        title: row.council_name,
        committee: row.agenda_title || "議題",
        label: row.schedule_name,
        body: row.text,
        context: [row.agenda_title, row.text].join(" "),
        metaText: [row.year, row.date, row.schedule_name].join(" "),
        href: `/${row.city}/minutes/${row.council_id}`,
        date: row.date,
        year: row.year || yearFromCouncilName(row.council_name),
        field: "議事録",
        fullTextIndexed: Boolean(row[FULL_SEARCH_TEXT]),
        _exactEvidenceText: row[FULL_SEARCH_TEXT],
        indexed_payload_sha256: sha256(compactForSearch(row[FULL_SEARCH_TEXT])),
        indexed_compact_chars: compactForSearch(row[FULL_SEARCH_TEXT]).length,
      },
      row[FULL_SEARCH_TEXT]
    );
  }

  documents.push(...fullTextCouncilDocuments.documents);

  for (const row of cityRuntimeOut.memberActivities ?? []) {
    const canonicalTopics = Array.isArray(row.canonical_topics) ? row.canonical_topics : [];
    const rawTopics = Array.isArray(row.topics) ? row.topics : [];
    const topicText = [...canonicalTopics, ...rawTopics].join("、");
    const questionLabel = memberActivityQuestionLabel(row.question_kind);
    const sourceLabel = row.source_label || (row.source_status === "preliminary" ? "会議録速報" : "公式議事録");
    const fallbackHref = Number(row.council_id) > 0
      ? `/${row.city}/minutes/${row.council_id}`
      : `/${row.city}`;
    const exactSearchText = [
      row.cityName,
      row.member_name,
      row.council_name,
      questionLabel,
      sourceLabel,
      row.year,
      row.date,
      row.source_status,
      row[MEMBER_ACTIVITY_SEARCH_TEXT],
    ].filter(Boolean).join(" ");
    pushSearchDocument(
      documents,
      {
        id: `member_activity:${row.record_id || `${row.city}:${row.member_name}:${row.council_id}:${row.date || "undated"}`}`,
        source: "member_activity",
        sourceType: memberActivitySearchSourceType(row),
        city: row.city,
        cityName: row.cityName,
        council_id: row.council_id,
        member_name: row.member_name,
        record_id: row.record_id,
        title: row.council_name,
        committee: `${row.member_name}議員の${questionLabel}`,
        label: [sourceLabel, questionLabel].filter(Boolean).join("・"),
        body: topicText,
        context: [
          canonicalTopics.length > 0
            ? `原文確認済みテーマ: ${canonicalTopics.join("、")}`
            : rawTopics.length > 0
              ? `議事録からの抜粋: ${rawTopics.slice(0, 3).join("。")}`
              : "",
        ].filter(Boolean).join(" "),
        metaText: [row.year, row.date, sourceLabel, row.source_status, questionLabel].filter(Boolean).join(" "),
        href: row.href || fallbackHref,
        date: row.date,
        start_time: row.start_time,
        year: row.year || yearFromCouncilName(row.council_name),
        question_kind: row.question_kind,
        canonical_topics: canonicalTopics,
        topics: rawTopics,
        source_label: row.source_label,
        source_status: row.source_status,
        field: questionLabel,
        fullTextIndexed: Boolean(row[MEMBER_ACTIVITY_SEARCH_TEXT]),
        _exactEvidenceText: row[MEMBER_ACTIVITY_SEARCH_TEXT],
        exact_evidence_sha256: sha256(compactForSearch(row[MEMBER_ACTIVITY_SEARCH_TEXT])),
        exact_evidence_compact_chars: compactForSearch(row[MEMBER_ACTIVITY_SEARCH_TEXT]).length,
      },
      "",
      exactSearchText
    );
  }

  const memberRows = cityRuntimeOut.members ?? [];
  const memberDocumentIds = memberSearchDocumentIds(memberRows);
  for (const [memberIndex, row] of memberRows.entries()) {
    const seatNumber = positiveSeatNumber(row.seat_number);
    pushSearchDocument(documents, {
      id: memberDocumentIds[memberIndex],
      source: "member",
      city: row.city,
      cityName: row.cityName,
      name: row.name,
      member_name: row.name,
      title: row.name,
      body: [row.furigana, row.party, row.faction, ...(row.committees ?? [])].join(" "),
      metaText: seatNumber !== null ? `${seatNumber}番` : "",
      href: seatNumber !== null
        ? `/${row.city}/members/${seatNumber}`
        : `/${row.city}`,
      furigana: row.furigana,
      party: row.party,
      faction: row.faction,
      committees: row.committees ?? [],
    });
  }

  for (const row of cityRuntimeOut.sessions ?? []) {
    for (const segment of row.segments ?? []) {
      const segmentIdentity = segment.speaker && segment.label?.includes(segment.speaker)
        ? segment.label
        : [segment.speaker, segment.label].filter(Boolean).join("・");
      const segmentText = cleanText(segment.transcript);
      pushSearchDocument(documents, {
        id: `session:${row.city}:${row.id}:${segment.index}`,
        source: "session",
        sourceType: "session",
        city: row.city,
        cityName: row.cityName,
        session_id: row.id,
        segment_index: segment.index,
        title: row.title,
        committee: row.committee,
        label: segment.label,
        speaker: segment.speaker,
        body: [segment.label, segment.speaker, segmentText].filter(Boolean).join(" "),
        context: [segmentIdentity, segmentText].filter(Boolean).join(": "),
        metaText: [row.date, row.committee, segment.speaker, segment.label, segment.start_time].join(" "),
        href: `/${row.city}/sessions/${row.id}#seg-${segment.index}`,
        date: row.date,
        start_time: segment.start_time,
        year: yearFromDate(row.date) || yearFromCouncilName(row.title),
        field: "会議録速報",
      });
    }
  }

  for (const [index, row] of (cityRuntimeOut.decisions ?? []).entries()) {
    pushSearchDocument(documents, {
      id: `decision:${row.city}:${index}`,
      source: "decision",
      sourceType: "decision",
      city: row.city,
      cityName: row.cityName,
      title: row.session,
      committee: "議決結果",
      body: row.description,
      context: [row.session, row.description].join(" "),
      href: `/${row.city}/decisions`,
      year: yearFromCouncilName(row.session),
      field: "議決",
    });
  }

  return {
    documents,
    scheduleCoverage: fullTextCouncilDocuments.scheduleCoverage,
  };
}

function createBigramPayloadRangeWriter({
  directory,
  urlPrefix,
  urlKey,
  targetBytes,
  maxDocuments,
  project,
  assetCatalog,
  assetKind,
  compressed = true,
}) {
  fs.mkdirSync(directory, { recursive: true });
  let nextFileIndex = 0;
  let current = null;

  const startRange = () => {
    const file = `${String(nextFileIndex).padStart(6, "0")}.json${compressed ? ".gz" : ""}`;
    nextFileIndex += 1;
    current = {
      payload: [],
      bytes: 2,
      filePath: path.join(directory, file),
      url: `${urlPrefix}/${file}`,
    };
  };

  const flush = () => {
    if (!current || current.payload.length === 0) return;
    const serialized = Buffer.from(JSON.stringify(current.payload));
    const payload = compressed ? zlib.gzipSync(serialized, { level: 9 }) : serialized;
    fs.writeFileSync(current.filePath, payload);
    assertStaticAssetSize(current.filePath);
    addSearchAssetCatalogEntry(assetCatalog, `${assetKind}:${current.url}`, {
      url: current.url,
      encoding: compressed ? "gzip" : "identity",
      bytes: payload.length,
      raw_bytes: serialized.length,
      sha256: createHash("sha256").update(payload).digest("hex"),
      raw_sha256: createHash("sha256").update(serialized).digest("hex"),
    });
    current = null;
  };

  const addCity = (documentsWithSearchText) => {
    const ranges = [];
    documentsWithSearchText.forEach((doc, documentIndex) => {
      const value = project(doc);
      const valueBytes = Buffer.byteLength(JSON.stringify(value)) + 1;
      if (
        current
        && current.payload.length > 0
        && (
          current.payload.length >= maxDocuments
          || current.bytes + valueBytes > targetBytes
        )
      ) {
        flush();
      }
      if (!current) startRange();

      const payloadIndex = current.payload.length;
      current.payload.push(value);
      current.bytes += valueBytes;

      const previous = ranges.at(-1);
      if (
        previous
        && previous[urlKey] === current.url
        && previous.end === documentIndex
        && previous.payload_end === payloadIndex
      ) {
        previous.end += 1;
        previous.payload_end += 1;
      } else {
        ranges.push({
          start: documentIndex,
          end: documentIndex + 1,
          payload_start: payloadIndex,
          payload_end: payloadIndex + 1,
          encoding: compressed ? "gzip" : "identity",
          [urlKey]: current.url,
        });
      }
    });
    return ranges;
  };

  return { addCity, finish: flush };
}

export function exactTextAssetValue(doc) {
  return cleanText(doc?._exactEvidenceText ?? doc?._searchText);
}

function createExactTextBlockWriter(assetCatalog) {
  const directory = path.join(PUBLIC_STATEWIDE_BIGRAM_INDEX_DIR, "exact-text");
  const urlPrefix = "/generated/search-bigram-statewide/exact-text";
  fs.mkdirSync(directory, { recursive: true });
  let nextFileIndex = 0;
  let current = null;

  const startAsset = () => {
    const file = `${String(nextFileIndex).padStart(4, "0")}.bin`;
    nextFileIndex += 1;
    current = {
      file,
      filePath: path.join(directory, file),
      url: `${urlPrefix}/${file}`,
      chunks: [],
      catalogEntries: [],
      bytes: 0,
    };
  };

  const flush = () => {
    if (!current || current.chunks.length === 0) return;
    fs.writeFileSync(current.filePath, Buffer.concat(current.chunks, current.bytes));
    assertStaticAssetSize(current.filePath);
    for (const entry of current.catalogEntries) entry.asset_bytes = current.bytes;
    current = null;
  };

  const addCity = (documentsWithSearchText) => {
    const ranges = [];
    let block = null;
    const flushBlock = () => {
      if (!block || block.texts.length === 0) return;
      const source = Buffer.from(JSON.stringify(block.texts));
      const compressed = zlib.gzipSync(source, { level: 9 });
      if (compressed.length > STATIC_ASSET_MAX_BYTES) {
        throw new Error(`exact search text block exceeds ${formatMiB(STATIC_ASSET_MAX_BYTES)}`);
      }
      if (
        current
        && current.chunks.length > 0
        && current.bytes + compressed.length > EXACT_TEXT_ASSET_TARGET_BYTES
      ) {
        flush();
      }
      if (!current) startAsset();

      const byteStart = current.bytes;
      current.chunks.push(compressed);
      current.bytes += compressed.length;

      const catalogKey = `exact:${current.url}:${byteStart}:${compressed.length}`;
      const catalogEntry = {
        url: current.url,
        encoding: "gzip-member-json",
        byte_start: byteStart,
        bytes: compressed.length,
        raw_bytes: source.length,
        asset_bytes: 0,
        sha256: createHash("sha256").update(compressed).digest("hex"),
        raw_sha256: createHash("sha256").update(source).digest("hex"),
      };
      addSearchAssetCatalogEntry(assetCatalog, catalogKey, catalogEntry);
      current.catalogEntries.push(catalogEntry);

      ranges.push({
        start: block.start,
        end: block.start + block.texts.length,
        byte_start: byteStart,
        byte_length: compressed.length,
        raw_bytes: source.length,
        encoding: "gzip-member-json",
        exact_text_url: current.url,
      });
      block = null;
    };

    documentsWithSearchText.forEach((doc, documentIndex) => {
      const text = exactTextAssetValue(doc);
      const valueBytes = Buffer.byteLength(JSON.stringify(text)) + 1;
      if (
        block
        && block.texts.length > 0
        && (
          block.texts.length >= EXACT_TEXT_BLOCK_MAX_DOCUMENTS
          || block.bytes + valueBytes > EXACT_TEXT_BLOCK_TARGET_BYTES
        )
      ) {
        flushBlock();
      }
      if (!block) block = { start: documentIndex, texts: [], bytes: 2 };
      block.texts.push(text);
      block.bytes += valueBytes;
    });
    flushBlock();
    return ranges;
  };

  return { addCity, finish: flush };
}

function createBigramDocumentRangeWriters(assetCatalog) {
  const documentWriter = createBigramPayloadRangeWriter({
    directory: path.join(PUBLIC_STATEWIDE_BIGRAM_INDEX_DIR, "documents"),
    urlPrefix: "/generated/search-bigram-statewide/documents",
    urlKey: "documents_url",
    targetBytes: BIGRAM_DOCUMENT_RANGE_TARGET_BYTES,
    maxDocuments: BIGRAM_DOCUMENT_RANGE_MAX_DOCUMENTS,
    assetCatalog,
    assetKind: "document",
    project(doc) {
      const publicDoc = { ...doc };
      delete publicDoc._searchText;
      delete publicDoc._exactEvidenceText;
      return publicDoc;
    },
  });
  const exactTextWriter = createExactTextBlockWriter(assetCatalog);
  return {
    addCity(documentsWithSearchText) {
      return {
        documentRanges: documentWriter.addCity(documentsWithSearchText),
        exactTextRanges: exactTextWriter.addCity(documentsWithSearchText),
      };
    },
    finish() {
      documentWriter.finish();
      exactTextWriter.finish();
    },
  };
}

export function scheduleCoverageManifestReference(scheduleCoverage, asset) {
  return {
    coverage_url: asset.url,
    coverage_encoding: "gzip",
    coverage_bytes: asset.compressedBytes,
    coverage_raw_bytes: asset.rawBytes,
    coverage_sha256: asset.sha256,
    coverage_counts: {
      published_councils: scheduleCoverage.published_councils,
      total_schedules: scheduleCoverage.total_schedules,
      covered_schedules: scheduleCoverage.covered_schedules,
      ignored_schedules: scheduleCoverage.ignored_schedules.length,
    },
  };
}

function writeScheduleCoverageAsset(city, scheduleCoverage) {
  const directory = path.join(PUBLIC_STATEWIDE_BIGRAM_INDEX_DIR, "coverage");
  fs.mkdirSync(directory, { recursive: true });
  const file = `${city}.json.gz`;
  const filePath = path.join(directory, file);
  const source = Buffer.from(JSON.stringify(scheduleCoverage));
  const compressed = zlib.gzipSync(source, { level: 9 });
  fs.writeFileSync(filePath, compressed);
  assertStaticAssetSize(filePath);
  return scheduleCoverageManifestReference(scheduleCoverage, {
    url: `/generated/search-bigram-statewide/coverage/${file}`,
    compressedBytes: compressed.length,
    rawBytes: source.length,
    sha256: createHash("sha256").update(source).digest("hex"),
  });
}

function writeCityBigramIndex(
  city,
  documentsWithSearchText,
  scheduleCoverage,
  rangeWriter,
  postingSpool
) {
  const cityDir = path.join(PUBLIC_CITY_BIGRAM_INDEX_DIR, city);
  const bucketFiles = new Set();
  let buckets = new Map();
  const flushPostingBatch = () => {
    if (buckets.size === 0) return;
    postingSpool.addCity(city, buckets);
    for (const bucket of buckets.keys()) bucketFiles.add(bigramBucketFile(bucket));
    buckets = new Map();
  };

  documentsWithSearchText.forEach((doc, docIndex) => {
    addDocumentPostings(buckets, doc._searchText, docIndex);
    if ((docIndex + 1) % POSTING_BATCH_DOCUMENTS === 0) {
      flushPostingBatch();
    }
  });
  flushPostingBatch();

  fs.mkdirSync(cityDir, { recursive: true });
  const { documentRanges, exactTextRanges } = rangeWriter.addCity(
    documentsWithSearchText
  );
  const coverageReference = writeScheduleCoverageAsset(city, scheduleCoverage);
  return {
    slug: city,
    document_count: documentsWithSearchText.length,
    bucket_files: Array.from(bucketFiles, (file) => `${file}.gz`),
    document_ranges: documentRanges,
    exact_text_ranges: exactTextRanges,
    ...coverageReference,
    minutes_access: scheduleCoverage.restricted ? "restricted" : "public",
  };
}

function writeCityBigramManifest(cityEntry, generatedAt, assetCatalogReference) {
  const cityDir = path.join(PUBLIC_CITY_BIGRAM_INDEX_DIR, cityEntry.slug);
  fs.mkdirSync(cityDir, { recursive: true });
  const manifestFile = path.join(cityDir, "manifest.json");
  fs.writeFileSync(
    manifestFile,
    JSON.stringify({
      version: 5,
      generated_at: generatedAt,
      scope: "city-bigram",
      city: cityEntry.slug,
      document_count: cityEntry.document_count,
      bucket_count: SEARCH_POSTING_BUCKET_COUNT,
      ngram_widths: [2, 3],
      positional_trigrams: false,
      buckets: cityEntry.bucket_files,
      exact_terms: EXACT_POSTING_TERMS,
      postings_encoding: "gzip",
      posting_value_encoding: "delta-varint-v1",
      postings_base_url: "/generated/search-bigram-statewide/postings",
      asset_catalog: assetCatalogReference,
      document_ranges: cityEntry.document_ranges,
      exact_text_ranges: cityEntry.exact_text_ranges,
      coverage_url: cityEntry.coverage_url,
      coverage_encoding: cityEntry.coverage_encoding,
      coverage_bytes: cityEntry.coverage_bytes,
      coverage_raw_bytes: cityEntry.coverage_raw_bytes,
      coverage_sha256: cityEntry.coverage_sha256,
      coverage_counts: cityEntry.coverage_counts,
      minutes_access: cityEntry.minutes_access,
    })
  );
  const manifestBytes = assertStaticAssetSize(manifestFile);
  if (manifestBytes > CITY_SEARCH_MANIFEST_MAX_BYTES) {
    throw new Error(`${cityEntry.slug}: city search manifest exceeds ${formatMiB(CITY_SEARCH_MANIFEST_MAX_BYTES)}`);
  }
}

export function agendaOnlyRuntimeIndex(runtimeIndex, scope) {
  const agendas = (Array.isArray(runtimeIndex?.agendas) ? runtimeIndex.agendas : []).map(
    (agenda) => ({
      city: agenda.city,
      cityName: agenda.cityName,
      council_id: agenda.council_id,
      council_name: agenda.council_name,
      year: agenda.year,
      date: agenda.date,
      schedule_id: agenda.schedule_id,
      schedule_index: agenda.schedule_index,
      schedule_name: agenda.schedule_name,
      agenda_title: agenda.agenda_title,
      first_minute_id: agenda.first_minute_id,
      text: agenda.text,
      truncated: agenda.truncated,
      agenda_index: agenda.agenda_index,
    })
  );
  return {
    version: runtimeIndex?.version,
    generated_at: runtimeIndex?.generated_at,
    excerpt_max: runtimeIndex?.excerpt_max,
    scope,
    count: agendas.length,
    restricted_minutes_cities: runtimeIndex?.restricted_minutes_cities ?? [],
    municipalities: runtimeIndex?.municipalities ?? [],
    agendas,
  };
}

function writeAgendaCompatibilityIndexes(runtimeOut, cityRuntimeIndexes) {
  fs.rmSync(PUBLIC_CITY_SEARCH_INDEX_DIR, { recursive: true, force: true });
  fs.mkdirSync(PUBLIC_CITY_SEARCH_INDEX_DIR, { recursive: true });
  const globalPayload = agendaOnlyRuntimeIndex(runtimeOut, "full");
  fs.writeFileSync(PUBLIC_SEARCH_INDEX_FILE, JSON.stringify(globalPayload));
  const globalBytes = assertStaticAssetSize(PUBLIC_SEARCH_INDEX_FILE);
  let cityBytes = 0;
  for (const cityRuntimeIndex of cityRuntimeIndexes) {
    const city = cityRuntimeIndex.municipalities[0].slug;
    const filePath = path.join(PUBLIC_CITY_SEARCH_INDEX_DIR, `${city}.json`);
    fs.writeFileSync(
      filePath,
      JSON.stringify(agendaOnlyRuntimeIndex(cityRuntimeIndex, "city"))
    );
    cityBytes += assertStaticAssetSize(filePath);
  }
  return { globalBytes, cityBytes };
}

function writeSearchAssetCatalog(assetCatalog, generatedAt) {
  const file = "asset-catalog.json.gz";
  const filePath = path.join(PUBLIC_STATEWIDE_BIGRAM_INDEX_DIR, file);
  const source = Buffer.from(JSON.stringify({
    version: 1,
    generated_at: generatedAt,
    assets: assetCatalog,
  }));
  const compressed = zlib.gzipSync(source, { level: 9 });
  fs.writeFileSync(filePath, compressed);
  assertStaticAssetSize(filePath);
  return {
    url: `/generated/search-bigram-statewide/${file}`,
    encoding: "gzip",
    bytes: compressed.length,
    raw_bytes: source.length,
    sha256: createHash("sha256").update(compressed).digest("hex"),
    raw_sha256: createHash("sha256").update(source).digest("hex"),
  };
}

function writeStatewideBigramIndex(cityEntries, generatedAt, postingSpool, assetCatalog) {
  const postingsDir = path.join(PUBLIC_STATEWIDE_BIGRAM_INDEX_DIR, "postings");
  fs.rmSync(postingsDir, { recursive: true, force: true });
  fs.mkdirSync(postingsDir, { recursive: true });

  postingSpool.finish();
  const bucketFiles = [];
  for (let bucket = 0; bucket < SEARCH_POSTING_BUCKET_COUNT; bucket += 1) {
    const file = bigramBucketFile(bucket);
    const publicFile = `${file}.gz`;
    const statewidePostings = {};
    for (const [city, cityPostings] of postingSpool.readBucket(bucket)) {
      for (const [term, posting] of Object.entries(cityPostings)) {
        if (!Array.isArray(posting) || posting.length === 0) continue;
        if (!statewidePostings[term]) statewidePostings[term] = {};
        if (!statewidePostings[term][city]) statewidePostings[term][city] = [];
        statewidePostings[term][city].push(...posting);
      }
    }
    for (const cities of Object.values(statewidePostings)) {
      for (const [city, documentIds] of Object.entries(cities)) {
        cities[city] = encodeDocumentIds(documentIds);
      }
    }
    const bucketFile = path.join(postingsDir, publicFile);
    const source = Buffer.from(JSON.stringify(statewidePostings));
    const compressed = zlib.gzipSync(source, { level: 9 });
    fs.writeFileSync(bucketFile, compressed);
    assertStaticAssetSize(bucketFile);
    const url = `/generated/search-bigram-statewide/postings/${publicFile}`;
    addSearchAssetCatalogEntry(assetCatalog, `posting:${url}`, {
      url,
      encoding: "gzip",
      bytes: compressed.length,
      raw_bytes: source.length,
      sha256: createHash("sha256").update(compressed).digest("hex"),
      raw_sha256: createHash("sha256").update(source).digest("hex"),
    });
    bucketFiles.push(publicFile);
  }
  const assetCatalogReference = writeSearchAssetCatalog(assetCatalog, generatedAt);
  for (const cityEntry of cityEntries) {
    writeCityBigramManifest(cityEntry, generatedAt, assetCatalogReference);
  }
  const publicCityEntries = cityEntries.map((cityEntry) => {
    const publicCityEntry = { ...cityEntry };
    delete publicCityEntry.bucket_files;
    return publicCityEntry;
  });
  const manifest = {
    version: 5,
    generated_at: generatedAt,
    scope: "statewide-bigram",
    document_count: publicCityEntries.reduce((sum, city) => sum + city.document_count, 0),
    bucket_count: SEARCH_POSTING_BUCKET_COUNT,
    ngram_widths: [2, 3],
    positional_trigrams: false,
    buckets: bucketFiles,
    exact_terms: EXACT_POSTING_TERMS,
    postings_encoding: "gzip",
    posting_value_encoding: "delta-varint-v1",
    asset_catalog: assetCatalogReference,
    restricted_minutes_cities: publicCityEntries
      .filter((city) => city.minutes_access === "restricted")
      .map((city) => city.slug)
      .sort(),
    cities: publicCityEntries,
  };
  const manifestFile = path.join(PUBLIC_STATEWIDE_BIGRAM_INDEX_DIR, "manifest.json");
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  const manifestBytes = assertStaticAssetSize(manifestFile);
  if (manifestBytes > STATEWIDE_SEARCH_MANIFEST_MAX_BYTES) {
    throw new Error(
      `statewide search manifest exceeds ${formatMiB(STATEWIDE_SEARCH_MANIFEST_MAX_BYTES)}`
    );
  }
  return manifest;
}

function getCityName(municipalities, slug) {
  const m = municipalities.find((x) => x.slug === slug);
  return m?.name ?? slug;
}

export function minutesSearchIsRestricted(municipality) {
  return municipality?.minutes_access === "restricted";
}

function restrictedScheduleCoverage(city) {
  const publicationIndex = readJson(path.join(DATA_DIR, city, "minutes", "index.json"), []);
  return {
    restricted: true,
    restriction_reason: "minutes-access-restricted",
    city,
    excluded_publication_councils: Array.isArray(publicationIndex)
      ? publicationIndex.length
      : 0,
    total_schedules: 0,
    published_councils: 0,
    ledger_councils: 0,
    covered_schedules: 0,
    covered_by: {},
    minute_type_totals: {},
    excluded_minute_types: [],
    ignored_by: {},
    ignored_schedules: [],
    schedules: [],
  };
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

function publishedCouncilIds(city) {
  const index = readJson(path.join(DATA_DIR, city, "minutes", "index.json"), []);
  if (!Array.isArray(index)) return new Set();
  return new Set(
    index
      .map((entry) => Number(entry?.council_id))
      .filter((councilId) => Number.isFinite(councilId))
  );
}

export function evidenceOnlySessionSegment(seg) {
  return {
    index: seg?.index ?? 0,
    label: seg?.label ?? "",
    speaker: seg?.speaker ?? seg?.detail?.speaker ?? "",
    start_time: seg?.start_time ?? "",
    transcript: seg?.transcript ?? "",
  };
}

function buildSessions(city, cityName) {
  const sessionsDir = path.join(DATA_DIR, city, "sessions");
  const indexPath = path.join(sessionsDir, "index.json");
  const index = readJson(indexPath, []);
  if (!Array.isArray(index)) return [];

  return index.flatMap((entry) => {
    if (!entry?.has_summary || (entry.segment_count ?? 0) === 0) return [];
    const session = readJson(path.join(sessionsDir, `${entry.id}.json`), null);
    if (!session) return [];
    return [
      {
        city,
        cityName,
        id: session.id ?? entry.id,
        title: session.title ?? "",
        committee: session.committee ?? "",
        date: session.date ?? "",
        segments: (session.segments ?? []).map(evidenceOnlySessionSegment),
      },
    ];
  });
}

function buildEnrichedDocs(city, cityName) {
  const enrichedDir = path.join(DATA_DIR, city, "minutes", "enriched");
  if (!fs.existsSync(enrichedDir)) return [];
  const published = publishedCouncilIds(city);
  return fs
    .readdirSync(enrichedDir)
    .filter((file) => file.endsWith(".json"))
    .flatMap((file) => {
      const doc = readJson(path.join(enrichedDir, file), null);
      if (!doc) return [];
      if (!published.has(Number(doc.council_id))) return [];
      if (
        claimsMinutesBodyIsMissing(doc.summary) &&
        hasStructuredMinutesDocument(city, doc.council_id)
      ) {
        return [];
      }
      return [
        {
          city,
          cityName,
          council_id: doc.council_id,
          name: doc.name ?? "",
          generated_at: doc.generated_at ?? "",
          summary: doc.summary ?? "",
          highlights: Array.isArray(doc.highlights) ? doc.highlights : [],
          tags: Array.isArray(doc.tags) ? doc.tags : [],
        },
      ];
    });
}

function buildDecisions(city, cityName) {
  const decisions = readJson(path.join(DATA_DIR, city, "decisions.json"), []);
  if (!Array.isArray(decisions)) return [];
  return decisions.map((decision) => ({
    city,
    cityName,
    session: decision.session ?? "",
    description: decision.description ?? "",
  }));
}

function buildMembers(city, cityName) {
  const members = readJson(path.join(DATA_DIR, city, "members.json"), []);
  if (Array.isArray(members) && members.length > 0) {
    return members.map((member) => ({
      city,
      cityName,
      seat_number: positiveSeatNumber(member.seat_number),
      name: member.name ?? "",
      furigana: member.furigana ?? "",
      party: member.party ?? "",
      faction: member.faction ?? "",
      committees: Array.isArray(member.committees) ? member.committees : [],
    }));
  }

  const election = readJson(path.join(DATA_DIR, city, "election.json"), null);
  const candidates = Array.isArray(election?.candidates) ? election.candidates : [];
  return candidates
    .filter((candidate) => candidate.result === "当選")
    .map((candidate) => ({
      city,
      cityName,
      seat_number: null,
      name: candidate.name ?? "",
      furigana: candidate.furigana ?? "",
      party: candidate.party ?? "",
      faction: candidate.party ?? "",
      committees: [],
    }));
}

export function buildMinuteEvidenceBySchedule(council) {
  const minutesByScheduleAndId = new Map();
  for (const schedule of council?.schedules ?? []) {
    const scheduleId = Number(schedule?.schedule_id);
    if (!Number.isFinite(scheduleId) || scheduleId <= 0) continue;
    for (const minute of schedule?.minutes ?? []) {
      const minuteId = Number(minute?.minute_id);
      if (!Number.isFinite(minuteId)) continue;
      const text = cleanText([
        minute?.title,
        minute?.minute_type,
        minute?.text,
      ].filter(Boolean).join(" "));
      if (!text) continue;
      const key = `${scheduleId}:${minuteId}`;
      const values = minutesByScheduleAndId.get(key) ?? [];
      values.push(text);
      minutesByScheduleAndId.set(key, values);
    }
  }
  return minutesByScheduleAndId;
}

export function selectScheduledMinuteEvidence(
  minutesByScheduleAndId,
  scheduleIdValue,
  evidenceMinuteIds
) {
  const scheduleId = Number(scheduleIdValue);
  if (!Number.isFinite(scheduleId) || scheduleId <= 0) return [];
  return Array.from(new Set(
    (Array.isArray(evidenceMinuteIds) ? evidenceMinuteIds : [])
      .map(Number)
      .filter((minuteId) => Number.isFinite(minuteId))
      .flatMap((minuteId) => minutesByScheduleAndId.get(`${scheduleId}:${minuteId}`) ?? [])
  ));
}

export function topicsContainedInEvidence(values, evidenceText, limit = 24) {
  const compactEvidence = compactForSearch(evidenceText);
  return (Array.isArray(values) ? values : [])
    .map(cleanText)
    .filter((topic) => {
      const compactTopic = compactForSearch(topic);
      return compactTopic.length > 0 && compactEvidence.includes(compactTopic);
    })
    .slice(0, limit);
}

function buildMemberActivities(city, cityName) {
  const activity = readJson(path.join(DATA_DIR, city, "members_activity.json"), {});
  if (!activity || typeof activity !== "object" || Array.isArray(activity)) return [];
  const published = publishedCouncilIds(city);
  const segmentCache = new Map();
  const minuteCache = new Map();
  const sessionTranscriptCache = new Map();

  const evidenceText = (session) => {
    const councilId = Number(session?.council_id);
    if (!Number.isFinite(councilId)) return "";

    const evidenceSegmentIds = Array.isArray(session?.evidence_segment_ids)
      ? session.evidence_segment_ids.map(cleanText).filter(Boolean)
      : [];
    const evidenceSegmentIdSet = new Set(evidenceSegmentIds);
    let segmentById = segmentCache.get(councilId);
    if (!segmentById) {
      const siteSegmentsPath = path.join(DATA_DIR, city, "segments", `${councilId}.json`);
      const sourceSegments = readJson(
        path.join(SOURCE_DATA_DIR, city, "segments", `${councilId}.json`),
        readJson(siteSegmentsPath, [])
      );
      segmentById = new Map(
        (Array.isArray(sourceSegments) ? sourceSegments : [])
          .map((segment) => [
            cleanText(segment?.id ?? segment?.segment_id),
            cleanText([
              segment?.speaker,
              segment?.speaker_role,
              segment?.member_name,
              segment?.text,
            ].filter(Boolean).join(" ")),
          ])
          .filter(([id, text]) => id && text)
      );
      segmentCache.set(councilId, segmentById);
    }

    const segmentText = evidenceSegmentIds
      .map((id) => segmentById.get(id))
      .filter(Boolean);
    if (memberActivitySearchSourceType(session) === "session") {
      const sessionId = cleanText(session?.href).match(/\/sessions\/([^#?]+)/)?.[1] ?? "";
      if (sessionId) {
        let transcriptSession = sessionTranscriptCache.get(sessionId);
        if (transcriptSession === undefined) {
          transcriptSession = readJson(
            path.join(DATA_DIR, city, "sessions", `${sessionId}.json`),
            null
          );
          sessionTranscriptCache.set(sessionId, transcriptSession);
        }
        for (const transcriptSegment of transcriptSession?.segments ?? []) {
          const evidenceId = `session:${sessionId}:${Number(transcriptSegment?.index)}`;
          if (!evidenceSegmentIdSet.has(evidenceId)) continue;
          const text = cleanText([
            transcriptSegment?.label,
            transcriptSegment?.speaker,
            transcriptSegment?.detail?.speaker,
            transcriptSegment?.transcript,
          ].filter(Boolean).join(" "));
          if (text) segmentText.push(text);
        }
      }
    }

    const evidenceMinuteIds = new Set(
      (Array.isArray(session?.evidence_minute_ids) ? session.evidence_minute_ids : [])
        .map(Number)
        .filter((minuteId) => Number.isFinite(minuteId))
    );
    const scheduleId = Number(session?.schedule_id);
    if (
      evidenceMinuteIds.size === 0
      || !Number.isFinite(scheduleId)
      || scheduleId <= 0
    ) {
      return Array.from(new Set(segmentText)).join(" ");
    }

    let minutesByScheduleAndId = minuteCache.get(councilId);
    if (!minutesByScheduleAndId) {
      const council = readJson(path.join(DATA_DIR, city, "minutes", `${councilId}.json`), null);
      minutesByScheduleAndId = buildMinuteEvidenceBySchedule(council);
      minuteCache.set(councilId, minutesByScheduleAndId);
    }
    const minuteText = selectScheduledMinuteEvidence(
      minutesByScheduleAndId,
      scheduleId,
      Array.from(evidenceMinuteIds)
    );
    return Array.from(new Set([...segmentText, ...minuteText])).join(" ");
  };

  return Object.values(activity).flatMap((entry) => {
    if (entry?.classification_status !== "classified") return [];
    const memberName = cleanText(entry?.name);
    const sessions = Array.isArray(entry?.sessions) ? entry.sessions : [];
    if (!memberName || sessions.length === 0) return [];

    return sessions
      .filter((session) => {
        const councilId = Number(session?.council_id);
        if (!Number.isFinite(councilId) || councilId < 0) return false;
        return memberActivitySearchSourceType(session) !== "minutes"
          || published.has(councilId);
      })
      .map((session) => {
        const councilName = cleanText(session.session);
        const fullSearchText = evidenceText(session);
        const canonicalTopics = topicsContainedInEvidence(
          session.canonical_topics,
          fullSearchText,
          24
        );
        const rawEvidenceTopics = topicsContainedInEvidence(
          session.topics,
          fullSearchText,
          6
        );
        return {
          city,
          cityName,
          member_name: memberName,
          record_id: cleanText(session.record_id),
          council_id: Number(session.council_id),
          council_name: councilName,
          year: cleanText(session.year) || yearFromCouncilName(councilName),
          date: cleanText(session.date),
          href: cleanText(session.href),
          question_kind: cleanText(session.question_kind),
          source_type: cleanText(session.source_type),
          source_label: cleanText(session.source_label),
          source_status: cleanText(session.source_status),
          start_time: cleanText(session.start_time),
          topics: rawEvidenceTopics,
          canonical_topics: canonicalTopics,
          [MEMBER_ACTIVITY_SEARCH_TEXT]: fullSearchText,
        };
      });
  });
}

function buildSegmentFallbackAgendas({ city, cityName, councilId, councilName, year }) {
  const segments = readJson(path.join(DATA_DIR, city, "segments", `${councilId}.json`), []);
  if (!Array.isArray(segments) || segments.length === 0) return [];

  return segments
    .filter((seg) => !seg.is_procedural && cleanText(seg.text))
    .map((seg, index) => {
      const speaker = cleanText(seg.speaker);
      const role = cleanText(seg.speaker_role);
      const body = cleanText(seg.text);
      const scheduleId = Number.isFinite(Number(seg.schedule_id)) ? Number(seg.schedule_id) : 1;
      const scheduleName = cleanText(seg.schedule_name);
      return {
        city,
        cityName,
        council_id: councilId,
        council_name: councilName,
        year,
        date: dateFromScheduleName(year, scheduleName),
        schedule_id: scheduleId,
        schedule_index: Math.max(0, scheduleId - 1),
        schedule_name: scheduleName,
        agenda_title: [role, speaker].filter(Boolean).join(": ") || `発言 ${index + 1}`,
        first_minute_id: 0,
        text: body.slice(0, EXCERPT_MAX),
        truncated: body.length > EXCERPT_MAX,
        [FULL_SEARCH_TEXT]: body,
      };
    });
}

function buildIndex(
  inputFingerprint = computeSearchIndexInputFingerprint(),
  { coverageOnly = false } = {}
) {
  const municipalitiesPath = path.join(DATA_DIR, "municipalities.json");
  const municipalities = JSON.parse(fs.readFileSync(municipalitiesPath, "utf-8"));
  const restrictedMinutesCities = new Set(
    municipalities.filter(minutesSearchIsRestricted).map((municipality) => municipality.slug)
  );
  const segmentFallbackCities = new Set(readJson(SEGMENT_FALLBACKS_FILE, []));

  /** @type {Array<object>} */
  const agendas = [];
  /** @type {Array<object>} */
  const sessions = [];
  /** @type {Array<object>} */
  const enriched = [];
  /** @type {Array<object>} */
  const decisions = [];
  /** @type {Array<object>} */
  const members = [];
  /** @type {Array<object>} */
  const memberActivities = [];

  const cityDirs = fs
    .readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
    .map((d) => d.name);

  for (const city of cityDirs) {
    const cityName = getCityName(municipalities, city);
    const minutesRestricted = restrictedMinutesCities.has(city);
    if (!minutesRestricted) {
      sessions.push(...buildSessions(city, cityName));
      enriched.push(...buildEnrichedDocs(city, cityName));
      memberActivities.push(...buildMemberActivities(city, cityName));
    }
    decisions.push(...buildDecisions(city, cityName));
    members.push(...buildMembers(city, cityName));

    if (minutesRestricted) continue;

    const minutesDir = path.join(DATA_DIR, city, "minutes");
    const indexPath = path.join(minutesDir, "index.json");
    if (!fs.existsSync(indexPath)) continue;

    let councilIndex;
    try {
      councilIndex = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
    } catch {
      continue;
    }

    for (const entry of councilIndex) {
      const councilFile = path.join(minutesDir, entry.file);
      if (!fs.existsSync(councilFile)) continue;
      let council;
      try {
        council = JSON.parse(fs.readFileSync(councilFile, "utf-8"));
      } catch {
        continue;
      }

      const councilId = council.council_id ?? entry.council_id;
      const councilName = council.name ?? entry.name;
      const year = entry.year || yearFromCouncilName(councilName);
      const agendaCountBeforeCouncil = agendas.length;

      for (let schIdx = 0; schIdx < (council.schedules ?? []).length; schIdx++) {
        const sch = council.schedules[schIdx];
        let currentAgendaTitle = null;
        let currentAgendaBody = [];
        let currentFirstMinuteId = null;
        const schName = cleanText(sch.name);
        const schDate = dateFromScheduleName(year, schName);

        const flush = () => {
          if (!currentAgendaTitle && currentAgendaBody.length === 0) return;
          const body = cleanText(currentAgendaBody.join(" "));
          agendas.push({
            city,
            cityName,
            council_id: councilId,
            council_name: councilName,
            year,
            date: schDate,
            schedule_id: Number.isFinite(Number(sch?.schedule_id))
              ? Number(sch.schedule_id)
              : schIdx + 1,
            schedule_index: schIdx,
            schedule_name: schName,
            agenda_title: currentAgendaTitle ?? "",
            first_minute_id: currentFirstMinuteId,
            text: body.slice(0, EXCERPT_MAX),
            truncated: body.length > EXCERPT_MAX,
            [FULL_SEARCH_TEXT]: body,
          });
        };

        for (const m of sch.minutes ?? []) {
          if (m.minute_type === "名簿") continue;
          if (m.minute_type === AGENDA_MARKER) {
            flush();
            currentAgendaTitle = cleanText(m.text).replace(/^△/, "");
            currentAgendaBody = [];
            currentFirstMinuteId = m.minute_id ?? null;
          } else if (DISCUSSION_TYPES.has(m.minute_type)) {
            if (currentFirstMinuteId === null) currentFirstMinuteId = m.minute_id ?? null;
            const speaker = cleanText(m.title);
            const body = normalizeMinuteBodyForSearchEvidence(speaker, m.text);
            currentAgendaBody.push(speaker ? `${speaker}: ${body}` : body);
          }
        }
        flush();
      }

      if (segmentFallbackCities.has(city) && agendas.length === agendaCountBeforeCouncil) {
        agendas.push(
          ...buildSegmentFallbackAgendas({
            city,
            cityName,
            councilId,
            councilName,
            year,
          })
        );
      }
    }
  }

  const agendaIndexBySchedule = new Map();
  const indexedAgendas = agendas.map((agenda) => {
    const row = { ...agenda };
    const scheduleKey = `${agenda.city}:${agenda.council_id}:${agenda.schedule_index}`;
    const agendaIndex = agendaIndexBySchedule.get(scheduleKey) ?? 0;
    agendaIndexBySchedule.set(scheduleKey, agendaIndex + 1);
    row.agenda_index = agendaIndex;
    return row;
  });
  const out = {
    version: 1,
    generated_at: new Date().toISOString(),
    excerpt_max: EXCERPT_MAX,
    count: indexedAgendas.length,
    agendas: indexedAgendas,
    restricted_minutes_cities: Array.from(restrictedMinutesCities).sort(),
  };

  const runtimeAgendas = indexedAgendas;
  const runtimeOut = {
    ...out,
    agendas: runtimeAgendas,
    scope: "full",
    municipalities: municipalities
      .filter((m) => m.active)
      .map((m) => ({ slug: m.slug, name: m.name })),
    sessions,
    enriched: [],
    decisions,
    members,
    memberActivities,
    restricted_minutes_cities: Array.from(restrictedMinutesCities).sort(),
  };
  const topicsOut = {
    version: 1,
    generated_at: out.generated_at,
    count: enriched.length,
    records: enriched,
  };
  const agendaCountByCity = new Map();
  for (const agenda of agendas) {
    agendaCountByCity.set(agenda.city, (agendaCountByCity.get(agenda.city) ?? 0) + 1);
  }
  const researchCoverageOut = {
    version: 1,
    generated_at: out.generated_at,
    source: "public_agenda_search_index",
    municipalities: runtimeOut.municipalities
      .filter((municipality) => (agendaCountByCity.get(municipality.slug) ?? 0) > 0)
      .map((municipality) => ({
        ...municipality,
        agendaCount: agendaCountByCity.get(municipality.slug),
      })),
  };
  const runtimeMeta = {
    version: out.version,
    generated_at: out.generated_at,
    excerpt_max: out.excerpt_max,
    restricted_minutes_cities: Array.from(restrictedMinutesCities).sort(),
  };
  const cityRuntimeIndexes = runtimeOut.municipalities.map((municipality) => {
    const city = municipality.slug;
    return {
      ...runtimeMeta,
      scope: "city",
      count: runtimeAgendas.filter((row) => row.city === city).length,
      agendas: runtimeAgendas.filter((row) => row.city === city),
      municipalities: [municipality],
      sessions: runtimeOut.sessions.filter((row) => row.city === city),
      enriched: [],
      decisions: runtimeOut.decisions.filter((row) => row.city === city),
      members: runtimeOut.members.filter((row) => row.city === city),
      memberActivities: runtimeOut.memberActivities.filter((row) => row.city === city),
    };
  });

  const coveragePreflight = [];
  for (const cityRuntimeOut of cityRuntimeIndexes) {
    const city = cityRuntimeOut.municipalities[0].slug;
    if (!restrictedMinutesCities.has(city)) {
      coveragePreflight.push(
        buildFullTextCouncilDocuments(city, cityRuntimeOut).scheduleCoverage
      );
    }
  }
  if (coverageOnly) {
    const minuteTypeTotals = {};
    const ignoredBy = {};
    for (const coverage of coveragePreflight) {
      for (const [minuteType, source] of Object.entries(coverage.minute_type_totals)) {
        const total = minuteTypeTotals[minuteType] ?? {
          source_rows: 0,
          source_schedules: 0,
          source_body_compact_chars: 0,
          indexed_rows: 0,
          indexed_schedules: 0,
          indexed_compact_chars: 0,
          excluded_rows: 0,
          excluded_schedules: 0,
          excluded_body_compact_chars: 0,
          excluded_reasons: {},
        };
        for (const field of [
          "source_rows",
          "source_schedules",
          "source_body_compact_chars",
          "indexed_rows",
          "indexed_schedules",
          "indexed_compact_chars",
          "excluded_rows",
          "excluded_schedules",
          "excluded_body_compact_chars",
        ]) {
          total[field] += source[field];
        }
        for (const [reason, count] of Object.entries(source.excluded_reasons)) {
          total.excluded_reasons[reason] = (total.excluded_reasons[reason] ?? 0) + count;
        }
        minuteTypeTotals[minuteType] = total;
      }
      for (const [reason, count] of Object.entries(coverage.ignored_by)) {
        ignoredBy[reason] = (ignoredBy[reason] ?? 0) + count;
      }
    }
    const schedules = coveragePreflight.reduce((sum, coverage) => sum + coverage.total_schedules, 0);
    const covered = coveragePreflight.reduce((sum, coverage) => sum + coverage.covered_schedules, 0);
    console.log(
      `search schedule coverage preflight passed: ${coveragePreflight.length} public municipalities, ${schedules} schedules (${covered} exact, ${schedules - covered} ignored)`
    );
    console.log(`schedule ignored reasons: ${JSON.stringify(ignoredBy)}`);
    console.log(`minute type coverage: ${JSON.stringify(minuteTypeTotals)}`);
    return;
  }

  invalidateSearchBuildState();

  fs.writeFileSync(OUT_FILE, JSON.stringify(out));
  fs.mkdirSync(PUBLIC_GENERATED_DIR, { recursive: true });
  fs.rmSync(LEGACY_PUBLIC_RECENT_SEARCH_INDEX_FILE, { force: true });
  fs.rmSync(LEGACY_PUBLIC_SEARCH_INDEX_SHARDS_DIR, { recursive: true, force: true });
  const compatibilityIndexStats = writeAgendaCompatibilityIndexes(
    runtimeOut,
    cityRuntimeIndexes
  );
  fs.rmSync(PUBLIC_CITY_BIGRAM_INDEX_DIR, { recursive: true, force: true });
  fs.mkdirSync(PUBLIC_CITY_BIGRAM_INDEX_DIR, { recursive: true });
  fs.rmSync(PUBLIC_STATEWIDE_BIGRAM_INDEX_DIR, { recursive: true, force: true });
  fs.mkdirSync(PUBLIC_STATEWIDE_BIGRAM_INDEX_DIR, { recursive: true });
  fs.writeFileSync(PUBLIC_RESEARCH_COVERAGE_FILE, JSON.stringify(researchCoverageOut));
  const memberActivityManifest = writeMemberActivityShards(
    runtimeOut.municipalities,
    out.generated_at,
    restrictedMinutesCities
  );
  const searchAssetCatalog = {};
  const bigramDocumentRangeWriter = createBigramDocumentRangeWriters(searchAssetCatalog);
  const statewidePostingSpool = createStatewidePostingSpool();
  const statewideBigramCities = [];
  let statewideBigramManifest;
  try {
    for (const cityRuntimeOut of cityRuntimeIndexes) {
      const city = cityRuntimeOut.municipalities[0].slug;
      const { documents: cityBigramDocuments, scheduleCoverage } =
        buildCityBigramDocuments(city, cityRuntimeOut, restrictedMinutesCities.has(city));
      if (cityBigramDocuments.length === 0) continue;
      statewideBigramCities.push({
        ...writeCityBigramIndex(
          city,
          cityBigramDocuments,
          scheduleCoverage,
          bigramDocumentRangeWriter,
          statewidePostingSpool
        ),
        name: cityRuntimeOut.municipalities[0].name,
      });
    }
    bigramDocumentRangeWriter.finish();
    statewideBigramManifest = writeStatewideBigramIndex(
      statewideBigramCities,
      out.generated_at,
      statewidePostingSpool,
      searchAssetCatalog
    );
  } finally {
    bigramDocumentRangeWriter.finish();
    statewidePostingSpool.cleanup();
  }
  fs.writeFileSync(PUBLIC_TOPICS_INDEX_FILE, JSON.stringify(topicsOut));
  const searchBuildState = {
    version: SEARCH_BUILD_STATE_VERSION,
    generated_at: out.generated_at,
    input_fingerprint: inputFingerprint,
    required_assets: searchIndexOwnedAssets(),
  };
  const generatedAssetStats = writeSearchBuildStateAtomically({
    stateFile: PUBLIC_SEARCH_BUILD_STATE_FILE,
    payload: searchBuildState,
    validateAssets: () => assertStaticAssetTree(PUBLIC_GENERATED_DIR),
  });
  const stat = fs.statSync(OUT_FILE);
  const topicsStat = fs.statSync(PUBLIC_TOPICS_INDEX_FILE);
  console.log(
    `search-index written: ${OUT_FILE.replace(SITE_DIR, "site")} (${agendas.length} agendas, ${(stat.size / 1024 / 1024).toFixed(1)} MB)`
  );
  console.log(
    `agenda compatibility indexes: global ${formatMiB(compatibilityIndexStats.globalBytes)}, cities ${formatMiB(compatibilityIndexStats.cityBytes)}`
  );
  console.log(
    `statewide bigram search-index written: ${statewideBigramManifest.cities.length} municipalities, ${statewideBigramManifest.document_count} documents`
  );
  console.log(`posting spool peak: ${formatMiB(statewidePostingSpool.bytesWritten)}`);
  console.log(`posting spool open handles peak: ${statewidePostingSpool.peakOpenHandles}`);
  console.log(
    `generated static assets: ${generatedAssetStats.files.toLocaleString()} files, ${formatMiB(generatedAssetStats.bytes)}`
  );
  console.log(`member activity sharded: ${memberActivityManifest.count} municipalities`);
  console.log(
    `topics-index written: ${PUBLIC_TOPICS_INDEX_FILE.replace(SITE_DIR, "site")} (${enriched.length} records, ${(topicsStat.size / 1024 / 1024).toFixed(1)} MB)`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_FILE) {
  const inputFingerprint = computeSearchIndexInputFingerprint();
  if (process.argv.includes("--if-stale") && currentSearchBuildIsFresh(inputFingerprint)) {
    console.log("search-index is fresh; build skipped");
  } else {
    buildIndex(inputFingerprint, { coverageOnly: process.argv.includes("--coverage-only") });
  }
}
