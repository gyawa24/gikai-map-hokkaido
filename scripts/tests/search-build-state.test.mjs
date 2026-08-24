import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";

import {
  addSearchAssetCatalogEntry,
  agendaOnlyRuntimeIndex,
  createExactTextBlockWriter,
  fingerprintSearchInputMetadata,
  encodeDocumentIds,
  invalidateSearchBuildState,
  memberSearchDocumentIds,
  POSTING_SPOOL_OPEN_HANDLE_LIMIT,
  positiveSeatNumber,
  scheduleCoverageManifestReference,
  searchIndexInputFiles,
  searchIndexBuildStateIsFresh,
  writeSearchBuildStateAtomically,
} from "../../site/scripts/build-search-index.mjs";

const inputFingerprint = "source-v1";
const buildState = {
  version: 2,
  generated_at: "2026-08-23T00:00:00.000Z",
  input_fingerprint: inputFingerprint,
  required_assets: ["public/generated/search-bigram-statewide/manifest.json"],
};
const statewideManifest = {
  version: 5,
  generated_at: buildState.generated_at,
};

test("入力fingerprintと必須assetが一致すればpredev buildをskipできる", () => {
  assert.equal(searchIndexBuildStateIsFresh({
    inputFingerprint,
    buildState,
    statewideManifest,
    assetExists: () => true,
  }), true);
});

test("source更新でfingerprintが変われば再buildする", () => {
  assert.equal(searchIndexBuildStateIsFresh({
    inputFingerprint: "source-v2",
    buildState,
    statewideManifest,
    assetExists: () => true,
  }), false);
});

test("旧exact asset形式のbuild stateは入力不変でも再buildする", () => {
  assert.equal(searchIndexBuildStateIsFresh({
    inputFingerprint,
    buildState: { ...buildState, version: 1 },
    statewideManifest,
    assetExists: () => true,
  }), false);
});

test("必須assetが1つでも欠ければ再buildする", () => {
  assert.equal(searchIndexBuildStateIsFresh({
    inputFingerprint,
    buildState,
    statewideManifest,
    assetExists: () => false,
  }), false);
});

test("詳細schedule coverageは検索manifestへ重複せず別asset参照だけを載せる", () => {
  const reference = scheduleCoverageManifestReference(
    {
      published_councils: 12,
      total_schedules: 34,
      covered_schedules: 32,
      ignored_schedules: [{ reason: "toc-explicit" }, { reason: "unreadable-cid" }],
      schedules: [{ raw_sha256: "large-audit-ledger" }],
    },
    {
      url: "/generated/search-bigram-statewide/coverage/example.json.gz",
      compressedBytes: 321,
      rawBytes: 1234,
      sha256: "coverage-hash",
    }
  );
  assert.equal(Object.hasOwn(reference, "schedule_coverage"), false);
  assert.equal(JSON.stringify(reference).includes("large-audit-ledger"), false);
  assert.deepEqual(reference.coverage_counts, {
    published_councils: 12,
    total_schedules: 34,
    covered_schedules: 32,
    ignored_schedules: 2,
  });
});

test("検索asset catalogは同一keyの上書きをfail-closedにする", () => {
  const catalog = {};
  addSearchAssetCatalogEntry(catalog, "posting:/generated/example.json.gz", { bytes: 1 });
  assert.throws(
    () => addSearchAssetCatalogEntry(
      catalog,
      "posting:/generated/example.json.gz",
      { bytes: 2 }
    ),
    /duplicate search asset catalog key/u
  );
  assert.equal(catalog["posting:/generated/example.json.gz"].bytes, 1);
});

test("exact全文blockは1 gzip memberずつ独立assetへ保存する", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "search-exact-assets-"));
  const catalog = {};
  try {
    const writer = createExactTextBlockWriter(catalog, {
      directory: tempDir,
      urlPrefix: "/generated/search-test/exact-text",
    });
    const ranges = writer.addCity(
      Array.from({ length: 130 }, (_, index) => ({
        _searchText: `原文ブロック ${index}`,
      }))
    );
    writer.finish();

    assert.equal(ranges.length, 3);
    assert.equal(fs.readdirSync(tempDir).length, 3);
    assert.equal(new Set(ranges.map((range) => range.exact_text_url)).size, 3);
    assert.deepEqual(ranges.map((range) => range.end - range.start), [64, 64, 2]);
    for (const range of ranges) {
      const filePath = path.join(tempDir, path.basename(range.exact_text_url));
      const compressed = fs.readFileSync(filePath);
      const key = `exact:${range.exact_text_url}:0:${compressed.length}`;
      const asset = catalog[key];
      assert.equal(range.byte_start, 0);
      assert.equal(range.byte_length, compressed.length);
      assert.equal(asset.asset_bytes, compressed.length);
      assert.equal(asset.bytes, compressed.length);
      assert.equal(
        JSON.parse(zlib.gunzipSync(compressed).toString("utf8")).length,
        range.end - range.start
      );
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("asset gate失敗時はfresh stateを残さず、成功後だけatomic commitする", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "search-state-test-"));
  const stateFile = path.join(tempDir, "search-build-state.json");
  try {
    assert.throws(() => writeSearchBuildStateAtomically({
      stateFile,
      payload: buildState,
      validateAssets: () => {
        throw new Error("asset gate failed");
      },
    }), /asset gate failed/u);
    assert.equal(fs.existsSync(stateFile), false);
    assert.equal(fs.readdirSync(tempDir).some((name) => name.endsWith(".tmp")), false);

    writeSearchBuildStateAtomically({
      stateFile,
      payload: buildState,
      validateAssets: () => ({ files: 1, bytes: 1 }),
    });
    assert.deepEqual(JSON.parse(fs.readFileSync(stateFile, "utf8")), buildState);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("独立verifier失敗時はbuild stateと一時stateをfail-closedで無効化する", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "search-state-invalidate-test-"));
  const stateFile = path.join(tempDir, "search-build-state.json");
  try {
    fs.writeFileSync(stateFile, JSON.stringify(buildState));
    fs.writeFileSync(`${stateFile}.123.tmp`, "partial");
    invalidateSearchBuildState(stateFile);
    assert.equal(fs.existsSync(stateFile), false);
    assert.equal(fs.existsSync(`${stateFile}.123.tmp`), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("seat 0・欠損・同名を含む議員検索document IDを安定して一意化する", () => {
  const members = [
    { city: "otobe", seat_number: 0, name: "工藤智司", furigana: "くどうさとし" },
    { city: "otobe", seat_number: 0, name: "安岡美穂", furigana: "やすおかみほ" },
    { city: "otobe", seat_number: null, name: "同名議員", furigana: "どうめいぎいん" },
    { city: "otobe", seat_number: null, name: "同名議員", furigana: "どうめいぎいん" },
    { city: "otobe", seat_number: 3, name: "有効議席" },
  ];
  const ids = memberSearchDocumentIds(members);
  assert.equal(new Set(ids).size, members.length);
  assert.deepEqual(memberSearchDocumentIds(members), ids);
  assert.match(ids[4], /member:otobe:seat:3$/u);
  assert.equal(positiveSeatNumber(0), null);
  assert.equal(positiveSeatNumber(-1), null);
  assert.equal(positiveSeatNumber(1.5), null);
  assert.equal(positiveSeatNumber(3), 3);
});

test("posting spoolのopen handle上限は一般的なCI soft limitより十分小さい", () => {
  assert.ok(POSTING_SPOOL_OPEN_HANDLE_LIMIT <= 64);
});

test("delta postingは文書IDの厳密昇順・重複なしを要求する", () => {
  assert.equal(typeof encodeDocumentIds([0, 2, 9]), "string");
  assert.throws(() => encodeDocumentIds([0, 2, 2]), /strictly increasing/u);
  assert.throws(() => encodeDocumentIds([2, 1]), /strictly increasing/u);
});

test("入力mtimeが変われば検索build fingerprintも変わる", () => {
  const before = fingerprintSearchInputMetadata([
    { path: "site/data/chitose/minutes/index.json", size: 10, mtimeMs: 1 },
  ]);
  const after = fingerprintSearchInputMetadata([
    { path: "site/data/chitose/minutes/index.json", size: 10, mtimeMs: 2 },
  ]);
  assert.notEqual(before, after);
});

test("structured-minutesもfreshness fingerprint入力に含める", () => {
  assert.ok(
    searchIndexInputFiles().some((filePath) => filePath.includes("/structured-minutes/"))
  );
});

test("Research・議事録一覧の互換payloadは全期間agendaだけを保持する", () => {
  const runtimeIndex = {
    version: 1,
    generated_at: "2026-08-23T00:00:00.000Z",
    excerpt_max: 400,
    restricted_minutes_cities: ["makubetsu", "sapporo"],
    municipalities: [{ slug: "chitose", name: "千歳市" }],
    agendas: [
      {
        city: "chitose",
        cityName: "千歳市",
        council_id: 490,
        council_name: "令和8年第2回定例会",
        year: "2026",
        date: "2026-06-01",
        schedule_id: 1,
        schedule_index: 0,
        schedule_name: "一般質問",
        agenda_title: "市立病院について",
        first_minute_id: 123,
        text: "千歳市民の入院を受け入れた",
        truncated: false,
        agenda_index: 0,
        generated_summary: "公開してはいけないAI要約",
      },
      {
        city: "chitose",
        cityName: "千歳市",
        council_id: 300,
        council_name: "令和2年第1回定例会",
        year: "2020",
        date: "2020-03-01",
        schedule_id: 1,
        schedule_index: 0,
        schedule_name: "一般質問",
        agenda_title: "過年度の議題",
        first_minute_id: 10,
        text: "直近期間より前の会議録本文",
        truncated: true,
        agenda_index: 0,
      },
    ],
    sessions: [{ transcript: "runtime専用本文" }],
    enriched: [{ summary: "AI要約" }],
    decisions: [{ description: "議決" }],
    members: [{ name: "議員" }],
    memberActivities: [{ overview: "AI概要" }],
  };

  const compatibility = agendaOnlyRuntimeIndex(runtimeIndex, "full");
  assert.deepEqual(Object.keys(compatibility), [
    "version",
    "generated_at",
    "excerpt_max",
    "scope",
    "count",
    "restricted_minutes_cities",
    "municipalities",
    "agendas",
  ]);
  assert.equal(compatibility.scope, "full");
  assert.equal(compatibility.count, 2);
  assert.deepEqual(compatibility.agendas.map((agenda) => agenda.year), ["2026", "2020"]);
  assert.equal(compatibility.agendas[0].first_minute_id, 123);
  assert.equal(compatibility.agendas[0].truncated, false);
  assert.equal(Object.hasOwn(compatibility.agendas[0], "generated_summary"), false);
  assert.equal(Object.hasOwn(compatibility, "sessions"), false);
  assert.equal(Object.hasOwn(compatibility, "memberActivities"), false);
});

test("ブラウザ検索は削除済みrecent/runtime shardへ退避しない", () => {
  const searchClientSource = fs.readFileSync(
    path.resolve("site/src/components/SearchClient.tsx"),
    "utf8"
  );
  const searchRouteSource = fs.readFileSync(
    path.resolve("site/src/app/api/search/route.ts"),
    "utf8"
  );
  const minutesIndexSource = fs.readFileSync(
    path.resolve("site/src/components/MinutesIndexClient.tsx"),
    "utf8"
  );

  for (const source of [searchClientSource, searchRouteSource]) {
    assert.doesNotMatch(source, /search-index-recent\.json/u);
    assert.doesNotMatch(source, /search-index-shards/u);
  }
  assert.match(
    minutesIndexSource,
    /\/generated\/search-indexes\/\$\{city\}\.json/u
  );
});

test("会議録速報の品質ケースはsessionとsegmentを一意に指定する", () => {
  const cases = JSON.parse(
    fs.readFileSync(path.resolve("site/data/search_quality_cases.json"), "utf8")
  );
  const sessionCases = cases.filter((testCase) => testCase.expected?.source === "session");
  assert.ok(sessionCases.length > 0);
  for (const testCase of sessionCases) {
    assert.ok(testCase.expected.session_id, testCase.id);
    assert.equal(Number.isInteger(testCase.expected.segment_index), true, testCase.id);
  }
});
