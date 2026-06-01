import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  checkPreflightStamp,
  URL_VERIFICATION_PATH,
} from "./cloudflare-preflight-stamp.mjs";

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INDEXABLE_HOSTS = new Set(["chihougikai.com", "www.chihougikai.com"]);

function getArgValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function usage() {
  console.error(
    [
      "Usage:",
      "  npm run cf:verify-url -- --base https://<workers-or-subdomain-url>",
      "  npm run cf:verify-url -- --base https://chihougikai.com --allow-production-host",
      "",
      "This verifies a Cloudflare-uploaded URL with the same smoke suite used by local preflight.",
    ].join("\n")
  );
}

const rawBase =
  getArgValue("--base") ??
  process.argv.find((arg, index) => index > 1 && !arg.startsWith("-")) ??
  process.env.CLOUDFLARE_SMOKE_BASE_URL;

if (!rawBase) {
  usage();
  process.exit(1);
}

let baseUrl;
try {
  baseUrl = new URL(rawBase);
} catch {
  console.error(`Invalid URL: ${rawBase}`);
  usage();
  process.exit(1);
}

const isLocalHttp =
  baseUrl.protocol === "http:" &&
  ["localhost", "127.0.0.1", "::1"].includes(baseUrl.hostname);
const isProductionHost = INDEXABLE_HOSTS.has(baseUrl.hostname.toLowerCase());

if (baseUrl.protocol !== "https:" && !isLocalHttp) {
  console.error("Cloudflare verification URLs must use https://. Use cf:smoke directly for local HTTP checks.");
  process.exit(1);
}

if (isProductionHost && !hasFlag("--allow-production-host")) {
  console.error(
    [
      `Refusing to verify production host ${baseUrl.hostname} by default.`,
      "Before DNS cutover, verify a Cloudflare Workers preview URL or non-production subdomain instead.",
      "After DNS cutover, rerun with:",
      "  npm run cf:verify-url -- --base https://chihougikai.com --allow-production-host",
    ].join("\n")
  );
  process.exit(1);
}

const normalizedBase = baseUrl.toString().replace(/\/+$/, "");
console.log(`Verifying Cloudflare URL: ${normalizedBase}`);

const result = spawnSync(
  "node",
  ["scripts/smoke-cloudflare.mjs", "--base", normalizedBase],
  {
    cwd: siteRoot,
    encoding: "utf8",
    stdio: "inherit",
  }
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const preflight = checkPreflightStamp();
const stamp = {
  verified_at: new Date().toISOString(),
  base_url: normalizedBase,
  hostname: baseUrl.hostname,
  mode: isProductionHost ? "production" : "preview",
  expected_robots: isProductionHost ? "indexable" : "noindex",
  preflight_status: preflight.ok ? "ready" : "not_ready",
  preflight_reason: preflight.ok ? null : preflight.reason,
  preflight_created_at: preflight.stamp?.created_at ?? null,
  preflight_fingerprint: preflight.stamp?.fingerprint ?? null,
  preflight_artifact_fingerprint: preflight.stamp?.artifact_fingerprint ?? null,
};

fs.mkdirSync(path.dirname(URL_VERIFICATION_PATH), { recursive: true });
fs.writeFileSync(URL_VERIFICATION_PATH, `${JSON.stringify(stamp, null, 2)}\n`);

console.log("");
console.log("Cloudflare URL verification passed.");
console.log(`Verification stamp written: ${path.relative(siteRoot, URL_VERIFICATION_PATH)}`);
if (isLocalHttp) {
  console.log("Local preview verification recorded. This does not unlock cf:deploy.");
} else if (!preflight.ok) {
  console.log("The URL smoke test passed, but the preflight stamp is not ready.");
  console.log("Run npm run cf:preflight, then verify the Cloudflare URL again before cf:deploy.");
} else if (isProductionHost) {
  console.log("Production host verification recorded. Keep Vercel rollback available until monitoring is stable.");
} else {
  console.log("Deploy URL gate is ready for this preflight.");
  console.log("Next local commands:");
  console.log("  npm run cf:release-status");
  console.log("  CLOUDFLARE_RELEASE_CONFIRM=deploy npm run cf:deploy");
}
