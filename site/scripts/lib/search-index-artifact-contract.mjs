function canonical(value) {
  return JSON.stringify(value);
}

function assertSameValue(actual, expected, label) {
  if (canonical(actual) !== canonical(expected)) {
    throw new Error(`${label} differs`);
  }
}

export function assertWholeExactTextAssetBlock(range, assetBytes, label) {
  if (
    !Number.isSafeInteger(assetBytes)
    || assetBytes <= 0
    || range?.byte_start !== 0
    || range?.byte_length !== assetBytes
  ) {
    throw new Error(`${label}: exact text block must cover its whole asset`);
  }
}

export function assertExactSearchAssetUrlSet(expectedUrls, actualUrls, label) {
  const expected = Array.from(new Set(expectedUrls)).sort();
  const actual = Array.from(new Set(actualUrls)).sort();
  const missing = expected.filter((url) => !actual.includes(url));
  const orphan = actual.filter((url) => !expected.includes(url));
  if (missing.length > 0 || orphan.length > 0) {
    throw new Error(
      `${label} file set differs`
      + ` (missing: ${missing.join(", ") || "none"}; orphan: ${orphan.join(", ") || "none"})`
    );
  }
}

export function assertCanonicalSearchPostingBuckets(
  actualFiles,
  bucketCount,
  bucketFileForBucket
) {
  if (!Array.isArray(actualFiles) || actualFiles.length !== bucketCount) {
    throw new Error("statewide search posting bucket count differs");
  }
  if (new Set(actualFiles).size !== actualFiles.length) {
    throw new Error("statewide search posting buckets contain duplicates");
  }
  assertSameValue(
    [...actualFiles].sort(),
    Array.from({ length: bucketCount }, (_, bucket) => bucketFileForBucket(bucket)).sort(),
    "statewide search posting bucket set"
  );
}

export function assertStatewideSearchCityCoverage(manifest, activeSlugs) {
  if (!Array.isArray(manifest.cities) || manifest.cities.length !== activeSlugs.length) {
    throw new Error("statewide search municipality count differs");
  }
  const citySlugs = manifest.cities.map((city) => city?.slug);
  if (
    citySlugs.some((slug) => typeof slug !== "string" || slug.length === 0)
    || new Set(citySlugs).size !== citySlugs.length
  ) {
    throw new Error("statewide search municipality slugs are missing or duplicated");
  }
  assertSameValue(
    [...citySlugs].sort(),
    [...activeSlugs].sort(),
    "statewide search municipality set"
  );
  const documentCount = manifest.cities.reduce((sum, city) => {
    if (!Number.isSafeInteger(city.document_count) || city.document_count < 0) {
      throw new Error(`${city.slug}: statewide search document count is invalid`);
    }
    return sum + city.document_count;
  }, 0);
  if (manifest.document_count !== documentCount) {
    throw new Error("statewide search document count differs from municipality totals");
  }
}

export function assertCitySearchManifestContract(
  cityMeta,
  cityManifest,
  statewideManifest,
  catalogAssets,
  expectedBuckets
) {
  const city = cityMeta.slug;
  const fixedFields = {
    version: statewideManifest.version,
    generated_at: statewideManifest.generated_at,
    scope: "city-bigram",
    city,
    document_count: cityMeta.document_count,
    bucket_count: statewideManifest.bucket_count,
    ngram_widths: statewideManifest.ngram_widths,
    positional_trigrams: statewideManifest.positional_trigrams,
    exact_terms: statewideManifest.exact_terms,
    postings_encoding: statewideManifest.postings_encoding,
    posting_value_encoding: statewideManifest.posting_value_encoding,
    postings_base_url: "/generated/search-bigram-statewide/postings",
    asset_catalog: statewideManifest.asset_catalog,
    document_ranges: cityMeta.document_ranges,
    exact_text_ranges: cityMeta.exact_text_ranges,
    minutes_access: cityMeta.minutes_access,
  };
  for (const [field, expected] of Object.entries(fixedFields)) {
    assertSameValue(cityManifest[field], expected, `${city}: city manifest ${field}`);
  }

  if (!Array.isArray(cityManifest.buckets)) {
    throw new Error(`${city}: city manifest buckets are missing`);
  }
  const cityBuckets = new Set(cityManifest.buckets);
  if (cityBuckets.size !== cityManifest.buckets.length) {
    throw new Error(`${city}: city manifest buckets contain duplicates`);
  }
  const statewideBuckets = new Set(statewideManifest.buckets);
  for (const file of cityBuckets) {
    if (!statewideBuckets.has(file)) {
      throw new Error(`${city}: city manifest references a foreign posting bucket (${file})`);
    }
    const url = `${cityManifest.postings_base_url}/${file}`;
    if (!Object.hasOwn(catalogAssets, `posting:${url}`)) {
      throw new Error(`${city}: city manifest posting bucket is absent from the catalog (${file})`);
    }
  }
  assertSameValue(
    Array.from(cityBuckets).sort(),
    Array.from(new Set(expectedBuckets)).sort(),
    `${city}: city manifest buckets`
  );
}
