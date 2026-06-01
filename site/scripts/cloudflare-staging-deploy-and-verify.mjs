import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const productionHosts = new Set(["chihougikai.com", "www.chihougikai.com"]);

function binPath(name) {
  return path.join(siteRoot, "node_modules", ".bin", process.platform === "win32" ? `${name}.cmd` : name);
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function getArgValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: siteRoot,
    encoding: "utf8",
    env: options.env ?? process.env,
  });

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  return output;
}

function normalizeUrl(value) {
  try {
    return new URL(value.replace(/[),.;]+$/g, "")).toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function pickVerificationUrl(output) {
  const matches = output.match(/https:\/\/[^\s"'<>]+/g) ?? [];
  const urls = [...new Set(matches.map(normalizeUrl).filter(Boolean))];

  return (
    urls.find((url) => {
      const { hostname } = new URL(url);
      return hostname.endsWith(".workers.dev");
    }) ??
    urls.find((url) => {
      const { hostname } = new URL(url);
      return !productionHosts.has(hostname.toLowerCase());
    }) ??
    null
  );
}

function assertExternalStagingUrl(value) {
  if (!value) return;

  let url;
  try {
    url = new URL(value);
  } catch {
    console.error(`Invalid staging verification URL: ${value}`);
    process.exit(1);
  }

  if (url.protocol !== "https:") {
    console.error("cf:deploy-staging requires an https:// URL.");
    process.exit(1);
  }

  if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    console.error("cf:deploy-staging cannot verify a local URL.");
    process.exit(1);
  }

  if (productionHosts.has(url.hostname.toLowerCase())) {
    console.error(`cf:deploy-staging refuses production host ${url.hostname}.`);
    process.exit(1);
  }
}

function usage() {
  console.error(
    [
      "Usage:",
      "  CLOUDFLARE_RELEASE_CONFIRM=staging npm run cf:deploy-staging",
      "  CLOUDFLARE_RELEASE_CONFIRM=staging npm run cf:deploy-staging -- --base https://<staging-worker>.workers.dev",
      "",
      "This deploys preflight-verified artifacts to a separate workers.dev staging Worker,",
      "verifies the staging URL, then prints or appends the release log entry.",
    ].join("\n")
  );
}

if (hasFlag("--help")) {
  usage();
  process.exit(0);
}

if (process.env.CLOUDFLARE_RELEASE_CONFIRM !== "staging") {
  console.error(
    [
      "Cloudflare staging deploy is an external operation and is blocked by default.",
      "It deploys the current build to a separate workers.dev Worker, not to chihougikai.com.",
      "",
      "Run local verification first:",
      "  npm run cf:preflight",
      "",
      "If you intentionally want to continue, rerun with:",
      "  CLOUDFLARE_RELEASE_CONFIRM=staging npm run cf:deploy-staging",
    ].join("\n")
  );
  process.exit(1);
}

const stagingConfig = getArgValue("--config") ?? "wrangler.staging.jsonc";
const explicitBase = getArgValue("--base") ?? process.env.CLOUDFLARE_STAGING_BASE_URL;
const appendLog = hasFlag("--append-log");
assertExternalStagingUrl(explicitBase);

if (!fs.existsSync(path.join(siteRoot, stagingConfig))) {
  console.error(`Staging Wrangler config was not found: ${stagingConfig}`);
  process.exit(1);
}

run("node", ["scripts/confirm-cloudflare-release.mjs", "staging"]);

const deployOutput = run(binPath("opennextjs-cloudflare"), ["deploy", "--config", stagingConfig]);
const verificationUrl = explicitBase ?? pickVerificationUrl(deployOutput);

if (!verificationUrl) {
  console.error(
    [
      "",
      "Cloudflare staging deploy completed, but no workers.dev URL could be detected from the output.",
      "Verify the URL manually after copying it from Cloudflare:",
      "  npm run cf:verify-url -- --base https://<staging-worker>.workers.dev",
    ].join("\n")
  );
  process.exit(1);
}

run("node", ["scripts/verify-cloudflare-url.mjs", "--base", verificationUrl]);

const logArgs = ["scripts/cloudflare-release-log-entry.mjs"];
if (appendLog) logArgs.push("--append");
run("node", logArgs);

run("node", ["scripts/cloudflare-release-status.mjs"]);
