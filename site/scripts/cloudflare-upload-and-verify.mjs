import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const productionHosts = new Set(["chihougikai.com", "www.chihougikai.com"]);

function binPath(name) {
  return path.join(siteRoot, "node_modules", ".bin", process.platform === "win32" ? `${name}.cmd` : name);
}

function getArgValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name) {
  return process.argv.includes(name);
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
      return hostname.endsWith(".workers.dev") || hostname.endsWith(".pages.dev");
    }) ??
    urls.find((url) => {
      const { hostname } = new URL(url);
      return !productionHosts.has(hostname.toLowerCase());
    }) ??
    null
  );
}

function assertExternalPreviewUrl(value) {
  if (!value) return;

  let url;
  try {
    url = new URL(value);
  } catch {
    console.error(`Invalid verification URL: ${value}`);
    process.exit(1);
  }

  if (url.protocol !== "https:") {
    console.error("cf:upload-verify requires an https:// Cloudflare URL. Use cf:verify-url directly for local HTTP checks.");
    process.exit(1);
  }

  if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    console.error("cf:upload-verify cannot verify a local URL. Use a Workers URL or verification subdomain.");
    process.exit(1);
  }

  if (productionHosts.has(url.hostname.toLowerCase())) {
    console.error(
      [
        `cf:upload-verify refuses production host ${url.hostname}.`,
        "Before DNS cutover, use a Workers URL or verification subdomain.",
        "After DNS cutover, verify production separately with:",
        "  npm run cf:verify-url -- --base https://chihougikai.com --allow-production-host",
      ].join("\n")
    );
    process.exit(1);
  }
}

function assertPreviewAlias(value) {
  if (/^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value)) return;

  console.error(
    [
      `Invalid preview alias: ${value}`,
      "Use lowercase letters, numbers, and hyphens only. Start with a letter and do not end with a hyphen.",
    ].join("\n")
  );
  process.exit(1);
}

function usage() {
  console.error(
    [
      "Usage:",
      "  CLOUDFLARE_RELEASE_CONFIRM=upload-and-verify npm run cf:upload-verify",
      "  CLOUDFLARE_RELEASE_CONFIRM=upload-and-verify npm run cf:upload-verify -- --base https://<preview-or-subdomain>",
      "  CLOUDFLARE_RELEASE_CONFIRM=upload-and-verify npm run cf:upload-verify -- --preview-alias staging",
      "",
      "This uploads a preflight-verified Cloudflare Worker version, verifies the preview URL,",
      "then prints or appends the release log entry.",
    ].join("\n")
  );
}

if (hasFlag("--help")) {
  usage();
  process.exit(0);
}

if (process.env.CLOUDFLARE_RELEASE_CONFIRM !== "upload-and-verify") {
  console.error(
    [
      "Cloudflare upload-and-verify is an external release operation and is blocked by default.",
      "It uploads a new Worker version and then runs URL verification.",
      "",
      "Run local verification first:",
      "  npm run cf:preflight",
      "",
      "If you intentionally want to continue, rerun with:",
      "  CLOUDFLARE_RELEASE_CONFIRM=upload-and-verify npm run cf:upload-verify",
    ].join("\n")
  );
  process.exit(1);
}

const explicitBase = getArgValue("--base") ?? process.env.CLOUDFLARE_VERIFY_BASE_URL;
const previewAlias = getArgValue("--preview-alias") ?? process.env.CLOUDFLARE_PREVIEW_ALIAS ?? "staging";
const appendLog = hasFlag("--append-log");
assertExternalPreviewUrl(explicitBase);
assertPreviewAlias(previewAlias);

const releaseEnv = {
  ...process.env,
  CLOUDFLARE_RELEASE_CONFIRM: "upload",
};

run("node", ["scripts/confirm-cloudflare-release.mjs", "upload"], { env: releaseEnv });

const uploadOutput = run(binPath("opennextjs-cloudflare"), ["upload", "--", "--preview-alias", previewAlias], {
  env: releaseEnv,
});
const verificationUrl = explicitBase ?? pickVerificationUrl(uploadOutput);

if (!verificationUrl) {
  console.error(
    [
      "",
      "Cloudflare upload completed, but no preview URL could be detected from the upload output.",
      `The upload was requested with preview alias: ${previewAlias}`,
      "Verify the URL manually after copying it from Cloudflare:",
      "  npm run cf:verify-url -- --base https://<preview-or-subdomain>",
      "",
      "Then record the result:",
      "  npm run cf:release-log-entry",
    ].join("\n")
  );
  process.exit(1);
}

const verifyArgs = ["scripts/verify-cloudflare-url.mjs", "--base", verificationUrl];
run("node", verifyArgs);

const logArgs = ["scripts/cloudflare-release-log-entry.mjs"];
if (appendLog) logArgs.push("--append");
run("node", logArgs);

run("node", ["scripts/cloudflare-release-status.mjs"]);
