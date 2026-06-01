import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PREFLIGHT_STAMP_PATH,
  URL_VERIFICATION_PATH,
  writePreflightStamp,
} from "./cloudflare-preflight-stamp.mjs";

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseUrl = process.env.CLOUDFLARE_SMOKE_BASE_URL ?? "http://localhost:8787";
const shouldDryRun = process.argv.includes("--dry-run");

function commandForNpm() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function commandForNpx() {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: siteRoot,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed: ${signal ?? code}`));
    });
  });
}

function startPreview() {
  const chunks = [];
  const child = spawn(commandForNpx(), ["opennextjs-cloudflare", "preview"], {
    cwd: siteRoot,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });

  const pipe = (stream) => {
    stream.on("data", (chunk) => {
      const text = chunk.toString();
      chunks.push(text);
      process.stdout.write(chunk);
    });
  };

  pipe(child.stdout);
  pipe(child.stderr);

  return {
    child,
    getLog: () => chunks.join(""),
  };
}

async function stopPreview(preview) {
  const child = preview?.child;
  if (!child || child.killed) return;

  const pid = child.pid;
  if (!pid) return;

  try {
    if (process.platform === "win32") {
      child.kill("SIGTERM");
    } else {
      process.kill(-pid, "SIGTERM");
    }
  } catch {
    // The preview process may have already exited.
  }

  await new Promise((resolve) => setTimeout(resolve, 1200));

  if (!child.killed && child.exitCode == null) {
    try {
      if (process.platform === "win32") {
        child.kill("SIGKILL");
      } else {
        process.kill(-pid, "SIGKILL");
      }
    } catch {
      // Already gone.
    }
  }
}

function assertNoReadOnlyCacheWrites(log) {
  const blockedWrites = [
    "StaticAssetsIncrementalCache: Failed to set to read-only cache",
    "StaticAssetsIncrementalCache: Failed to delete from read-only cache",
  ];
  for (const marker of blockedWrites) {
    if (log.includes(marker)) {
      throw new Error(`Cloudflare preview attempted to write to the read-only incremental cache: ${marker}`);
    }
  }
}

function linkUrlVerificationToPreflight(stamp) {
  let verification;
  try {
    verification = JSON.parse(fs.readFileSync(URL_VERIFICATION_PATH, "utf8"));
  } catch {
    return;
  }

  const normalizedBase = baseUrl.replace(/\/+$/, "");
  if (verification.base_url !== normalizedBase) {
    return;
  }

  const nextVerification = {
    ...verification,
    preflight_status: "ready",
    preflight_reason: null,
    preflight_created_at: stamp.created_at,
    preflight_fingerprint: stamp.fingerprint,
    preflight_artifact_fingerprint: stamp.artifact_fingerprint,
    preflight_linked_at: new Date().toISOString(),
  };

  fs.writeFileSync(
    URL_VERIFICATION_PATH,
    `${JSON.stringify(nextVerification, null, 2)}\n`
  );
}

async function waitForPreview() {
  const deadline = Date.now() + 60_000;
  let lastError = "";

  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl, { redirect: "manual" });
      if (response.status < 500) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`Cloudflare preview did not become ready at ${baseUrl}: ${lastError}`);
}

async function main() {
  let preview;
  let verified = false;
  try {
    await run(commandForNpm(), ["run", "lint"]);
    await run(commandForNpm(), ["run", "cf:build"]);

    preview = startPreview();
    await waitForPreview();

    await run(commandForNpm(), ["run", "cf:verify-url", "--", "--base", baseUrl]);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assertNoReadOnlyCacheWrites(preview.getLog());
    console.log("Cloudflare local verification passed.");
    verified = true;
  } finally {
    await stopPreview(preview);
  }

  if (verified && shouldDryRun) {
    await run(commandForNpx(), ["opennextjs-cloudflare", "populateCache", "local"]);
    await run(commandForNpm(), ["run", "cf:check"]);
    await run(commandForNpx(), ["wrangler", "deploy", "--dry-run"]);
    const stamp = writePreflightStamp({ base_url: baseUrl });
    linkUrlVerificationToPreflight(stamp);
    console.log(
      `Cloudflare preflight stamp written: ${path.relative(siteRoot, PREFLIGHT_STAMP_PATH)} (${stamp.file_count} files)`
    );
    console.log("Cloudflare preflight passed.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
