#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { createHash } from "node:crypto";
import {
  buildMinuteEvidenceBySchedule,
  classifyRawScheduleFallback,
  excludedRawMinuteHasSubstantiveText,
  invalidateSearchBuildState,
  selectScheduledMinuteEvidence,
} from "./build-search-index.mjs";
import { SEARCH_EXACT_POSTING_TERMS } from "../src/lib/searchExactPostingTerms.mjs";
import { compactForSearch } from "../src/lib/searchNormalization.mjs";
import {
  MAX_SEARCH_ASSET_REQUESTS_PER_QUERY,
  runtimeAgendaResultId,
} from "../src/lib/searchQueryLimits.mjs";
import {
  SEARCH_POSTING_BUCKET_COUNT,
  searchPostingBucket as bigramBucket,
  searchPostingBucketAssetFile as bucketFileForBucket,
} from "../src/lib/searchBigramCandidates.mjs";
import {
  exactSearchAssetMetadataMatches,
  searchAssetPlanFromCatalog,
  validSearchAssetMetadata,
} from "../src/lib/searchTransferBudget.mjs";
import {
  assertCanonicalSearchPostingBuckets,
  assertCitySearchManifestContract,
  assertExactSearchAssetUrlSet,
  assertStatewideSearchCityCoverage,
  assertWholeExactTextAssetBlock,
} from "./lib/search-index-artifact-contract.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SITE_DIR = path.resolve(SCRIPT_DIR, "..");
const GENERATED_DIR = path.join(SITE_DIR, "public", "generated");
const COMPATIBILITY_INDEX_FILE = path.join(GENERATED_DIR, "search-index.json");
const CITY_COMPATIBILITY_INDEX_DIR = path.join(GENERATED_DIR, "search-indexes");
const STATEWIDE_BIGRAM_DIR = path.join(GENERATED_DIR, "search-bigram-statewide");
const CITY_BIGRAM_DIR = path.join(GENERATED_DIR, "search-bigram-cities");
const MEMBER_ACTIVITY_DIR = path.join(GENERATED_DIR, "member-activity");
const MAX_STATIC_ASSET_BYTES = 24 * 1024 * 1024;
const MAX_GENERATED_ASSET_FILES = 16_500;
const MAX_GENERATED_ASSET_BYTES = 750 * 1024 * 1024;
const MAX_TYPICAL_QUERY_RAW_BYTES = 64 * 1024 * 1024;
const MAX_TYPICAL_QUERY_GZIP_BYTES = 16 * 1024 * 1024;
const MAX_DECODED_GZIP_ASSET_BYTES = 64 * 1024 * 1024;
const MAX_EXACT_TEXT_SNIPPET_BLOCKS_PER_SEARCH = 12;
const MAX_CITY_SEARCH_MANIFEST_BYTES = 512 * 1024;
const MAX_STATEWIDE_SEARCH_MANIFEST_BYTES = 2 * 1024 * 1024;

function failClosed(error) {
  try {
    invalidateSearchBuildState();
  } catch (stateError) {
    console.error("search build state invalidation failed", stateError);
  }
  console.error(error);
  process.exit(1);
}

process.on("uncaughtException", failClosed);
process.on("unhandledRejection", failClosed);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const municipalityRecords = readJson(path.join(SITE_DIR, "data", "municipalities.json"));
const activeMunicipalities = municipalityRecords.filter((municipality) => municipality.active);
const restrictedMinutesCities = new Set(
  activeMunicipalities
    .filter((municipality) => municipality.minutes_access === "restricted")
    .map((municipality) => municipality.slug)
);

function readSearchAsset(filePath) {
  const buffer = fs.readFileSync(filePath);
  const json = filePath.endsWith(".gz")
    ? zlib.gunzipSync(buffer).toString("utf8")
    : buffer.toString("utf8");
  return JSON.parse(json);
}

function walkFiles(rootDir) {
  const files = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(entryPath);
      else if (entry.isFile()) files.push(entryPath);
    }
  }
  return files;
}

function generatedAssetUrlsUnder(rootDir) {
  if (!fs.existsSync(rootDir)) return [];
  return walkFiles(rootDir).map((filePath) =>
    `/generated/${path.relative(GENERATED_DIR, filePath).split(path.sep).join("/")}`
  );
}

function compact(text) {
  return compactForSearch(text);
}

function sha256(text) {
  return createHash("sha256").update(String(text ?? "")).digest("hex");
}

function sha256Buffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function generatedPathForUrl(url) {
  invariant(
    typeof url === "string" && url.startsWith("/generated/"),
    `invalid generated search asset URL: ${url}`
  );
  return path.join(GENERATED_DIR, url.replace(/^\/generated\//, ""));
}

function readAndValidateSearchAssetCatalog(reference, generatedAt) {
  invariant(
    reference?.encoding === "gzip"
    && validSearchAssetMetadata(reference)
    && reference.url === "/generated/search-bigram-statewide/asset-catalog.json.gz",
    "statewide search asset catalog reference is invalid"
  );
  const filePath = generatedPathForUrl(reference.url);
  invariant(fs.existsSync(filePath), "statewide search asset catalog is missing");
  const compressed = fs.readFileSync(filePath);
  invariant(
    compressed.length === reference.bytes && sha256Buffer(compressed) === reference.sha256,
    "statewide search asset catalog compressed bytes/hash mismatch"
  );
  const raw = zlib.gunzipSync(compressed);
  invariant(
    raw.length === reference.raw_bytes && sha256Buffer(raw) === reference.raw_sha256,
    "statewide search asset catalog raw bytes/hash mismatch"
  );
  const catalog = JSON.parse(raw.toString("utf8"));
  invariant(
    catalog?.version === 1
    && catalog.generated_at === generatedAt
    && catalog.assets
    && typeof catalog.assets === "object"
    && !Array.isArray(catalog.assets),
    "statewide search asset catalog schema/generation mismatch"
  );
  for (const [key, asset] of Object.entries(catalog.assets)) {
    invariant(validSearchAssetMetadata(asset), `invalid search asset catalog entry: ${key}`);
  }
  return catalog;
}

function readScheduleCoverageAsset(cityMeta, cityManifest) {
  const fields = [
    "coverage_url",
    "coverage_encoding",
    "coverage_bytes",
    "coverage_raw_bytes",
    "coverage_sha256",
    "coverage_counts",
  ];
  for (const field of fields) {
    invariant(
      JSON.stringify(cityMeta[field]) === JSON.stringify(cityManifest[field]),
      `${cityMeta.slug}: city/statewide coverage reference differs (${field})`
    );
  }
  invariant(
    cityMeta.coverage_encoding === "gzip"
    && typeof cityMeta.coverage_url === "string"
    && cityMeta.coverage_url.startsWith("/generated/search-bigram-statewide/coverage/"),
    `${cityMeta.slug}: schedule coverage asset reference is invalid`
  );
  const filePath = path.join(
    GENERATED_DIR,
    cityMeta.coverage_url.replace(/^\/generated\//, "")
  );
  const compressed = fs.readFileSync(filePath);
  invariant(
    compressed.length === cityMeta.coverage_bytes,
    `${cityMeta.slug}: schedule coverage compressed bytes differ`
  );
  const raw = zlib.gunzipSync(compressed);
  invariant(
    raw.length === cityMeta.coverage_raw_bytes,
    `${cityMeta.slug}: schedule coverage raw bytes differ`
  );
  invariant(
    createHash("sha256").update(raw).digest("hex") === cityMeta.coverage_sha256,
    `${cityMeta.slug}: schedule coverage hash differs`
  );
  return JSON.parse(raw.toString("utf8"));
}

function synonymExactPostingVocabulary() {
  const source = fs.readFileSync(path.join(SITE_DIR, "src", "lib", "searchSynonyms.ts"), "utf8");
  const terms = new Set();
  const entryPattern = /canonical:\s*"([^"]+)"\s*,\s*aliases:\s*\[([^\]]*)\]/g;
  for (const match of source.matchAll(entryPattern)) {
    const values = [
      match[1],
      ...Array.from(match[2].matchAll(/"([^"]+)"/g), (alias) => alias[1]),
    ];
    for (const value of values) {
      const normalized = compact(value);
      if (normalized.length > 2) terms.add(normalized);
    }
  }
  return terms;
}

function searchSynonymEntries() {
  const source = fs.readFileSync(path.join(SITE_DIR, "src", "lib", "searchSynonyms.ts"), "utf8");
  const entries = [];
  const entryPattern = /\{\s*canonical:\s*"([^"]+)"\s*,\s*aliases:\s*\[([^\]]*)\][^}]*kind:\s*"(exact|related)"/g;
  for (const match of source.matchAll(entryPattern)) {
    entries.push({
      canonical: match[1],
      aliases: Array.from(match[2].matchAll(/"([^"]+)"/g), (alias) => alias[1]),
      kind: match[3],
    });
  }
  return entries;
}

function looseTermMatch(token, term) {
  if (!token || !term) return false;
  if (token === term) return true;
  if (token.length >= 2 && term.includes(token) && term.length - token.length <= 2) return true;
  return term.length >= 2 && token.includes(term);
}

function expandedClientQueryVariants(query) {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  const variantsByToken = tokens.map((token) => {
    const normalizedToken = compact(token);
    const variants = new Set([normalizedToken]);
    for (const entry of searchSynonymEntries()) {
      const terms = [entry.canonical, ...entry.aliases];
      const matchedTerms = terms.filter((term) =>
        looseTermMatch(normalizedToken, compact(term))
      );
      if (matchedTerms.length === 0) continue;
      for (const term of [entry.canonical, ...matchedTerms]) variants.add(compact(term));
    }
    return Array.from(variants).filter(Boolean);
  });
  return variantsByToken.reduce(
    (queries, variants) => queries.flatMap((prefix) =>
      variants.map((variant) => [...prefix, variant])
    ),
    [[]]
  ).map((tokensForQuery) => tokensForQuery.join(" "));
}

function bigrams(text) {
  const normalized = compact(text);
  if (!normalized) return [];
  if (normalized.length === 1) return [normalized];
  return Array.from(
    new Set(Array.from({ length: normalized.length - 1 }, (_, index) => normalized.slice(index, index + 2)))
  );
}

function trigrams(text) {
  const normalized = compact(text);
  if (normalized.length < 3) return [];
  return Array.from(
    { length: normalized.length - 2 },
    (_, index) => normalized.slice(index, index + 3)
  );
}

function candidateNgrams(text) {
  const normalized = compact(text);
  return normalized.length >= 3 ? trigrams(normalized) : bigrams(normalized);
}

function bucketFile(term) {
  return bucketFileForBucket(bigramBucket(term));
}

function indexedToken(token) {
  const normalized = compact(token);
  const exactPosting = statewideManifest?.exact_terms?.includes(normalized);
  return {
    normalized,
    terms: exactPosting ? [normalized] : candidateNgrams(normalized),
    positional: normalized.length > 3 && !exactPosting,
  };
}

const decodedPostingCache = new Map();

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
  throw new Error("truncated document posting");
}

function decodePosting(value) {
  if (decodedPostingCache.has(value)) return decodedPostingCache.get(value);
  if (Array.isArray(value) && value.length === 0) {
    const decoded = { documentIds: [] };
    decodedPostingCache.set(value, decoded);
    return decoded;
  }
  invariant(typeof value === "string" && value.length > 0, "invalid document posting");
  const buffer = Buffer.from(value, "base64");
  const state = { offset: 0 };
  const documentIds = [];
  let previousDocumentId = -1;
  while (state.offset < buffer.length) {
    const delta = readUnsignedPostingVarint(buffer, state);
    invariant(delta > 0, "invalid document posting delta");
    const documentId = previousDocumentId + delta;
    documentIds.push(documentId);
    previousDocumentId = documentId;
  }
  const decoded = { documentIds };
  decodedPostingCache.set(value, decoded);
  return decoded;
}

function intersect(left, right) {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
}

function candidateIdsForCity(query, city) {
  const tokenGroups = query.trim().split(/\s+/).filter(Boolean).map(indexedToken);
  const terms = Array.from(new Set(tokenGroups.flatMap((token) => token.terms)));
  const buckets = new Map();
  for (const file of new Set(terms.map(bucketFile))) {
    buckets.set(file, readSearchAsset(path.join(STATEWIDE_BIGRAM_DIR, "postings", file)));
  }
  return candidateResolutionForCityFromBuckets(tokenGroups, city, buckets).candidateIds;
}

function candidateIdsByCity(query) {
  const tokenGroups = query.trim().split(/\s+/).filter(Boolean).map(indexedToken);
  const terms = Array.from(new Set(tokenGroups.flatMap((token) => token.terms)));
  const buckets = new Map();
  for (const file of new Set(terms.map(bucketFile))) {
    buckets.set(file, readSearchAsset(path.join(STATEWIDE_BIGRAM_DIR, "postings", file)));
  }
  const cities = new Set();
  for (const group of tokenGroups) {
    for (const term of group.terms) {
      for (const city of Object.keys(buckets.get(bucketFile(term))?.[term] ?? {})) {
        cities.add(city);
      }
    }
  }
  return new Map(
    Array.from(cities, (city) => [city, candidateResolutionForCityFromBuckets(tokenGroups, city, buckets)])
      .filter(([, resolution]) => resolution.candidateIds.length > 0)
  );
}

function candidateResolutionForCityFromBuckets(tokenGroups, city, buckets) {
  let needsVerification = false;
  const candidatesByGroup = tokenGroups.map((group) => {
    const postings = group.terms.map((term) =>
      decodePosting(buckets.get(bucketFile(term))?.[term]?.[city] ?? [])
    );
    const lists = postings.map((posting) => posting.documentIds);
    if (lists.some((list) => list.length === 0)) return [];
    const broadCandidates = lists
      .slice(1)
      .reduce((ids, list) => intersect(ids, list), lists[0] ?? []);
    if (!group.positional) return broadCandidates;
    needsVerification = true;
    return broadCandidates;
  });
  if (candidatesByGroup.some((ids) => ids.length === 0)) {
    return { candidateIds: [], verificationIds: [] };
  }
  const candidateIds = candidatesByGroup
    .slice(1)
    .reduce((ids, group) => intersect(ids, group), candidatesByGroup[0] ?? []);
  return {
    candidateIds,
    verificationIds: needsVerification ? candidateIds : [],
  };
}

function publishedCouncilIds(city) {
  if (restrictedMinutesCities.has(city)) return new Set();
  const indexPath = path.join(SITE_DIR, "data", city, "minutes", "index.json");
  if (!fs.existsSync(indexPath)) return new Set();
  const index = readJson(indexPath);
  invariant(Array.isArray(index), `${city}: minutes/index.json is not an array`);
  return new Set(
    index
      .map((entry) => Number(entry?.council_id))
      .filter((councilId) => Number.isFinite(councilId))
  );
}

function publishedSchedules(city) {
  if (restrictedMinutesCities.has(city)) return [];
  const minutesDir = path.join(SITE_DIR, "data", city, "minutes");
  const indexPath = path.join(minutesDir, "index.json");
  if (!fs.existsSync(indexPath)) return [];
  const index = readJson(indexPath);
  invariant(Array.isArray(index), `${city}: minutes/index.json is not an array`);
  return index.flatMap((entry) => {
    const councilId = Number(entry?.council_id);
    invariant(Number.isFinite(councilId), `${city}: publication council_id is invalid`);
    const councilPath = path.join(minutesDir, String(entry?.file ?? `${councilId}.json`));
    invariant(fs.existsSync(councilPath), `${city}/${councilId}: published council file is missing`);
    const council = readJson(councilPath);
    invariant(Array.isArray(council?.schedules), `${city}/${councilId}: schedules are missing`);
    const scheduleIds = new Set();
    return council.schedules.map((schedule, scheduleIndex) => {
      const scheduleId = Number(schedule?.schedule_id);
      invariant(Number.isFinite(scheduleId), `${city}/${councilId}: schedule_id is missing`);
      invariant(!scheduleIds.has(scheduleId), `${city}/${councilId}: duplicate schedule_id ${scheduleId}`);
      scheduleIds.add(scheduleId);
      return { councilId, scheduleId, scheduleIndex, schedule };
    });
  });
}

function verifyScheduleCoverage(cityMeta, cityManifest, documents) {
  invariant(
    !Object.hasOwn(cityMeta, "schedule_coverage")
    && !Object.hasOwn(cityManifest, "schedule_coverage"),
    `${cityMeta.slug}: detailed schedule coverage leaked into runtime manifest`
  );
  const coverage = readScheduleCoverageAsset(cityMeta, cityManifest);
  invariant(coverage && typeof coverage === "object", `${cityMeta.slug}: schedule coverage missing`);
  invariant(
    JSON.stringify(cityMeta.coverage_counts) === JSON.stringify({
      published_councils: coverage.published_councils,
      total_schedules: coverage.total_schedules,
      covered_schedules: coverage.covered_schedules,
      ignored_schedules: coverage.ignored_schedules.length,
    }),
    `${cityMeta.slug}: coverage manifest counts differ`
  );
  invariant(Array.isArray(coverage.schedules), `${cityMeta.slug}: schedule ledger missing`);
  invariant(Array.isArray(coverage.ignored_schedules), `${cityMeta.slug}: ignored schedule ledger missing`);

  if (restrictedMinutesCities.has(cityMeta.slug)) {
    const sourcePublicationIndex = readJson(
      path.join(SITE_DIR, "data", cityMeta.slug, "minutes", "index.json")
    );
    invariant(coverage.restricted === true, `${cityMeta.slug}: restricted schedule ledger flag missing`);
    invariant(
      coverage.restriction_reason === "minutes-access-restricted",
      `${cityMeta.slug}: restricted schedule ledger reason mismatch`
    );
    invariant(cityManifest.minutes_access === "restricted", `${cityMeta.slug}: city access flag mismatch`);
    invariant(
      coverage.total_schedules === 0
      && coverage.published_councils === 0
      && coverage.ledger_councils === 0
      && coverage.excluded_publication_councils === sourcePublicationIndex.length
      && coverage.covered_schedules === 0
      && coverage.schedules.length === 0
      && coverage.ignored_schedules.length === 0,
      `${cityMeta.slug}: restricted schedule data leaked into coverage ledger`
    );
  }

  const publicationSchedules = publishedSchedules(cityMeta.slug);
  invariant(
    coverage.published_councils === publishedCouncilIds(cityMeta.slug).size
    && coverage.ledger_councils === coverage.published_councils,
    `${cityMeta.slug}: publication council ledger count mismatch`
  );
  invariant(
    coverage.total_schedules === publicationSchedules.length,
    `${cityMeta.slug}: publication schedule total mismatch`
  );
  invariant(
    coverage.schedules.length === publicationSchedules.length,
    `${cityMeta.slug}: schedule ledger does not cover every publication schedule`
  );
  invariant(
    coverage.covered_schedules + coverage.ignored_schedules.length === publicationSchedules.length,
    `${cityMeta.slug}: covered/ignored schedule totals differ`
  );

  const documentsById = new Map(documents.map((document, documentId) => [
    document?.id,
    { document, documentId },
  ]));
  const minuteTypeTotals = {};
  const ignoredBy = {};
  const ledgerByKey = new Map();
  for (const row of coverage.schedules) {
    const key = `${Number(row.council_id)}:${Number(row.schedule_id)}`;
    invariant(!ledgerByKey.has(key), `${cityMeta.slug}: duplicate schedule ledger key ${key}`);
    ledgerByKey.set(key, row);
  }

  for (const publication of publicationSchedules) {
    const key = `${publication.councilId}:${publication.scheduleId}`;
    const row = ledgerByKey.get(key);
    invariant(row, `${cityMeta.slug}: schedule ledger row missing for ${key}`);
    invariant(
      Number(row.schedule_index) === publication.scheduleIndex,
      `${cityMeta.slug}: schedule index mismatch for ${key}`
    );
    const raw = classifyRawScheduleFallback(publication.schedule);
    invariant(
      !(publication.schedule?.minutes ?? []).some(excludedRawMinuteHasSubstantiveText),
      `${cityMeta.slug}: excluded roster/procedural row contains discussion text for ${key}`
    );
    invariant(row.raw_sha256 === raw.raw_sha256, `${cityMeta.slug}: raw schedule hash mismatch for ${key}`);
    invariant(
      row.raw_compact_chars === raw.raw_compact_chars,
      `${cityMeta.slug}: raw schedule character count mismatch for ${key}`
    );
    invariant(
      JSON.stringify(row.minute_type_ledger) === JSON.stringify(raw.minute_type_ledger),
      `${cityMeta.slug}: minute type ledger mismatch for ${key}`
    );
    const ledgerIndexedCharacters = raw.minute_type_ledger.reduce(
      (sum, typeRow) => sum + typeRow.indexed_compact_chars,
      0
    );
    invariant(
      raw.status === "covered"
        ? ledgerIndexedCharacters === raw.raw_compact_chars
        : ledgerIndexedCharacters === 0,
      `${cityMeta.slug}: minute type ledger indexed character semantics mismatch for ${key}`
    );
    for (const typeRow of raw.minute_type_ledger) {
      invariant(
        typeRow.source_rows === typeRow.indexed_rows + typeRow.excluded_rows,
        `${cityMeta.slug}: minute type source/indexed/excluded rows differ for ${key}/${typeRow.minute_type}`
      );
      invariant(
        Object.values(typeRow.excluded_reasons).reduce((sum, count) => sum + count, 0)
          === typeRow.excluded_rows,
        `${cityMeta.slug}: minute type excluded reason rows differ for ${key}/${typeRow.minute_type}`
      );
      const total = minuteTypeTotals[typeRow.minute_type] ?? {
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
      total.source_rows += typeRow.source_rows;
      total.source_schedules += typeRow.source_schedules;
      total.source_body_compact_chars += typeRow.source_body_compact_chars;
      total.indexed_rows += typeRow.indexed_rows;
      total.indexed_schedules += typeRow.indexed_schedules;
      total.indexed_compact_chars += typeRow.indexed_compact_chars;
      total.excluded_rows += typeRow.excluded_rows;
      total.excluded_schedules += typeRow.excluded_schedules;
      total.excluded_body_compact_chars += typeRow.excluded_body_compact_chars;
      for (const [reason, count] of Object.entries(typeRow.excluded_reasons)) {
        total.excluded_reasons[reason] = (total.excluded_reasons[reason] ?? 0) + count;
      }
      minuteTypeTotals[typeRow.minute_type] = total;
    }

    if (row.status === "ignored") {
      invariant(
        [
          "toc-explicit",
          "unreadable-cid",
          "roster-or-procedure-only",
          "image-pdf-needs-ocr-review",
        ].includes(row.reason),
        `${cityMeta.slug}: unclassified ignored schedule ${key} (${row.reason})`
      );
      invariant(raw.status === "ignored", `${cityMeta.slug}: readable raw schedule was ignored for ${key}`);
      invariant(row.search_source_doc_ids.length === 0, `${cityMeta.slug}: ignored schedule has search docs for ${key}`);
      ignoredBy[row.reason] = (ignoredBy[row.reason] ?? 0) + 1;
      continue;
    }

    invariant(row.status === "covered_exact", `${cityMeta.slug}: invalid schedule status for ${key}`);
    invariant(
      ["agenda", "raw-minutes", "segments"].includes(row.source),
      `${cityMeta.slug}: invalid schedule search source for ${key}`
    );
    invariant(
      Array.isArray(row.search_source_docs)
      && row.search_source_docs.length > 0
      && row.search_source_docs.length === row.search_source_doc_ids.length,
      `${cityMeta.slug}: covered schedule search docs missing for ${key}`
    );
    let indexedCharacters = 0;
    const indexedPayloadParts = [];
    for (const sourceDoc of row.search_source_docs) {
      const indexedDocument = documentsById.get(sourceDoc.id);
      invariant(indexedDocument, `${cityMeta.slug}: schedule source document missing (${sourceDoc.id})`);
      const { document, documentId } = indexedDocument;
      invariant(
        document.indexed_payload_sha256 === sourceDoc.payload_sha256,
        `${cityMeta.slug}: schedule payload hash differs (${sourceDoc.id})`
      );
      invariant(
        document.indexed_compact_chars === sourceDoc.compact_chars,
        `${cityMeta.slug}: schedule payload character count differs (${sourceDoc.id})`
      );
      const exactPayload = compact(cityExactText(cityMeta, documentId));
      invariant(
        sourceDoc.payload_sha256 === sha256(exactPayload),
        `${cityMeta.slug}: exact-text payload hash differs (${sourceDoc.id})`
      );
      invariant(
        sourceDoc.compact_chars === exactPayload.length,
        `${cityMeta.slug}: exact-text payload character count differs (${sourceDoc.id})`
      );
      indexedPayloadParts.push(exactPayload);
      indexedCharacters += sourceDoc.compact_chars;
    }
    invariant(
      indexedCharacters === row.indexed_compact_chars,
      `${cityMeta.slug}: indexed schedule character count mismatch for ${key}`
    );
    const indexedPayload = indexedPayloadParts.join("");
    invariant(
      row.indexed_payload_sha256 === sha256(indexedPayload),
      `${cityMeta.slug}: indexed schedule aggregate hash mismatch for ${key}`
    );
    if (row.source === "agenda" || row.source === "raw-minutes") {
      invariant(
        row.raw_sha256 === row.indexed_payload_sha256
        && row.raw_compact_chars === row.indexed_compact_chars,
        `${cityMeta.slug}: raw schedule was not indexed byte-for-byte after normalization for ${key}`
      );
    }
  }
  for (const total of Object.values(minuteTypeTotals)) {
    total.excluded_reasons = Object.fromEntries(
      Object.entries(total.excluded_reasons).sort(([left], [right]) => left.localeCompare(right))
    );
  }
  invariant(
    JSON.stringify(coverage.minute_type_totals) === JSON.stringify(minuteTypeTotals),
    `${cityMeta.slug}: aggregate minute type ledger mismatch`
  );
  const excludedMinuteTypes = Object.entries(minuteTypeTotals)
    .filter(([, total]) => total.excluded_rows > 0)
    .map(([minuteType, total]) => ({
      minute_type: minuteType,
      excluded_rows: total.excluded_rows,
      excluded_schedules: total.excluded_schedules,
      excluded_body_compact_chars: total.excluded_body_compact_chars,
      excluded_reasons: total.excluded_reasons,
    }))
    .sort((left, right) => left.minute_type.localeCompare(right.minute_type, "ja"));
  invariant(
    JSON.stringify(coverage.excluded_minute_types) === JSON.stringify(excludedMinuteTypes),
    `${cityMeta.slug}: excluded minute type ledger mismatch`
  );
  invariant(
    JSON.stringify(coverage.ignored_by) === JSON.stringify(
      Object.fromEntries(Object.entries(ignoredBy).sort(([left], [right]) => left.localeCompare(right)))
    ),
    `${cityMeta.slug}: ignored schedule reason totals mismatch`
  );
  return coverage;
}

function verifyScheduleAwareEvidenceFixture() {
  const council = readJson(path.join(SITE_DIR, "data", "asahikawa", "minutes", "315.json"));
  const activity = readJson(path.join(SITE_DIR, "data", "asahikawa", "members_activity.json"));
  const session = Object.values(activity)
    .flatMap((entry) => entry?.sessions ?? [])
    .find((candidate) => Number(candidate?.council_id) === 315 && Number(candidate?.schedule_id) === 15);
  invariant(session, "asahikawa/315: schedule-aware evidence fixture is missing");
  const evidenceIds = (session.evidence_minute_ids ?? []).map(Number).filter(Number.isFinite);
  const evidence = buildMinuteEvidenceBySchedule(council);
  const selected = selectScheduledMinuteEvidence(evidence, 15, evidenceIds);
  const unsafeBareMatches = Array.from(evidence.entries())
    .filter(([key]) => evidenceIds.includes(Number(key.split(":")[1])))
    .flatMap(([, texts]) => texts);
  invariant(selected.length > 0, "asahikawa/315: schedule-aware evidence selected no source text");
  invariant(
    unsafeBareMatches.length > selected.length,
    "asahikawa/315: duplicate minute_id collision fixture no longer exercises multiple schedules"
  );
  invariant(
    selectScheduledMinuteEvidence(evidence, null, evidenceIds).length === 0,
    "schedule-null minute evidence must fail closed"
  );
  console.log(
    `PASS schedule-aware evidence: asahikawa/315 schedule 15 -> ${selected.length} source rows, `
    + `${unsafeBareMatches.length - selected.length} cross-schedule rows rejected`
  );
}

function validatePayloadRanges(cityMeta, ranges, urlKey) {
  invariant(Array.isArray(ranges), `${cityMeta.slug}: ${urlKey} ranges missing`);
  let expectedStart = 0;
  for (const range of ranges) {
    invariant(range.start === expectedStart, `${cityMeta.slug}: document range gap at ${expectedStart}`);
    invariant(Number.isInteger(range.end) && range.end > range.start, `${cityMeta.slug}: invalid document range`);
    invariant(
      Number.isInteger(range.payload_start)
      && Number.isInteger(range.payload_end)
      && range.payload_start >= 0
      && range.payload_end > range.payload_start,
      `${cityMeta.slug}: invalid document payload range`
    );
    invariant(
      range.payload_end - range.payload_start === range.end - range.start,
      `${cityMeta.slug}: document and payload range lengths differ`
    );
    invariant(range.encoding === "gzip", `${cityMeta.slug}: payload range must use gzip`);
    invariant(
      typeof range[urlKey] === "string" && range[urlKey].startsWith("/generated/"),
      `${cityMeta.slug}: invalid ${urlKey}`
    );
    expectedStart = range.end;
  }
  invariant(expectedStart === cityMeta.document_count, `${cityMeta.slug}: document ranges do not cover every document`);
}

function validateExactTextRanges(cityMeta, ranges) {
  invariant(Array.isArray(ranges), `${cityMeta.slug}: exact text ranges missing`);
  let expectedStart = 0;
  for (const range of ranges) {
    invariant(range.start === expectedStart, `${cityMeta.slug}: exact text range gap at ${expectedStart}`);
    invariant(Number.isInteger(range.end) && range.end > range.start, `${cityMeta.slug}: invalid exact text range`);
    invariant(Number.isInteger(range.byte_start) && range.byte_start >= 0, `${cityMeta.slug}: invalid exact text offset`);
    invariant(Number.isInteger(range.byte_length) && range.byte_length > 0, `${cityMeta.slug}: invalid exact text length`);
    invariant(Number.isInteger(range.raw_bytes) && range.raw_bytes > 0, `${cityMeta.slug}: invalid exact text raw length`);
    invariant(range.encoding === "gzip-member-json", `${cityMeta.slug}: exact text block must use gzip-member-json`);
    invariant(
      typeof range.exact_text_url === "string" && range.exact_text_url.startsWith("/generated/"),
      `${cityMeta.slug}: invalid exact text URL`
    );
    const filePath = path.join(GENERATED_DIR, range.exact_text_url.replace(/^\/generated\//, ""));
    invariant(fs.existsSync(filePath), `${cityMeta.slug}: exact text asset missing`);
    const assetBytes = fs.statSync(filePath).size;
    assertWholeExactTextAssetBlock(range, assetBytes, cityMeta.slug);
    expectedStart = range.end;
  }
  invariant(expectedStart === cityMeta.document_count, `${cityMeta.slug}: exact text ranges do not cover every document`);
}

function payloadRangeFor(cityMeta, ranges, documentId) {
  invariant(Number.isInteger(documentId) && documentId >= 0, `${cityMeta.slug}: invalid document id`);
  const range = ranges.find(
    (candidate) => documentId >= candidate.start && documentId < candidate.end
  );
  invariant(range, `${cityMeta.slug}: document range missing for ${documentId}`);
  return range;
}

const documentRangeCache = new Map();
const exactTextBlockCache = new Map();
let searchAssetCatalog = null;

function catalogAsset(key) {
  const asset = searchAssetCatalog?.assets?.[key];
  invariant(asset, `search asset catalog entry is missing: ${key}`);
  return asset;
}

function verifyWholeGzipCatalogAsset(key, expectedUrl) {
  const asset = catalogAsset(key);
  invariant(
    searchAssetPlanFromCatalog(key, asset).key === key
    && asset.url === expectedUrl,
    `search asset catalog key/URL mismatch: ${key}`
  );
  const filePath = generatedPathForUrl(asset.url);
  invariant(fs.existsSync(filePath), `search asset is missing: ${asset.url}`);
  const compressed = fs.readFileSync(filePath);
  invariant(
    compressed.length === asset.bytes && sha256Buffer(compressed) === asset.sha256,
    `search asset compressed bytes/hash mismatch: ${asset.url}`
  );
  const raw = zlib.gunzipSync(compressed);
  invariant(
    raw.length === asset.raw_bytes && sha256Buffer(raw) === asset.raw_sha256,
    `search asset raw bytes/hash mismatch: ${asset.url}`
  );
  return { compressed, raw };
}

function readDocumentRange(range) {
  if (!documentRangeCache.has(range.documents_url)) {
    const { raw } = verifyWholeGzipCatalogAsset(
      `document:${range.documents_url}`,
      range.documents_url
    );
    const documents = JSON.parse(raw.toString("utf8"));
    invariant(Array.isArray(documents), `${range.documents_url}: document range is not an array`);
    documentRangeCache.set(range.documents_url, documents);
  }
  const documents = documentRangeCache.get(range.documents_url);
  invariant(documents.length >= range.payload_end, `${range.documents_url}: document payload is out of bounds`);
  return documents;
}

function loadVerifiedExactTextBlock(range) {
  const key = `exact:${range.exact_text_url}:${range.byte_start}:${range.byte_length}`;
  const asset = catalogAsset(key);
  invariant(
    exactSearchAssetMetadataMatches(key, asset, {
      url: range.exact_text_url,
      byteStart: range.byte_start,
      bytes: range.byte_length,
      rawBytes: range.raw_bytes,
    }),
    `${range.exact_text_url}: exact text catalog range mismatch`
  );
  const filePath = generatedPathForUrl(range.exact_text_url);
  invariant(
    fs.statSync(filePath).size === asset.asset_bytes,
    `${range.exact_text_url}: exact text asset total differs`
  );
  const file = fs.openSync(filePath, "r");
  const compressed = Buffer.allocUnsafe(range.byte_length);
  try {
    const bytesRead = fs.readSync(file, compressed, 0, compressed.length, range.byte_start);
    invariant(bytesRead === compressed.length, `${range.exact_text_url}: exact text block is truncated`);
  } finally {
    fs.closeSync(file);
  }
  invariant(
    sha256Buffer(compressed) === asset.sha256,
    `${range.exact_text_url}: exact text compressed hash mismatch`
  );
  const raw = zlib.gunzipSync(compressed);
  invariant(
    raw.length === range.raw_bytes
    && raw.length === asset.raw_bytes
    && sha256Buffer(raw) === asset.raw_sha256,
    `${range.exact_text_url}: exact text raw length/hash mismatch`
  );
  const texts = JSON.parse(raw.toString("utf8"));
  invariant(Array.isArray(texts), `${range.exact_text_url}: exact text block is not an array`);
  invariant(
    texts.length === range.end - range.start && texts.every((text) => typeof text === "string"),
    `${range.exact_text_url}: invalid exact text block`
  );
  return texts;
}

function readExactTextBlock(range) {
  const key = `exact:${range.exact_text_url}:${range.byte_start}:${range.byte_length}`;
  if (!exactTextBlockCache.has(key)) {
    exactTextBlockCache.set(key, loadVerifiedExactTextBlock(range));
  }
  return exactTextBlockCache.get(key);
}

function verifySearchAssetCatalog(manifest) {
  const expected = new Map();
  const exactRangesByUrl = new Map();
  const expectedBucketsByCity = new Map(
    manifest.cities.map((cityMeta) => [cityMeta.slug, new Set()])
  );
  for (const file of manifest.buckets) {
    const url = `/generated/search-bigram-statewide/postings/${file}`;
    invariant(
      url.startsWith("/generated/search-bigram-statewide/postings/"),
      `invalid posting URL: ${url}`
    );
    expected.set(`posting:${url}`, { kind: "posting", url });
  }
  for (const cityMeta of manifest.cities) {
    for (const range of cityMeta.document_ranges) {
      invariant(
        range.documents_url.startsWith("/generated/search-bigram-statewide/documents/"),
        `${cityMeta.slug}: document asset URL is outside the search asset tree`
      );
      expected.set(`document:${range.documents_url}`, {
        kind: "document",
        url: range.documents_url,
      });
    }
    for (const range of cityMeta.exact_text_ranges) {
      invariant(
        range.exact_text_url.startsWith("/generated/search-bigram-statewide/exact-text/"),
        `${cityMeta.slug}: exact text URL is outside the search asset tree`
      );
      const key = `exact:${range.exact_text_url}:${range.byte_start}:${range.byte_length}`;
      invariant(!expected.has(key), `${cityMeta.slug}: duplicate exact text catalog key ${key}`);
      expected.set(key, { kind: "exact", range });
      if (!exactRangesByUrl.has(range.exact_text_url)) {
        exactRangesByUrl.set(range.exact_text_url, []);
      }
      exactRangesByUrl.get(range.exact_text_url).push(range);
    }
  }

  const catalogKeys = Object.keys(searchAssetCatalog.assets);
  invariant(
    catalogKeys.length === expected.size
    && catalogKeys.every((key) => expected.has(key)),
    `search asset catalog expected ${expected.size} entries, found ${catalogKeys.length}`
  );
  for (const [key, descriptor] of expected) {
    if (descriptor.kind === "exact") continue;
    const verified = verifyWholeGzipCatalogAsset(key, descriptor.url);
    if (descriptor.kind === "posting") {
      const payload = JSON.parse(verified.raw.toString("utf8"));
      invariant(
        payload && typeof payload === "object" && !Array.isArray(payload),
        `${descriptor.url}: posting payload is invalid`
      );
      const file = descriptor.url.split("/").at(-1);
      for (const cities of Object.values(payload)) {
        invariant(
          cities && typeof cities === "object" && !Array.isArray(cities),
          `${descriptor.url}: posting city payload is invalid`
        );
        for (const city of Object.keys(cities)) {
          invariant(
            expectedBucketsByCity.has(city),
            `${descriptor.url}: posting payload contains an unknown city (${city})`
          );
          expectedBucketsByCity.get(city).add(file);
        }
      }
    }
  }
  for (const [url, ranges] of exactRangesByUrl) {
    const filePath = generatedPathForUrl(url);
    const assetBytes = fs.statSync(filePath).size;
    invariant(ranges.length === 1, `${url}: exact text asset must contain one gzip member`);
    let expectedByteStart = 0;
    for (const range of ranges.sort((left, right) => left.byte_start - right.byte_start)) {
      invariant(
        range.byte_start === expectedByteStart,
        `${url}: exact text catalog blocks are not contiguous at ${expectedByteStart}`
      );
      const key = `exact:${url}:${range.byte_start}:${range.byte_length}`;
      invariant(
        catalogAsset(key).asset_bytes === assetBytes,
        `${url}: exact text catalog asset total mismatch`
      );
      loadVerifiedExactTextBlock(range);
      expectedByteStart += range.byte_length;
    }
    invariant(expectedByteStart === assetBytes, `${url}: exact text catalog does not cover the asset`);
  }
  const expectedStatewideAssetUrls = [
    "/generated/search-bigram-statewide/manifest.json",
    manifest.asset_catalog.url,
    ...manifest.cities.map((cityMeta) => cityMeta.coverage_url),
    ...Array.from(expected.values(), (descriptor) =>
      descriptor.kind === "exact" ? descriptor.range.exact_text_url : descriptor.url
    ),
  ];
  assertExactSearchAssetUrlSet(
    expectedStatewideAssetUrls,
    generatedAssetUrlsUnder(STATEWIDE_BIGRAM_DIR),
    "statewide search asset tree"
  );
  assertExactSearchAssetUrlSet(
    manifest.cities.map(
      (cityMeta) => `/generated/search-bigram-cities/${cityMeta.slug}/manifest.json`
    ),
    generatedAssetUrlsUnder(CITY_BIGRAM_DIR),
    "city search manifest tree"
  );
  console.log(
    `PASS search asset catalog: ${expected.size.toLocaleString()} entries `
    + `(${manifest.buckets.length} postings, ${exactRangesByUrl.size} exact-text assets)`
  );
  return expectedBucketsByCity;
}

function cityDocument(cityMeta, documentId) {
  const range = payloadRangeFor(cityMeta, cityMeta.document_ranges, documentId);
  return readDocumentRange(range)[range.payload_start + documentId - range.start];
}

function cityExactText(cityMeta, documentId) {
  const range = payloadRangeFor(cityMeta, cityMeta.exact_text_ranges, documentId);
  return readExactTextBlock(range)[documentId - range.start];
}

function cityExactSearchText(cityMeta, documentId) {
  const evidenceText = cityExactText(cityMeta, documentId);
  const document = cityDocument(cityMeta, documentId);
  if (document?.source === "member_activity") {
    return [
      document.cityName,
      document.member_name,
      document.title,
      document.committee,
      document.label,
      document.metaText,
      evidenceText,
    ].filter(Boolean).join(" ");
  }
  return [
    document?.cityName,
    document?.title,
    document?.committee,
    document?.label,
    document?.speaker,
    document?.body,
    document?.context,
    document?.metaText,
    document?.member_name,
    evidenceText,
  ].filter(Boolean).join(" ");
}

function exactQueryMatches(text, query) {
  const tokens = query.trim().split(/\s+/).map(compact).filter(Boolean);
  const normalizedText = compact(text);
  return tokens.length > 0 && tokens.every((token) => normalizedText.includes(token));
}

function verifyStatewideQuery({ query, city, source, councilId, expectedMeetingCount }) {
  const cityMeta = statewideManifest.cities.find((entry) => entry.slug === city);
  invariant(cityMeta, `statewide city metadata missing: ${city}`);
  const candidateIds = candidateIdsForCity(query, city);
  const exactHits = candidateIds
    .filter((documentId) => exactQueryMatches(cityExactSearchText(cityMeta, documentId), query))
    .map((documentId) => cityDocument(cityMeta, documentId));
  const expectedHits = exactHits.filter((document) =>
    document?.source === source
    && (councilId === undefined || Number(document.council_id) === councilId)
  );
  invariant(expectedHits.length > 0, `statewide exact query did not find expected record: ${query} (${city})`);

  const meetings = new Map();
  for (const document of exactHits) {
    const key = document?.sourceType === "minutes" && Number.isFinite(Number(document?.council_id))
      ? `${document.city}:minutes:${Number(document.council_id)}`
      : `${document?.city}:${document?.source}:${document?.id}`;
    if (!meetings.has(key)) meetings.set(key, document);
  }
  if (expectedMeetingCount !== undefined) {
    invariant(
      meetings.size === expectedMeetingCount,
      `${query}: expected ${expectedMeetingCount} exact meeting(s), got ${meetings.size}`
    );
  }
  const rejectedFalsePositives = candidateIds.length - exactHits.length;
  console.log(
    `PASS statewide exact query: ${query} -> ${city}/${expectedHits[0].title} `
    + `(${meetings.size} meeting, ${rejectedFalsePositives} posting false positives rejected)`
  );
}

function verifyGeneratedSummaryIsNotSearchSource(records) {
  const phrases = Array.from(new Set(
    records.flatMap((record) => [
      record?.summary,
      ...(record?.highlights ?? []),
      ...(record?.tags ?? []),
    ]).map(compact).filter((value) => value.length >= 12)
      .map((value) => value.slice(0, 32))
  )).sort((left, right) => right.length - left.length || left.localeCompare(right, "ja"));
  invariant(phrases.length > 0, "generated summary no-hit fixture is missing");
  for (const phrase of phrases.slice(0, 64)) {
    let exactHits = 0;
    for (const [city, resolution] of candidateIdsByCity(phrase)) {
      const cityMeta = statewideManifest.cities.find((entry) => entry.slug === city);
      invariant(cityMeta, `${city}: statewide city metadata missing`);
      exactHits += resolution.candidateIds.filter((documentId) =>
        exactQueryMatches(cityExactSearchText(cityMeta, documentId), phrase)
      ).length;
    }
    if (exactHits === 0) {
      console.log(`PASS generated-summary isolation query: ${phrase} -> 0 exact hits`);
      return;
    }
  }
  throw new Error("could not establish an AI-only generated summary no-hit fixture");
}

function queryTransferStats(query, variants = [query]) {
  const candidates = new Map();
  const exactCandidates = new Map();
  for (const variant of variants) {
    for (const [city, resolution] of candidateIdsByCity(variant)) {
      candidates.set(
        city,
        Array.from(new Set([...(candidates.get(city) ?? []), ...resolution.candidateIds]))
      );
      const verificationSet = new Set(resolution.verificationIds);
      exactCandidates.set(
        city,
        Array.from(new Set([
          ...(exactCandidates.get(city) ?? []),
          ...resolution.candidateIds.filter((id) => !verificationSet.has(id)),
        ]))
      );
    }
  }
  const postingUrls = new Set(
    variants
      .flatMap((variant) => variant.trim().split(/\s+/).filter(Boolean))
      .flatMap((token) => indexedToken(token).terms)
      .map((term) => `/generated/search-bigram-statewide/postings/${bucketFile(term)}`)
      .filter((url) => statewideManifest.buckets.includes(url.split("/").at(-1)))
  );
  const documentUrls = new Set();
  const exactTextBlocks = new Map();
  const snippetBlockCandidates = new Map();
  let candidateDocuments = 0;
  let exactDocuments = 0;
  for (const [city, ids] of candidates) {
    const cityMeta = statewideManifest.cities.find((entry) => entry.slug === city);
    invariant(cityMeta, `${city}: statewide city metadata missing`);
    candidateDocuments += ids.length;
    const provenExact = new Set(exactCandidates.get(city) ?? []);
    const verificationIds = ids.filter((id) => !provenExact.has(id));
    for (const id of verificationIds) {
      const range = payloadRangeFor(cityMeta, cityMeta.exact_text_ranges, id);
      exactTextBlocks.set(
        `exact:${range.exact_text_url}:${range.byte_start}:${range.byte_length}`,
        range
      );
      documentUrls.add(
        payloadRangeFor(cityMeta, cityMeta.document_ranges, id).documents_url
      );
    }
    const exactIds = ids.filter((id) =>
      variants.some((variant) =>
        exactQueryMatches(cityExactSearchText(cityMeta, id), variant)
      )
    );
    invariant(
      Array.from(provenExact).every((id) => exactIds.includes(id)),
      `${query}: exact posting produced a false positive in ${city}`
    );
    exactDocuments += exactIds.length;
    for (const id of exactIds) {
      const document = cityDocument(cityMeta, id);
      documentUrls.add(
        payloadRangeFor(cityMeta, cityMeta.document_ranges, id).documents_url
      );
      if (document?.sourceType === "minutes" && document?.fullTextIndexed === true) {
        const range = payloadRangeFor(cityMeta, cityMeta.exact_text_ranges, id);
        const key = `exact:${range.exact_text_url}:${range.byte_start}:${range.byte_length}`;
        if (!exactTextBlocks.has(key)) snippetBlockCandidates.set(key, range);
      }
    }
  }
  const snippetTextBlocks = Array.from(snippetBlockCandidates.entries())
    .sort((left, right) => right[1].raw_bytes - left[1].raw_bytes)
    .slice(0, MAX_EXACT_TEXT_SNIPPET_BLOCKS_PER_SEARCH);
  for (const [key, range] of snippetTextBlocks) exactTextBlocks.set(key, range);
  const assetKeys = new Set([
    ...Array.from(postingUrls, (url) => `posting:${url}`),
    ...Array.from(documentUrls, (url) => `document:${url}`),
    ...exactTextBlocks.keys(),
  ]);
  const manifestBytes = fs.statSync(path.join(STATEWIDE_BIGRAM_DIR, "manifest.json")).size;
  let rawBytes = manifestBytes + statewideManifest.asset_catalog.raw_bytes;
  let gzipBytes = manifestBytes + statewideManifest.asset_catalog.bytes;
  for (const key of assetKeys) {
    const asset = catalogAsset(key);
    gzipBytes += asset.bytes;
    rawBytes += asset.raw_bytes;
  }
  return {
    query,
    candidateCities: candidates.size,
    candidateDocuments,
    exactDocuments,
    requests: assetKeys.size + 2,
    rawBytes,
    gzipBytes,
    postingRequests: postingUrls.size,
    documentRequests: documentUrls.size,
    exactTextRequests: exactTextBlocks.size,
    snippetRequests: snippetTextBlocks.length,
    catalogRequests: 1,
    manifestRequests: 1,
  };
}

function verifyTypicalQueryTransfer(query, variants = expandedClientQueryVariants(query)) {
  const stats = queryTransferStats(query, variants);
  invariant(
    stats.requests <= MAX_SEARCH_ASSET_REQUESTS_PER_QUERY,
    `${query}: too many search asset requests (${stats.requests})`
  );
  invariant(
    stats.rawBytes <= MAX_TYPICAL_QUERY_RAW_BYTES,
    `${query}: raw search assets too large (${stats.rawBytes} bytes)`
  );
  invariant(
    stats.gzipBytes <= MAX_TYPICAL_QUERY_GZIP_BYTES,
    `${query}: gzip search assets too large (${stats.gzipBytes} bytes)`
  );
  console.log(
    `PASS query transfer: ${query} -> ${stats.candidateCities} cities, `
    + `${variants.length} client variants, ${stats.candidateDocuments} candidates / ${stats.exactDocuments} exact docs, ${stats.requests} requests `
    + `(manifest ${stats.manifestRequests}, catalog ${stats.catalogRequests}, postings ${stats.postingRequests}, `
    + `documents ${stats.documentRequests}, `
    + `exact-text ${stats.exactTextRequests}, snippets ${stats.snippetRequests}), `
    + `${(stats.rawBytes / 1024 / 1024).toFixed(2)} MiB raw / `
    + `${(stats.gzipBytes / 1024 / 1024).toFixed(2)} MiB gzip`
  );
}

verifyScheduleAwareEvidenceFixture();

const memberActivityManifest = readJson(path.join(MEMBER_ACTIVITY_DIR, "manifest.json"));
invariant(
  memberActivityManifest.count === activeMunicipalities.length,
  "member activity shard municipality count mismatch"
);
for (const cityEntry of memberActivityManifest.cities) {
  const cityManifest = readJson(path.join(MEMBER_ACTIVITY_DIR, cityEntry.city, "manifest.json"));
  const minutesRestricted = restrictedMinutesCities.has(cityEntry.city);
  invariant(
    cityEntry.minutes_access === (minutesRestricted ? "restricted" : "public")
    && (!minutesRestricted || cityEntry.activity_count === 0)
    && cityManifest.minutes_access === (minutesRestricted ? "restricted" : "public"),
    `${cityEntry.city}: member activity access flag mismatch`
  );
  for (const member of cityManifest.members) {
    const payload = readJson(
      path.join(MEMBER_ACTIVITY_DIR, cityEntry.city, `${member.seat_number}.json`)
    );
    invariant(
      payload.activity === null || payload.activity?.classification_status === "classified",
      `${cityEntry.city}/${member.seat_number}: unclassified activity leaked into direct shard`
    );
    invariant(
      !minutesRestricted || payload.activity === null,
      `${cityEntry.city}/${member.seat_number}: restricted activity leaked into direct shard`
    );
  }
}

const canonicalIndex = readJson(path.join(SITE_DIR, "data", "_search-index.json"));
invariant(
  JSON.stringify(canonicalIndex.restricted_minutes_cities) === JSON.stringify(
    Array.from(restrictedMinutesCities).sort()
  ),
  "canonical restricted municipality ledger mismatch"
);
invariant(
  canonicalIndex.agendas.every((agenda) => !restrictedMinutesCities.has(agenda.city)),
  "restricted agenda leaked into canonical search index"
);
const compatibilityRootFields = new Set([
  "version",
  "generated_at",
  "excerpt_max",
  "scope",
  "count",
  "restricted_minutes_cities",
  "municipalities",
  "agendas",
]);
const compatibilityAgendaFields = new Set([
  "city",
  "cityName",
  "council_id",
  "council_name",
  "year",
  "date",
  "schedule_id",
  "schedule_index",
  "schedule_name",
  "agenda_title",
  "first_minute_id",
  "text",
  "truncated",
  "agenda_index",
]);

function verifyCompatibilityIndex(index, { scope, city = "" }) {
  invariant(index.scope === scope, `${city || "global"}: compatibility scope mismatch`);
  invariant(
    Object.keys(index).every((field) => compatibilityRootFields.has(field)),
    `${city || "global"}: non-agenda data leaked into compatibility index`
  );
  invariant(Array.isArray(index.agendas), `${city || "global"}: compatibility agendas missing`);
  invariant(index.count === index.agendas.length, `${city || "global"}: compatibility count mismatch`);
  invariant(
    JSON.stringify(index.restricted_minutes_cities) === JSON.stringify(
      Array.from(restrictedMinutesCities).sort()
    ),
    `${city || "global"}: compatibility restricted municipality ledger mismatch`
  );
  for (const agenda of index.agendas) {
    invariant(
      !restrictedMinutesCities.has(agenda.city),
      `${city || "global"}: restricted agenda leaked into compatibility index`
    );
    invariant(!city || agenda.city === city, `${city}: foreign agenda leaked into city compatibility index`);
    invariant(
      Object.keys(agenda).every((field) => compatibilityAgendaFields.has(field)),
      `${agenda.city}/${agenda.council_id}: unexpected compatibility agenda field`
    );
    invariant(
      Object.hasOwn(agenda, "first_minute_id")
      && Object.hasOwn(agenda, "truncated")
      && typeof agenda.text === "string",
      `${agenda.city}/${agenda.council_id}: Research/Minutes agenda contract is incomplete`
    );
  }
}

invariant(
  !fs.existsSync(path.join(GENERATED_DIR, "search-index-recent.json"))
  && !fs.existsSync(path.join(GENERATED_DIR, "search-index-shards"))
  && !fs.existsSync(path.join(STATEWIDE_BIGRAM_DIR, "_postings-build"))
  && fs.readdirSync(GENERATED_DIR).every(
    (entry) => !(entry.startsWith("search-build-state.json.") && entry.endsWith(".tmp"))
  ),
  "removed recent/runtime shard compatibility assets were republished"
);
const compatibilityIndex = readJson(COMPATIBILITY_INDEX_FILE);
verifyCompatibilityIndex(compatibilityIndex, { scope: "full" });
invariant(
  JSON.stringify(compatibilityIndex.agendas) === JSON.stringify(canonicalIndex.agendas),
  "global agenda compatibility index is not full-period canonical data"
);
invariant(
  compatibilityIndex.municipalities.length === activeMunicipalities.length,
  "global agenda compatibility municipality count mismatch"
);
for (const municipality of activeMunicipalities) {
  const cityIndex = readJson(
    path.join(CITY_COMPATIBILITY_INDEX_DIR, `${municipality.slug}.json`)
  );
  verifyCompatibilityIndex(cityIndex, { scope: "city", city: municipality.slug });
  invariant(
    cityIndex.municipalities.length === 1
    && cityIndex.municipalities[0].slug === municipality.slug,
    `${municipality.slug}: city compatibility municipality mismatch`
  );
  invariant(
    JSON.stringify(cityIndex.agendas)
      === JSON.stringify(canonicalIndex.agendas.filter((agenda) => agenda.city === municipality.slug)),
    `${municipality.slug}: city compatibility index is not full-period canonical data`
  );
}
assertExactSearchAssetUrlSet(
  activeMunicipalities.map(
    (municipality) => `/generated/search-indexes/${municipality.slug}.json`
  ),
  generatedAssetUrlsUnder(CITY_COMPATIBILITY_INDEX_DIR),
  "city compatibility search index tree"
);
const topicsIndex = readJson(path.join(GENERATED_DIR, "topics-index.json"));
invariant(
  (topicsIndex.records ?? []).every((entry) => !restrictedMinutesCities.has(entry.city)),
  "restricted enriched record leaked into topics index"
);
const canonicalAgendaResultIds = canonicalIndex.agendas.map(runtimeAgendaResultId);
invariant(
  new Set(canonicalAgendaResultIds).size === canonicalAgendaResultIds.length,
  "canonical runtime agenda result IDs are not unique"
);
invariant(
  compatibilityIndex.count === canonicalIndex.count,
  "global compatibility agenda count mismatch"
);

const statewideManifest = readJson(path.join(STATEWIDE_BIGRAM_DIR, "manifest.json"));
invariant(
  fs.statSync(path.join(STATEWIDE_BIGRAM_DIR, "manifest.json")).size
    <= MAX_STATEWIDE_SEARCH_MANIFEST_BYTES,
  "statewide search manifest exceeds browser transfer budget"
);
invariant(statewideManifest.scope === "statewide-bigram", "statewide bigram manifest scope mismatch");
invariant(statewideManifest.version === 5, "statewide ngram manifest version mismatch");
searchAssetCatalog = readAndValidateSearchAssetCatalog(
  statewideManifest.asset_catalog,
  statewideManifest.generated_at
);
invariant(
  JSON.stringify(statewideManifest.restricted_minutes_cities) === JSON.stringify(
    Array.from(restrictedMinutesCities).sort()
  ),
  "statewide restricted municipality ledger mismatch"
);
invariant(
  !fs.existsSync(path.join(STATEWIDE_BIGRAM_DIR, "verification")),
  "legacy public verification assets must not be published"
);
invariant(statewideManifest.bucket_count === SEARCH_POSTING_BUCKET_COUNT, "statewide ngram bucket count mismatch");
assertCanonicalSearchPostingBuckets(
  statewideManifest.buckets,
  SEARCH_POSTING_BUCKET_COUNT,
  bucketFileForBucket
);
invariant(
  Array.isArray(statewideManifest.ngram_widths)
  && statewideManifest.ngram_widths.includes(2)
  && statewideManifest.ngram_widths.includes(3),
  "statewide 2/3-gram widths are missing"
);
invariant(statewideManifest.positional_trigrams === false, "statewide postings must be document-level");
invariant(statewideManifest.postings_encoding === "gzip", "statewide postings must use gzip");
invariant(
  statewideManifest.posting_value_encoding === "delta-varint-v1",
  "statewide document posting encoding is unsupported"
);
const synonymVocabulary = synonymExactPostingVocabulary();
const configuredSynonymPostings = new Set(
  SEARCH_EXACT_POSTING_TERMS.map(compact).filter((term) => term.length > 2)
);
invariant(
  synonymVocabulary.size === configuredSynonymPostings.size
  && Array.from(synonymVocabulary).every((term) => configuredSynonymPostings.has(term)),
  "search synonym vocabulary and exact posting vocabulary differ"
);
for (const term of SEARCH_EXACT_POSTING_TERMS) {
  const normalized = compact(term);
  if (normalized.length > 2) {
    invariant(
      statewideManifest.exact_terms.includes(normalized),
      `synonym exact posting term is missing: ${term}`
    );
  }
}
assertStatewideSearchCityCoverage(
  statewideManifest,
  activeMunicipalities.map((municipality) => municipality.slug)
);
const expectedPostingBucketsByCity = verifySearchAssetCatalog(statewideManifest);

const scheduleCoverageByCity = new Map();
for (const cityMeta of statewideManifest.cities) {
  validatePayloadRanges(cityMeta, cityMeta.document_ranges, "documents_url");
  validateExactTextRanges(cityMeta, cityMeta.exact_text_ranges);
  const cityManifest = readJson(path.join(CITY_BIGRAM_DIR, cityMeta.slug, "manifest.json"));
  invariant(
    fs.statSync(path.join(CITY_BIGRAM_DIR, cityMeta.slug, "manifest.json")).size
      <= MAX_CITY_SEARCH_MANIFEST_BYTES,
    `${cityMeta.slug}: city search manifest exceeds browser transfer budget`
  );
  const minutesRestricted = restrictedMinutesCities.has(cityMeta.slug);
  assertCitySearchManifestContract(
    cityMeta,
    cityManifest,
    statewideManifest,
    searchAssetCatalog.assets,
    expectedPostingBucketsByCity.get(cityMeta.slug)
  );
  invariant(cityManifest.version === 5, `${cityMeta.slug}: city ngram manifest version mismatch`);
  invariant(
    cityManifest.generated_at === statewideManifest.generated_at
    && JSON.stringify(cityManifest.asset_catalog) === JSON.stringify(statewideManifest.asset_catalog),
    `${cityMeta.slug}: city/statewide asset catalog reference differs`
  );
  invariant(
    cityManifest.minutes_access === (minutesRestricted ? "restricted" : "public")
    && cityMeta.minutes_access === cityManifest.minutes_access,
    `${cityMeta.slug}: city/statewide minutes access flag mismatch`
  );
  invariant(cityManifest.document_count === cityMeta.document_count, `${cityMeta.slug}: city/statewide document count mismatch`);
  invariant(
    Array.isArray(cityManifest.ngram_widths)
    && cityManifest.ngram_widths.includes(2)
    && cityManifest.ngram_widths.includes(3),
    `${cityMeta.slug}: city 2/3-gram widths are missing`
  );
  invariant(cityManifest.positional_trigrams === false, `${cityMeta.slug}: postings must be document-level`);
  validateExactTextRanges(cityMeta, cityManifest.exact_text_ranges);
  invariant(
    cityManifest.posting_value_encoding === statewideManifest.posting_value_encoding,
    `${cityMeta.slug}: document posting encoding mismatch`
  );
  invariant(!fs.existsSync(path.join(CITY_BIGRAM_DIR, cityMeta.slug, "postings")), `${cityMeta.slug}: duplicate city postings were published`);

  const published = publishedCouncilIds(cityMeta.slug);
  const coveredCouncils = new Set();
  const cityDocuments = [];
  const cityDocumentIds = new Set();
  for (let documentId = 0; documentId < cityMeta.document_count; documentId += 1) {
    const document = cityDocument(cityMeta, documentId);
    cityDocuments.push(document);
    invariant(document?.city === cityMeta.slug, `${cityMeta.slug}: document city mismatch at ${documentId}`);
    if (minutesRestricted) {
      invariant(
        document?.source === "member" || document?.source === "decision",
        `${cityMeta.slug}: restricted full-text source leaked (${document?.source}/${document?.id})`
      );
      invariant(
        document?.fullTextIndexed !== true,
        `${cityMeta.slug}: restricted full-text flag leaked (${document?.id})`
      );
    }
    if (document?.source === "member_activity") {
      for (const forbiddenField of ["summary_topics", "overview", "generated_topics"]) {
        invariant(
          !Object.hasOwn(document, forbiddenField),
          `${cityMeta.slug}: ${forbiddenField} leaked into member activity search document`
        );
      }
      const exactEvidence = compact(cityExactText(cityMeta, documentId));
      invariant(
        document.exact_evidence_sha256 === sha256(exactEvidence)
        && document.exact_evidence_compact_chars === exactEvidence.length,
        `${cityMeta.slug}: member activity exact-text block is not evidence-only (${document.id})`
      );
      for (const topic of [
        ...(document.canonical_topics ?? []),
        ...(document.topics ?? []),
      ]) {
        const compactTopic = compact(topic);
        invariant(
          compactTopic.length > 0 && exactEvidence.includes(compactTopic),
          `${cityMeta.slug}: non-evidence activity topic leaked (${document.id}/${topic})`
        );
      }
    }
    invariant(
      document?.source !== "enriched" && document?.field !== "AI要約" && document?.field !== "要約",
      `${cityMeta.slug}: generated summary leaked into exact search document (${document?.id})`
    );
    invariant(
      typeof document?.id === "string" && !cityDocumentIds.has(document.id),
      `${cityMeta.slug}: duplicate or missing search document id at ${documentId} (${document?.id})`
    );
    cityDocumentIds.add(document.id);
    if (document?.sourceType === "minutes" && Number.isFinite(Number(document.council_id))) {
      coveredCouncils.add(Number(document.council_id));
      invariant(
        published.has(Number(document.council_id)),
        `${cityMeta.slug}: unpublished council leaked into search documents (${document.source}/${document.council_id})`
      );
    }
  }
  scheduleCoverageByCity.set(
    cityMeta.slug,
    verifyScheduleCoverage(cityMeta, cityManifest, cityDocuments)
  );
  for (const councilId of published) {
    invariant(
      coveredCouncils.has(councilId),
      `${cityMeta.slug}: published council has no exact-search document (${councilId})`
    );
  }
}

verifyGeneratedSummaryIsNotSearchSource(topicsIndex.records ?? []);

function scheduleFixture(city, councilId, scheduleId) {
  const coverage = scheduleCoverageByCity.get(city);
  const row = coverage?.schedules?.find(
    (candidate) =>
      Number(candidate.council_id) === councilId
      && Number(candidate.schedule_id) === scheduleId
  );
  invariant(row, `${city}/${councilId}/${scheduleId}: schedule coverage fixture missing`);
  return row;
}

const assabuPartialSchedule = scheduleFixture("assabu", 20251001, 2);
invariant(
  assabuPartialSchedule.status === "covered_exact"
  && assabuPartialSchedule.source === "raw-minutes"
  && assabuPartialSchedule.raw_compact_chars > 0
  && assabuPartialSchedule.indexed_compact_chars === assabuPartialSchedule.raw_compact_chars
  && assabuPartialSchedule.indexed_payload_sha256 === assabuPartialSchedule.raw_sha256,
  "assabu/20251001/2: readable raw schedule was not fully indexed"
);
const bibaiContentsSchedule = scheduleFixture("bibai", 20251001, 1);
invariant(
  bibaiContentsSchedule.status === "ignored"
  && bibaiContentsSchedule.reason === "toc-explicit",
  "bibai/20251001/1: explicit table of contents classifier mismatch"
);
const abashiriCidSchedule = scheduleFixture("abashiri", 20241004, 1);
invariant(
  abashiriCidSchedule.status === "ignored"
  && abashiriCidSchedule.reason === "unreadable-cid",
  "abashiri/20241004/1: unreadable CID classifier mismatch"
);
for (const scheduleId of [1, 2]) {
  const koshimizuImagePdfSchedule = scheduleFixture("koshimizu", 20241005, scheduleId);
  invariant(
    koshimizuImagePdfSchedule.status === "ignored"
    && koshimizuImagePdfSchedule.reason === "image-pdf-needs-ocr-review"
    && koshimizuImagePdfSchedule.raw_compact_chars === 0,
    `koshimizu/20241005/${scheduleId}: image PDF review ledger mismatch`
  );
}
const totalScheduleCoverage = Array.from(scheduleCoverageByCity.values()).reduce(
  (total, coverage) => ({
    schedules: total.schedules + coverage.total_schedules,
    covered: total.covered + coverage.covered_schedules,
    ignored: total.ignored + coverage.ignored_schedules.length,
    raw: total.raw + (coverage.covered_by?.["raw-minutes"] ?? 0),
    segments: total.segments + (coverage.covered_by?.segments ?? 0),
    restrictedCouncils: total.restrictedCouncils
      + (coverage.excluded_publication_councils ?? 0),
    imagePdfReview: total.imagePdfReview + coverage.ignored_schedules.filter(
      (row) => row.reason === "image-pdf-needs-ocr-review"
    ).length,
  }),
  {
    schedules: 0,
    covered: 0,
    ignored: 0,
    raw: 0,
    segments: 0,
    restrictedCouncils: 0,
    imagePdfReview: 0,
  }
);
console.log(
  `PASS publication schedule coverage: ${totalScheduleCoverage.covered}/${totalScheduleCoverage.schedules} covered `
  + `(raw ${totalScheduleCoverage.raw}, segments ${totalScheduleCoverage.segments}), `
  + `${totalScheduleCoverage.ignored} explicitly ignored `
  + `(image PDF review ${totalScheduleCoverage.imagePdfReview}), `
  + `${restrictedMinutesCities.size} restricted municipalities / `
  + `${totalScheduleCoverage.restrictedCouncils} councils excluded`
);

const generatedAssets = walkFiles(GENERATED_DIR)
  .map((filePath) => ({ filePath, bytes: fs.statSync(filePath).size }));
const oversizedAssets = generatedAssets
  .filter((entry) => entry.bytes > MAX_STATIC_ASSET_BYTES);
invariant(
  oversizedAssets.length === 0,
  `static asset size limit exceeded: ${oversizedAssets.map((entry) => `${entry.filePath} (${entry.bytes})`).join(", ")}`
);
const generatedAssetBytes = generatedAssets.reduce((sum, asset) => sum + asset.bytes, 0);
invariant(
  generatedAssets.length <= MAX_GENERATED_ASSET_FILES,
  `generated asset count limit exceeded: ${generatedAssets.length}`
);
invariant(
  generatedAssetBytes <= MAX_GENERATED_ASSET_BYTES,
  `generated asset byte limit exceeded: ${generatedAssetBytes}`
);
let maxDecodedGzipAsset = { filePath: "", bytes: 0, gzipBytes: 0 };
for (const asset of generatedAssets.filter((entry) => entry.filePath.endsWith(".json.gz"))) {
  const decodedBytes = zlib.gunzipSync(fs.readFileSync(asset.filePath)).length;
  invariant(
    decodedBytes <= MAX_DECODED_GZIP_ASSET_BYTES,
    `decoded gzip search asset exceeds ${MAX_DECODED_GZIP_ASSET_BYTES} bytes: ${asset.filePath} (${decodedBytes})`
  );
  if (decodedBytes > maxDecodedGzipAsset.bytes) {
    maxDecodedGzipAsset = {
      filePath: asset.filePath,
      bytes: decodedBytes,
      gzipBytes: asset.bytes,
    };
  }
}

verifyStatewideQuery({
  query: "三上まどか ラピダス",
  city: "eniwa",
  source: "agenda",
  councilId: 237,
});
verifyStatewideQuery({
  query: "苫小牧 スケートまつり",
  city: "tomakomai",
  source: "agenda",
  councilId: 262,
});
verifyStatewideQuery({
  query: "情報通信技術",
  city: "setana",
  source: "agenda",
  councilId: 20261001,
});
verifyStatewideQuery({
  query: "千歳市民の入院を受け入れた",
  city: "chitose",
  source: "agenda",
  councilId: 490,
  expectedMeetingCount: 1,
});
verifyStatewideQuery({
  query: "旭台第3支線道路整備その1工事",
  city: "kuriyama",
  source: "agenda",
  councilId: 2025100611,
  expectedMeetingCount: 1,
});
verifyStatewideQuery({
  query: "避難所の生活環境の改善を図るため",
  city: "furubira",
  source: "agenda",
  councilId: 20251002,
  expectedMeetingCount: 1,
});
verifyStatewideQuery({
  query: "町道の除雪について質問させていただきます",
  city: "horokanai",
  source: "agenda",
  councilId: 20261002,
  expectedMeetingCount: 1,
});

verifyTypicalQueryTransfer("福祉");
verifyTypicalQueryTransfer("一般質問");
verifyTypicalQueryTransfer("千歳市民の入院を受け入れた");
verifyTypicalQueryTransfer("子供");
verifyTypicalQueryTransfer("中学校");
verifyTypicalQueryTransfer("町内会");
verifyTypicalQueryTransfer("図書館");
verifyTypicalQueryTransfer("道路整備");
verifyTypicalQueryTransfer("地域活性化");
verifyTypicalQueryTransfer("議会");
verifyTypicalQueryTransfer("町長");
verifyTypicalQueryTransfer("予算");

const maxAsset = generatedAssets
  .sort((left, right) => right.bytes - left.bytes)[0];
console.log(
  `search shard verification passed: agenda-only compatibility + `
  + `${statewideManifest.cities.length} municipalities, ${generatedAssets.length.toLocaleString()} assets, `
  + `${(generatedAssetBytes / 1024 / 1024).toFixed(2)} MiB total, `
  + `max asset ${(maxAsset.bytes / 1024 / 1024).toFixed(2)} MiB, `
  + `max decoded gzip ${(maxDecodedGzipAsset.bytes / 1024 / 1024).toFixed(2)} MiB `
  + `(gzip ${(maxDecodedGzipAsset.gzipBytes / 1024 / 1024).toFixed(2)} MiB)`
);
