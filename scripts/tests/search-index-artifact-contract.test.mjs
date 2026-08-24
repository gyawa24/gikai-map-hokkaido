import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCanonicalSearchPostingBuckets,
  assertCitySearchManifestContract,
  assertExactSearchAssetUrlSet,
  assertStatewideSearchCityCoverage,
} from "../../site/scripts/lib/search-index-artifact-contract.mjs";

function fixture() {
  const catalog = {
    url: "/generated/search-bigram-statewide/asset-catalog.json.gz",
    encoding: "gzip",
    bytes: 100,
    raw_bytes: 200,
    sha256: "a".repeat(64),
    raw_sha256: "b".repeat(64),
  };
  const statewideManifest = {
    version: 5,
    generated_at: "2026-08-24T00:00:00.000Z",
    bucket_count: 1024,
    ngram_widths: [2, 3],
    positional_trigrams: false,
    buckets: ["001.json.gz", "002.json.gz"],
    exact_terms: ["学校給食"],
    postings_encoding: "gzip",
    posting_value_encoding: "delta-varint-v1",
    asset_catalog: catalog,
  };
  const cityMeta = {
    slug: "chitose",
    document_count: 2,
    minutes_access: "public",
    document_ranges: [{ start: 0, end: 2, documents_url: "/generated/documents/0.json.gz" }],
    exact_text_ranges: [{
      start: 0,
      end: 2,
      exact_text_url: "/generated/exact-text/0.bin",
      byte_start: 0,
      byte_length: 50,
      raw_bytes: 100,
    }],
  };
  const cityManifest = {
    version: statewideManifest.version,
    generated_at: statewideManifest.generated_at,
    scope: "city-bigram",
    city: cityMeta.slug,
    document_count: cityMeta.document_count,
    bucket_count: statewideManifest.bucket_count,
    ngram_widths: statewideManifest.ngram_widths,
    positional_trigrams: statewideManifest.positional_trigrams,
    buckets: ["001.json.gz"],
    exact_terms: statewideManifest.exact_terms,
    postings_encoding: statewideManifest.postings_encoding,
    posting_value_encoding: statewideManifest.posting_value_encoding,
    postings_base_url: "/generated/search-bigram-statewide/postings",
    asset_catalog: statewideManifest.asset_catalog,
    document_ranges: cityMeta.document_ranges,
    exact_text_ranges: cityMeta.exact_text_ranges,
    minutes_access: cityMeta.minutes_access,
  };
  const catalogAssets = {
    "posting:/generated/search-bigram-statewide/postings/001.json.gz": {},
    "posting:/generated/search-bigram-statewide/postings/002.json.gz": {},
  };
  return { catalogAssets, cityManifest, cityMeta, statewideManifest };
}

test("検索所有assetの物理集合は参照集合とmissing/orphan双方向で一致させる", () => {
  assert.doesNotThrow(() => assertExactSearchAssetUrlSet(
    ["/generated/a.json.gz", "/generated/b.bin"],
    ["/generated/b.bin", "/generated/a.json.gz"],
    "fixture"
  ));
  assert.throws(
    () => assertExactSearchAssetUrlSet(
      ["/generated/a.json.gz", "/generated/b.bin"],
      ["/generated/a.json.gz", "/generated/stale-restricted.bin"],
      "fixture"
    ),
    /missing: \/generated\/b\.bin; orphan: \/generated\/stale-restricted\.bin/u
  );
});

test("statewide posting manifestは正規bucket filenameを欠落・重複なく全件持つ", () => {
  const fileForBucket = (bucket) => `${bucket.toString(16).padStart(3, "0")}.json.gz`;
  const canonical = Array.from({ length: 4 }, (_, bucket) => fileForBucket(bucket));
  assert.doesNotThrow(() => assertCanonicalSearchPostingBuckets(canonical, 4, fileForBucket));
  assert.throws(
    () => assertCanonicalSearchPostingBuckets(canonical.slice(1), 4, fileForBucket),
    /bucket count differs/u
  );
  assert.throws(
    () => assertCanonicalSearchPostingBuckets(
      [canonical[0], canonical[0], canonical[2], canonical[3]],
      4,
      fileForBucket
    ),
    /contain duplicates/u
  );
  assert.throws(
    () => assertCanonicalSearchPostingBuckets(
      [canonical[0], canonical[1], canonical[2], "foreign.json.gz"],
      4,
      fileForBucket
    ),
    /bucket set differs/u
  );
});

test("statewide city metadataはactive slug集合と文書総数を完全一致させる", () => {
  const manifest = {
    document_count: 3,
    cities: [
      { slug: "chitose", document_count: 2 },
      { slug: "eniwa", document_count: 1 },
    ],
  };
  assert.doesNotThrow(() => assertStatewideSearchCityCoverage(
    manifest,
    ["eniwa", "chitose"]
  ));
  assert.throws(
    () => assertStatewideSearchCityCoverage(
      { ...manifest, cities: [manifest.cities[0], manifest.cities[0]] },
      ["chitose", "eniwa"]
    ),
    /slugs are missing or duplicated/u
  );
  assert.throws(
    () => assertStatewideSearchCityCoverage(
      { ...manifest, cities: [manifest.cities[0]] },
      ["chitose", "eniwa"]
    ),
    /municipality count differs/u
  );
  assert.throws(
    () => assertStatewideSearchCityCoverage(
      {
        ...manifest,
        cities: [manifest.cities[0], { slug: "foreign", document_count: 1 }],
      },
      ["chitose", "eniwa"]
    ),
    /municipality set differs/u
  );
  assert.throws(
    () => assertStatewideSearchCityCoverage(
      { ...manifest, document_count: 4 },
      ["chitose", "eniwa"]
    ),
    /document count differs from municipality totals/u
  );
});

test("city manifestはstatewide entry・Range・posting契約と完全一致させる", () => {
  const value = fixture();
  assert.doesNotThrow(() => assertCitySearchManifestContract(
    value.cityMeta,
    value.cityManifest,
    value.statewideManifest,
    value.catalogAssets,
    ["001.json.gz"]
  ));
  for (const [field, changed] of [
    ["scope", "statewide-bigram"],
    ["city", "eniwa"],
    ["document_ranges", []],
    ["exact_text_ranges", []],
    ["exact_terms", []],
    ["postings_encoding", "identity"],
    ["posting_value_encoding", "json"],
    ["postings_base_url", "/generated/foreign/postings"],
  ]) {
    assert.throws(
      () => assertCitySearchManifestContract(
        value.cityMeta,
        { ...value.cityManifest, [field]: changed },
        value.statewideManifest,
        value.catalogAssets,
        ["001.json.gz"]
      ),
      new RegExp(`city manifest ${field}`)
    );
  }
});

test("city manifestはforeign・重複・catalog外postingを拒否する", () => {
  const value = fixture();
  assert.throws(
    () => assertCitySearchManifestContract(
      value.cityMeta,
      { ...value.cityManifest, buckets: ["foreign.json.gz"] },
      value.statewideManifest,
      value.catalogAssets,
      ["001.json.gz"]
    ),
    /foreign posting bucket/u
  );
  assert.throws(
    () => assertCitySearchManifestContract(
      value.cityMeta,
      { ...value.cityManifest, buckets: ["001.json.gz", "001.json.gz"] },
      value.statewideManifest,
      value.catalogAssets,
      ["001.json.gz"]
    ),
    /contain duplicates/u
  );
  assert.throws(
    () => assertCitySearchManifestContract(
      value.cityMeta,
      value.cityManifest,
      value.statewideManifest,
      {},
      ["001.json.gz"]
    ),
    /absent from the catalog/u
  );
  assert.throws(
    () => assertCitySearchManifestContract(
      value.cityMeta,
      { ...value.cityManifest, buckets: [] },
      value.statewideManifest,
      value.catalogAssets,
      ["001.json.gz"]
    ),
    /city manifest buckets differs/u
  );
  assert.throws(
    () => assertCitySearchManifestContract(
      value.cityMeta,
      { ...value.cityManifest, buckets: ["001.json.gz", "002.json.gz"] },
      value.statewideManifest,
      value.catalogAssets,
      ["001.json.gz"]
    ),
    /city manifest buckets differs/u
  );
});
