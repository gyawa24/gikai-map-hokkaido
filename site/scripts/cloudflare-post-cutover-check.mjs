import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: siteRoot,
    encoding: "utf8",
    stdio: options.allowFailure ? "pipe" : "inherit",
  });

  if (result.status !== 0 && !options.allowFailure) {
    process.exit(result.status ?? 1);
  }

  return result;
}

function printCaptured(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWithRetry(command, args, { attempts = 2, retryDelayMs = 10000 } = {}) {
  let lastStatus = 1;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = run(command, args, { allowFailure: true });
    printCaptured(result);
    if (result.status === 0) return;

    lastStatus = result.status ?? 1;
    if (attempt < attempts) {
      console.log("");
      console.log(
        `Production host check failed on attempt ${attempt}. Retrying once after ${retryDelayMs / 1000}s...`
      );
      await wait(retryDelayMs);
    }
  }

  process.exit(lastStatus);
}

console.log("Checking Cloudflare production host...");
await runWithRetry("node", [
  "scripts/verify-cloudflare-url.mjs",
  "--base",
  "https://chihougikai.com",
  "--allow-production-host",
]);

console.log("");
console.log("Checking Cloudflare DNS status...");
run("node", ["scripts/cloudflare-dns-status.mjs"]);

console.log("");
console.log("Checking local release gate as a non-blocking reference...");
const releaseStatus = run("node", ["scripts/cloudflare-release-status.mjs"], {
  allowFailure: true,
});

if (releaseStatus.stdout) process.stdout.write(releaseStatus.stdout);
if (releaseStatus.stderr) process.stderr.write(releaseStatus.stderr);
if (releaseStatus.status !== 0) {
  console.log("");
  console.log(
    "Local release gate is not ready. This does not fail the post-cutover check when the public Cloudflare host and DNS checks passed."
  );
}

console.log("");
console.log("Cloudflare post-cutover check passed.");
