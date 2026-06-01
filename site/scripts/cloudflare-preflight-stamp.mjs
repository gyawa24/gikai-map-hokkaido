import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(siteRoot, "..");
const openNextRoot = path.join(siteRoot, ".open-next");

export const PREFLIGHT_STAMP_TTL_MS = 6 * 60 * 60 * 1000;
export const PREFLIGHT_STAMP_PATH = path.join(openNextRoot, "cloudflare-preflight.json");
export const URL_VERIFICATION_PATH = path.join(openNextRoot, "cloudflare-url-verification.json");

function listReleaseFiles() {
  const result = spawnSync(
    "git",
    ["-C", repoRoot, "ls-files", "--cached", "--others", "--exclude-standard", "site"],
    { encoding: "utf8" }
  );

  if (result.status !== 0) {
    throw new Error(result.stderr || "Failed to list release files for Cloudflare preflight.");
  }

  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
}

export function getReleaseFingerprint() {
  const hash = crypto.createHash("sha256");
  const files = listReleaseFiles();

  for (const relPath of files) {
    const fullPath = path.join(repoRoot, relPath);
    hash.update(relPath);
    hash.update("\0");

    let stat;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      hash.update("missing");
      hash.update("\0");
      continue;
    }

    if (!stat.isFile()) {
      hash.update("not-file");
      hash.update("\0");
      continue;
    }

    hash.update(String(stat.size));
    hash.update("\0");
    hash.update(String(Math.trunc(stat.mtimeMs)));
    hash.update("\0");
  }

  return {
    file_count: files.length,
    fingerprint: hash.digest("hex"),
  };
}

function walkFiles(root) {
  if (!fs.existsSync(root)) return [];

  const files = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fp = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fp);
      } else if (
        entry.isFile() &&
        fp !== PREFLIGHT_STAMP_PATH &&
        fp !== URL_VERIFICATION_PATH
      ) {
        files.push(fp);
      }
    }
  }
  return files.sort();
}

export function getArtifactFingerprint() {
  const hash = crypto.createHash("sha256");
  const files = walkFiles(openNextRoot);

  for (const fp of files) {
    const relPath = path.relative(openNextRoot, fp);
    const stat = fs.statSync(fp);
    hash.update(relPath);
    hash.update("\0");
    hash.update(String(stat.size));
    hash.update("\0");
    hash.update(fs.readFileSync(fp));
    hash.update("\0");
  }

  return {
    artifact_file_count: files.length,
    artifact_fingerprint_kind: "sha256-content-v1",
    artifact_fingerprint: hash.digest("hex"),
  };
}

export function writePreflightStamp(details = {}) {
  const fingerprint = getReleaseFingerprint();
  const artifacts = getArtifactFingerprint();
  const stamp = {
    created_at: new Date().toISOString(),
    ttl_ms: PREFLIGHT_STAMP_TTL_MS,
    ...fingerprint,
    ...artifacts,
    ...details,
  };

  fs.mkdirSync(path.dirname(PREFLIGHT_STAMP_PATH), { recursive: true });
  fs.writeFileSync(PREFLIGHT_STAMP_PATH, `${JSON.stringify(stamp, null, 2)}\n`);
  return stamp;
}

export function readPreflightStamp() {
  try {
    return JSON.parse(fs.readFileSync(PREFLIGHT_STAMP_PATH, "utf8"));
  } catch {
    return null;
  }
}

export function readUrlVerificationStamp() {
  try {
    return JSON.parse(fs.readFileSync(URL_VERIFICATION_PATH, "utf8"));
  } catch {
    return null;
  }
}

export function checkPreflightStamp(now = Date.now()) {
  const stamp = readPreflightStamp();
  if (!stamp) {
    return { ok: false, reason: "missing" };
  }

  const createdAt = Date.parse(stamp.created_at ?? "");
  if (!Number.isFinite(createdAt)) {
    return { ok: false, reason: "invalid_timestamp", stamp };
  }

  const ageMs = now - createdAt;
  if (ageMs < 0 || ageMs > PREFLIGHT_STAMP_TTL_MS) {
    return { ok: false, reason: "expired", ageMs, stamp };
  }

  const current = getReleaseFingerprint();
  if (current.fingerprint !== stamp.fingerprint) {
    return {
      ok: false,
      reason: "fingerprint_mismatch",
      current,
      stamp,
    };
  }

  const artifacts = getArtifactFingerprint();
  if (!stamp.artifact_fingerprint || artifacts.artifact_fingerprint !== stamp.artifact_fingerprint) {
    return {
      ok: false,
      reason: "artifact_mismatch",
      artifacts,
      stamp,
    };
  }

  return {
    ok: true,
    ageMs,
    current,
    artifacts,
    stamp,
  };
}

function isLocalVerificationUrl(value) {
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function checkUrlVerificationStamp(
  preflightStatus = checkPreflightStamp(),
  { allowLocal = true } = {}
) {
  const verification = readUrlVerificationStamp();
  if (!verification) {
    return { ok: false, reason: "missing", preflight: preflightStatus };
  }

  if (!preflightStatus.ok) {
    return {
      ok: false,
      reason: "preflight_not_ready",
      preflight: preflightStatus,
      verification,
    };
  }

  if (verification.preflight_status !== "ready") {
    return {
      ok: false,
      reason: "not_ready",
      preflight: preflightStatus,
      verification,
    };
  }

  if (!allowLocal && isLocalVerificationUrl(verification.base_url)) {
    return {
      ok: false,
      reason: "local_only",
      preflight: preflightStatus,
      verification,
    };
  }

  if (verification.preflight_fingerprint !== preflightStatus.stamp.fingerprint) {
    return {
      ok: false,
      reason: "fingerprint_mismatch",
      preflight: preflightStatus,
      verification,
    };
  }

  if (
    verification.preflight_artifact_fingerprint !==
    preflightStatus.stamp.artifact_fingerprint
  ) {
    return {
      ok: false,
      reason: "artifact_mismatch",
      preflight: preflightStatus,
      verification,
    };
  }

  return {
    ok: true,
    preflight: preflightStatus,
    verification,
  };
}
