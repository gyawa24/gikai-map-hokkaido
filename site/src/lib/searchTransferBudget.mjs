export const DEFAULT_SEARCH_TRANSFER_LIMITS = Object.freeze({
  requests: 96,
  gzipBytes: 16 * 1024 * 1024,
  rawBytes: 64 * 1024 * 1024,
});

export function isSearchAssetSha256(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

export function validSearchAssetMetadata(value) {
  if (!value || typeof value !== "object") return false;
  if (
    typeof value.url !== "string"
    || !value.url.startsWith("/generated/")
    || !["gzip", "identity", "gzip-member-json"].includes(value.encoding)
    || !Number.isSafeInteger(value.bytes)
    || value.bytes <= 0
    || !Number.isSafeInteger(value.raw_bytes)
    || value.raw_bytes <= 0
    || !isSearchAssetSha256(value.sha256)
    || !isSearchAssetSha256(value.raw_sha256)
  ) {
    return false;
  }
  return value.encoding !== "gzip-member-json" || (
    Number.isSafeInteger(value.byte_start)
    && value.byte_start >= 0
    && Number.isSafeInteger(value.asset_bytes)
    && value.asset_bytes >= value.byte_start + value.bytes
  );
}

export function searchAssetPlanFromCatalog(key, asset) {
  if (!validSearchAssetMetadata(asset)) throw new Error("invalid search asset metadata");
  const separator = key.indexOf(":");
  const kind = separator >= 0 ? key.slice(0, separator) : "";
  const expectedUrl = separator >= 0 ? key.slice(separator + 1) : "";
  if (
    !["posting", "document", "catalog"].includes(kind)
    || asset.encoding !== "gzip"
    || asset.url !== expectedUrl
  ) {
    throw new Error("search asset catalog key mismatch");
  }
  return { key, gzipBytes: asset.bytes, rawBytes: asset.raw_bytes };
}

export function searchAssetMetadataFingerprint(asset) {
  if (!validSearchAssetMetadata(asset)) throw new Error("invalid search asset metadata");
  return JSON.stringify([
    asset.url,
    asset.encoding,
    asset.bytes,
    asset.raw_bytes,
    asset.sha256,
    asset.raw_sha256,
    asset.byte_start ?? null,
    asset.asset_bytes ?? null,
  ]);
}

export function exactSearchAssetMetadataMatches(key, asset, expected) {
  if (!validSearchAssetMetadata(asset) || asset.encoding !== "gzip-member-json") return false;
  return key === `exact:${expected.url}:${expected.byteStart}:${expected.bytes}`
    && asset.url === expected.url
    && asset.byte_start === expected.byteStart
    && asset.bytes === expected.bytes
    && asset.raw_bytes === expected.rawBytes
    && asset.asset_bytes >= expected.byteStart + expected.bytes;
}

export function createSearchTransferBudget() {
  return {
    assets: new Map(),
    retryCounts: new Map(),
    requests: 0,
    gzipBytes: 0,
    rawBytes: 0,
  };
}

function validatePlan(plan) {
  if (
    !plan
    || typeof plan.key !== "string"
    || plan.key.length === 0
    || !Number.isInteger(plan.gzipBytes)
    || plan.gzipBytes < 0
    || !Number.isInteger(plan.rawBytes)
    || plan.rawBytes < 0
  ) {
    throw new Error("invalid search transfer plan");
  }
}

function samePlan(left, right) {
  return (left.plannedGzipBytes ?? left.gzipBytes) === right.gzipBytes
    && (left.plannedRawBytes ?? left.rawBytes) === right.rawBytes
    && Boolean(left.allowDecrease) === Boolean(right.allowDecrease);
}

export function reserveSearchTransferAssets(
  budget,
  plans,
  limits = DEFAULT_SEARCH_TRANSFER_LIMITS
) {
  const nextPlans = new Map();
  for (const plan of plans) {
    validatePlan(plan);
    const existing = budget.assets.get(plan.key) ?? nextPlans.get(plan.key);
    if (existing) {
      if (!samePlan(existing, plan)) throw new Error(`conflicting search transfer plan: ${plan.key}`);
      continue;
    }
    nextPlans.set(plan.key, plan);
  }
  const requests = budget.requests + nextPlans.size;
  const gzipBytes = budget.gzipBytes
    + Array.from(nextPlans.values()).reduce((sum, plan) => sum + plan.gzipBytes, 0);
  const rawBytes = budget.rawBytes
    + Array.from(nextPlans.values()).reduce((sum, plan) => sum + plan.rawBytes, 0);
  if (
    requests > limits.requests
    || gzipBytes > limits.gzipBytes
    || rawBytes > limits.rawBytes
  ) {
    return false;
  }
  for (const plan of nextPlans.values()) {
    budget.assets.set(plan.key, {
      plannedGzipBytes: plan.gzipBytes,
      plannedRawBytes: plan.rawBytes,
      gzipBytes: plan.gzipBytes,
      rawBytes: plan.rawBytes,
      allowDecrease: Boolean(plan.allowDecrease),
      attempted: false,
    });
  }
  budget.requests = requests;
  budget.gzipBytes = gzipBytes;
  budget.rawBytes = rawBytes;
  return true;
}

export function beginSearchTransferFetch(
  budget,
  plan,
  limits = DEFAULT_SEARCH_TRANSFER_LIMITS
) {
  if (!reserveSearchTransferAssets(budget, [plan], limits)) return null;
  const existing = budget.assets.get(plan.key);
  if (!existing) return null;
  if (!existing.attempted) {
    existing.attempted = true;
    return plan.key;
  }
  const retry = (budget.retryCounts.get(plan.key) ?? 0) + 1;
  budget.retryCounts.set(plan.key, retry);
  const retryPlan = { ...plan, key: `${plan.key}:retry:${retry}` };
  if (!reserveSearchTransferAssets(budget, [retryPlan], limits)) return null;
  const retryEntry = budget.assets.get(retryPlan.key);
  if (retryEntry) retryEntry.attempted = true;
  return retryPlan.key;
}

export function reconcileSearchTransferAttempt(
  budget,
  attemptKey,
  gzipBytes,
  rawBytes,
  limits = DEFAULT_SEARCH_TRANSFER_LIMITS
) {
  const entry = budget.assets.get(attemptKey);
  if (
    !entry
    || !Number.isInteger(gzipBytes)
    || gzipBytes < 0
    || !Number.isInteger(rawBytes)
    || rawBytes < 0
  ) {
    return false;
  }
  const chargedGzipBytes = entry.allowDecrease
    ? gzipBytes
    : Math.max(entry.gzipBytes, gzipBytes);
  const chargedRawBytes = entry.allowDecrease
    ? rawBytes
    : Math.max(entry.rawBytes, rawBytes);
  budget.gzipBytes += chargedGzipBytes - entry.gzipBytes;
  budget.rawBytes += chargedRawBytes - entry.rawBytes;
  entry.gzipBytes = chargedGzipBytes;
  entry.rawBytes = chargedRawBytes;
  return budget.gzipBytes <= limits.gzipBytes && budget.rawBytes <= limits.rawBytes;
}

export function responseWireBytes(headers, fallback) {
  const header = headers.get("content-length");
  if (header === null || header.trim() === "") return fallback;
  const contentLength = Number(header);
  return Number.isInteger(contentLength) && contentLength >= 0
    ? Math.max(contentLength, fallback)
    : fallback;
}

export function validSearchContentRange(header, byteStart, byteLength, assetBytes) {
  const match = header?.match(/^bytes\s+(\d+)-(\d+)\/(\d+)$/iu);
  if (!match) return false;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  return [start, end, total, byteStart, byteLength, assetBytes].every(Number.isSafeInteger)
    && byteStart >= 0
    && byteLength > 0
    && assetBytes >= byteStart + byteLength
    && start === byteStart
    && end === byteStart + byteLength - 1
    && total === assetBytes;
}

export async function cancelSearchResponseBody(response) {
  try {
    await response.body?.cancel();
  } catch {
    // The transfer ledger still has to record the attempt when stream cancellation fails.
  }
}
