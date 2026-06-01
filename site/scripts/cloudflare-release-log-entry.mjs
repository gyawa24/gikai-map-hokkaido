import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkPreflightStamp,
  checkUrlVerificationStamp,
  readPreflightStamp,
  readUrlVerificationStamp,
} from "./cloudflare-preflight-stamp.mjs";

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(siteRoot, "..");
const logPath = path.join(repoRoot, "docs", "cloudflare-release-log.md");

function hasFlag(name) {
  return process.argv.includes(name);
}

function formatDate(iso) {
  const date = iso ? new Date(iso) : new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatTimestamp(iso) {
  if (!iso) return "未記録";

  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second} JST`;
}

function isLocalUrl(value) {
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function statusText(ok, reason) {
  return ok ? "通過" : `未通過 (${reason ?? "unknown"})`;
}

const preflight = checkPreflightStamp();
const deployUrlGate = checkUrlVerificationStamp(preflight, { allowLocal: false });
const anyUrlGate = checkUrlVerificationStamp(preflight, { allowLocal: true });
const stamp = readPreflightStamp();
const verification = readUrlVerificationStamp();
const append = hasFlag("--append");
const allowLocal = hasFlag("--allow-local");
const allowNotReady = hasFlag("--allow-not-ready");
const dryRun = hasFlag("--dry-run");

const date = formatDate(verification?.verified_at ?? stamp?.created_at);
const hasVerificationUrl = Boolean(verification?.base_url);
const verificationUrl = verification?.base_url ?? "未記録";
const localOnly = hasVerificationUrl && isLocalUrl(verificationUrl);
const externalUrlVerified = hasVerificationUrl && !localOnly;
const localPrepOnly = !externalUrlVerified;
const expectedRobots = verification?.expected_robots ?? "未記録";
const uploadStatus = externalUrlVerified ? "実施済み" : "未実施";
const deployGate = deployUrlGate.ok
  ? `ready (${deployUrlGate.verification.base_url})`
  : `not ready (${deployUrlGate.reason})`;
const releaseStatus = preflight.ok
  ? externalUrlVerified
    ? "ローカル成果物OK・Cloudflare URL検証済み"
    : localOnly
      ? "ローカル成果物OK・Cloudflare URL未検証"
      : "ローカル成果物OK・URL未検証"
  : `preflight未通過 (${preflight.reason})`;
const title = `${date} Cloudflare ${localPrepOnly ? "ローカル準備" : "検証"}`;

const entry = `## ${title}

実施者: Codex

#### ローカル確認

- \`npm run cf:preflight\`: ${statusText(preflight.ok, preflight.reason)}
- preflight recorded_at: ${formatTimestamp(stamp?.created_at)}
- source files: ${stamp?.file_count?.toLocaleString() ?? "未記録"}
- artifact files: ${stamp?.artifact_file_count?.toLocaleString() ?? "未記録"}
- dry-run: ${preflight.ok ? "通過" : "未通過"}
- 備考: ${externalUrlVerified ? "Cloudflare上のURL検証まで実施。" : localOnly ? "ローカルpreviewのみ検証。Cloudflare uploadは未実施。" : "Cloudflare URL検証は未実施。"}

#### Cloudflare upload

- 実行コマンド: ${externalUrlVerified ? "CLOUDFLARE_RELEASE_CONFIRM=upload-and-verify npm run cf:upload-verify" : "未実施"}
- Workers URL: ${externalUrlVerified ? verificationUrl : "未記録"}
- 検証用サブドメイン: 未記録
- upload結果: ${uploadStatus}
- 備考:

#### 検証URL確認

- 実行コマンド: ${verification ? `npm run cf:verify-url -- --base ${verificationUrl}` : "未実施"}
- verified URL: ${verificationUrl}
- verified_at: ${formatTimestamp(verification?.verified_at)}
- expected robots: ${expectedRobots}
- \`npm run cf:release-status\`: ${releaseStatus}
- deploy URL gate: ${deployGate}
- 備考: ${anyUrlGate.ok && localOnly ? "ローカルpreview検証は記録済みだが、cf:deployは解放しない。" : ""}

#### 本番DNS切替後の確認

- DNS切替時刻: 未実施
- 実行コマンド: 未実施
- production URL: 未実施
- robots: 未確認
- sitemap: 未確認
- search: 未確認
- GitHub Raw画像: 未確認
- rollback可否: Vercel側を残して確認予定
- 備考:
`;

if (!append) {
  console.log(entry);
  console.log("");
  console.log("Append this entry with:");
  console.log(
    localPrepOnly
      ? "  npm run cf:release-log-entry -- --append --allow-local"
      : "  npm run cf:release-log-entry -- --append",
  );
  process.exit(0);
}

if (!preflight.ok && !allowNotReady) {
  console.error(
    "Refusing to append release log because cf:preflight is not ready. Run npm run cf:preflight first, or pass --allow-not-ready if this is an intentional failure record.",
  );
  process.exit(1);
}

if (localPrepOnly && !allowLocal) {
  console.error(
    "Refusing to append a local-only release log entry. Verify a Cloudflare URL after upload, or pass --allow-local if this is intentionally a local preparation record.",
  );
  process.exit(1);
}

const marker = `## ${title}`;
const existing = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "";
const hasExistingEntry = existing.includes(marker);

if (dryRun) {
  console.log(entry);
  console.log("");
  console.log(
    hasExistingEntry
      ? `Dry run: would refuse to append because ${marker} already exists in ${path.relative(repoRoot, logPath)}`
      : `Dry run: would append to ${path.relative(repoRoot, logPath)}`
  );
  process.exit(0);
}

if (hasExistingEntry) {
  console.error(`Release log already has an entry for ${date}. Update it manually if needed.`);
  process.exit(1);
}

fs.appendFileSync(logPath, `${existing.endsWith("\n") ? "" : "\n"}\n${entry}`);
console.log(`Appended Cloudflare release log entry: ${path.relative(repoRoot, logPath)}`);
