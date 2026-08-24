import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  beginSearchTransferFetch,
  cancelSearchResponseBody,
  createSearchTransferBudget,
  exactSearchAssetMetadataMatches,
  reconcileSearchTransferAttempt,
  reserveSearchTransferAssets,
  responseWireBytes,
  searchAssetMetadataFingerprint,
  searchAssetPlanFromCatalog,
  validSearchAssetMetadata,
  validSearchContentRange,
} from "../../site/src/lib/searchTransferBudget.mjs";

const shaA = "a".repeat(64);
const shaB = "b".repeat(64);
const limits = { requests: 2, gzipBytes: 16, rawBytes: 64 };

function gzipAsset(url = "/generated/search/posting.json.gz") {
  return {
    url,
    encoding: "gzip",
    bytes: 8,
    raw_bytes: 24,
    sha256: shaA,
    raw_sha256: shaB,
  };
}

test("検索転送量は境界値を許可し、1 byte超過を記録したまま拒否する", () => {
  const budget = createSearchTransferBudget();
  const attemptKey = beginSearchTransferFetch(
    budget,
    { key: "asset:a", gzipBytes: 16, rawBytes: 64 },
    limits
  );
  assert.equal(attemptKey, "asset:a");
  assert.equal(reconcileSearchTransferAttempt(budget, attemptKey, 16, 64, limits), true);
  assert.equal(reconcileSearchTransferAttempt(budget, attemptKey, 17, 65, limits), false);
  assert.equal(budget.gzipBytes, 17);
  assert.equal(budget.rawBytes, 65);
  assert.equal(
    reserveSearchTransferAssets(
      budget,
      [{ key: "asset:b", gzipBytes: 0, rawBytes: 0 }],
      limits
    ),
    false
  );
});

test("manifest bootstrapだけは最大予約を実測値へ安全に縮小できる", () => {
  const budget = createSearchTransferBudget();
  const attemptKey = beginSearchTransferFetch(
    budget,
    { key: "manifest:a", gzipBytes: 16, rawBytes: 64, allowDecrease: true },
    limits
  );
  assert.equal(reconcileSearchTransferAttempt(budget, attemptKey, 4, 8, limits), true);
  assert.equal(budget.gzipBytes, 4);
  assert.equal(budget.rawBytes, 8);
});

test("96 requestsちょうどは許可し、97件目はfetch前に拒否する", () => {
  const requestLimits = { requests: 96, gzipBytes: 1024, rawBytes: 1024 };
  const budget = createSearchTransferBudget();
  assert.equal(
    reserveSearchTransferAssets(
      budget,
      Array.from({ length: 96 }, (_, index) => ({
        key: `asset:${index}`,
        gzipBytes: 1,
        rawBytes: 1,
      })),
      requestLimits
    ),
    true
  );
  assert.equal(
    beginSearchTransferFetch(
      budget,
      { key: "asset:96", gzipBytes: 1, rawBytes: 1 },
      requestLimits
    ),
    null
  );
  assert.equal(budget.requests, 96);
});

test("optional実転送が上限を超えた後は同key retryも別assetも拒否する", () => {
  const budget = createSearchTransferBudget();
  const plan = { key: "exact:a", gzipBytes: 8, rawBytes: 24 };
  const attemptKey = beginSearchTransferFetch(budget, plan, limits);
  assert.equal(reconcileSearchTransferAttempt(budget, attemptKey, 17, 65, limits), false);
  assert.equal(beginSearchTransferFetch(budget, plan, limits), null);
  assert.equal(
    beginSearchTransferFetch(
      budget,
      { key: "exact:b", gzipBytes: 0, rawBytes: 0 },
      limits
    ),
    null
  );
  assert.equal(budget.gzipBytes, 17);
  assert.equal(budget.rawBytes, 65);
});

test("raw metadata不一致でもgunzip実量をhash判定前に台帳へ保持できる", () => {
  const budget = createSearchTransferBudget();
  const plan = { key: "exact:raw-mismatch", gzipBytes: 8, rawBytes: 24 };
  const attemptKey = beginSearchTransferFetch(budget, plan, limits);
  assert.equal(reconcileSearchTransferAttempt(budget, attemptKey, 8, 24, limits), true);
  assert.equal(reconcileSearchTransferAttempt(budget, attemptKey, 8, 65, limits), false);
  assert.equal(budget.gzipBytes, 8);
  assert.equal(budget.rawBytes, 65);
});

test("strictとfallbackは同一planをdedupeし、相違する同一keyを拒否する", () => {
  const budget = createSearchTransferBudget();
  const plan = { key: "posting:a", gzipBytes: 8, rawBytes: 24 };
  assert.equal(reserveSearchTransferAssets(budget, [plan, plan], limits), true);
  assert.equal(reserveSearchTransferAssets(budget, [plan], limits), true);
  assert.equal(budget.requests, 1);
  assert.throws(
    () => reserveSearchTransferAssets(
      budget,
      [{ ...plan, rawBytes: 25 }],
      limits
    ),
    /conflicting search transfer plan/u
  );
});

test("失敗後retryはattempt別に保持し、初回実績を上書きしない", () => {
  const budget = createSearchTransferBudget();
  const generous = { requests: 4, gzipBytes: 100, rawBytes: 200 };
  const plan = { key: "document:a", gzipBytes: 10, rawBytes: 20 };
  const first = beginSearchTransferFetch(budget, plan, generous);
  assert.equal(first, "document:a");
  assert.equal(reconcileSearchTransferAttempt(budget, first, 12, 22, generous), true);
  const retry = beginSearchTransferFetch(budget, plan, generous);
  assert.equal(retry, "document:a:retry:1");
  assert.equal(reconcileSearchTransferAttempt(budget, retry, 14, 24, generous), true);
  assert.equal(budget.requests, 2);
  assert.equal(budget.gzipBytes, 26);
  assert.equal(budget.rawBytes, 46);
  assert.equal(budget.assets.get(first).gzipBytes, 12);
  assert.equal(budget.assets.get(retry).gzipBytes, 14);
});

test("Content-Length欠損・0・過少・不正値はbody実長を下回らない", () => {
  assert.equal(responseWireBytes(new Headers(), 10), 10);
  assert.equal(responseWireBytes(new Headers({ "content-length": "0" }), 10), 10);
  assert.equal(responseWireBytes(new Headers({ "content-length": "9" }), 10), 10);
  assert.equal(responseWireBytes(new Headers({ "content-length": "invalid" }), 10), 10);
  assert.equal(responseWireBytes(new Headers({ "content-length": "11" }), 10), 11);
});

test("Content-Rangeは開始・終了・asset総長をすべて厳密照合する", () => {
  assert.equal(validSearchContentRange("bytes 10-19/100", 10, 10, 100), true);
  for (const header of [
    null,
    "bytes 9-19/100",
    "bytes 10-18/100",
    "bytes 10-20/100",
    "bytes 10-19/99",
    "bytes 10-19/101",
    "bytes 10-19/*",
    "bytes 10-19/100, bytes 10-19/100",
  ]) {
    assert.equal(validSearchContentRange(header, 10, 10, 100), false, header ?? "missing");
  }
});

test("Range非対応responseは本文全体を読まずcancelできる", async () => {
  let cancelCount = 0;
  await cancelSearchResponseBody({
    body: {
      async cancel() {
        cancelCount += 1;
      },
    },
  });
  assert.equal(cancelCount, 1);
});

test("body cancel失敗は後続ledger処理を妨げない", async () => {
  await assert.doesNotReject(() => cancelSearchResponseBody({
    body: {
      async cancel() {
        throw new Error("stream already closed");
      },
    },
  }));
});

test("catalog key・URL・encoding・fingerprintを一致させる", () => {
  const asset = gzipAsset();
  assert.equal(validSearchAssetMetadata(asset), true);
  assert.deepEqual(
    searchAssetPlanFromCatalog(`posting:${asset.url}`, asset),
    { key: `posting:${asset.url}`, gzipBytes: 8, rawBytes: 24 }
  );
  assert.throws(
    () => searchAssetPlanFromCatalog("posting:/generated/wrong.json.gz", asset),
    /catalog key mismatch/u
  );
  assert.throws(
    () => searchAssetPlanFromCatalog(`posting:${asset.url}`, { ...asset, encoding: "identity" }),
    /catalog key mismatch/u
  );
  assert.notEqual(
    searchAssetMetadataFingerprint(asset),
    searchAssetMetadataFingerprint({ ...asset, sha256: shaB })
  );
});

test("exact Range catalogはoffset・bytes・raw bytes・asset totalを厳密照合する", () => {
  const expected = {
    url: "/generated/search/exact.bin",
    byteStart: 10,
    bytes: 20,
    rawBytes: 40,
  };
  const key = `exact:${expected.url}:10:20`;
  const asset = {
    url: expected.url,
    encoding: "gzip-member-json",
    byte_start: 10,
    bytes: 20,
    raw_bytes: 40,
    asset_bytes: 100,
    sha256: shaA,
    raw_sha256: shaB,
  };
  assert.equal(exactSearchAssetMetadataMatches(key, asset, expected), true);
  for (const changed of [
    { byte_start: 11 },
    { bytes: 21 },
    { raw_bytes: 41 },
    { asset_bytes: 29 },
  ]) {
    assert.equal(exactSearchAssetMetadataMatches(key, { ...asset, ...changed }, expected), false);
  }
});

test("clientはgunzip直後に実raw量を計上し、cache fingerprint不一致を拒否する", () => {
  const source = fs.readFileSync(
    new URL("../../site/src/components/SearchClient.tsx", import.meta.url),
    "utf8"
  );
  const rawReconcilePatterns = [
    /rawBuffer = await gunzipSearchAsset\(buffer\);[\s\S]{0,300}?reconcileSearchAssetActualBytes\([\s\S]{0,250}?rawBuffer\.byteLength[\s\S]{0,250}?rawBuffer\.byteLength !== asset\.raw_bytes/u,
    /const rawBuffer = await gunzipSearchAsset\(buffer\);[\s\S]{0,300}?reconcileSearchAssetActualBytes\([\s\S]{0,250}?rawBuffer\.byteLength[\s\S]{0,250}?rawBuffer\.byteLength !== block\.rawBytes/u,
  ];
  for (const pattern of rawReconcilePatterns) assert.match(source, pattern);
  assert.match(
    source,
    /cached && cached\.fingerprint !== fingerprint[\s\S]{0,120}?throw new Error/u
  );
});
