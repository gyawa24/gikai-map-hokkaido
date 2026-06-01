import {
  checkUrlVerificationStamp,
  checkPreflightStamp,
  PREFLIGHT_STAMP_PATH,
  PREFLIGHT_STAMP_TTL_MS,
  readPreflightStamp,
  URL_VERIFICATION_PATH,
} from "./cloudflare-preflight-stamp.mjs";
import { checkCloudflareAuth, cloudflareAuthHelpLines } from "./cloudflare-auth.mjs";

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function reasonText(reason) {
  return {
    artifact_mismatch: "built Cloudflare artifacts changed after the last preflight",
    expired: "the last preflight is too old",
    fingerprint_mismatch: "site files changed after the last preflight",
    invalid_timestamp: "the preflight stamp timestamp is invalid",
    missing: "no preflight stamp exists",
  }[reason] ?? reason;
}

function urlVerificationReasonText(reason) {
  return {
    artifact_mismatch: "verified URL belongs to different built artifacts",
    fingerprint_mismatch: "verified URL belongs to different site files",
    local_only: "only local preview URL has been verified",
    missing: "no verified Cloudflare URL stamp exists",
    not_ready: "verified URL stamp is not linked to a ready preflight",
    preflight_not_ready: "preflight stamp is not ready",
  }[reason] ?? reason;
}

function isProductionVerification(verification) {
  return verification?.mode === "production";
}

try {
  const status = checkPreflightStamp();
  const stamp = readPreflightStamp();

  console.log("Cloudflare release status");
  console.log(`- stamp: ${PREFLIGHT_STAMP_PATH}`);

  if (status.ok) {
    const remainingMs = Math.max(0, PREFLIGHT_STAMP_TTL_MS - status.ageMs);
    const auth = checkCloudflareAuth();
    const deployUrlVerification = checkUrlVerificationStamp(status, { allowLocal: false });
    const anyUrlVerification = checkUrlVerificationStamp(status, { allowLocal: true });
    console.log("- local artifacts: ready for cf:upload / cf:upload-verify gate");
    console.log(`- preflight age: ${formatDuration(status.ageMs)}`);
    console.log(`- expires in: ${formatDuration(remainingMs)}`);
    console.log(`- source files: ${status.current.file_count}`);
    console.log(`- artifact files: ${status.artifacts.artifact_file_count}`);
    if (deployUrlVerification.ok) {
      console.log(`- deploy URL gate: ready (${deployUrlVerification.verification.base_url})`);
      if (isProductionVerification(deployUrlVerification.verification)) {
        console.log("- production host: verified");
      }
    } else {
      console.log(
        `- deploy URL gate: not ready (${urlVerificationReasonText(deployUrlVerification.reason)})`
      );
      if (anyUrlVerification.ok) {
        console.log(`- last verified URL: ${anyUrlVerification.verification.base_url}`);
      }
      console.log(`- URL verification stamp: ${URL_VERIFICATION_PATH}`);
    }

    if (!auth.ok) {
      console.log("- cloudflare auth: not authenticated");
      if (auth.output) {
        console.log(`- wrangler: ${auth.output.split("\n").at(-1)}`);
      }
      console.log("");
      console.log("Run:");
      for (const line of cloudflareAuthHelpLines()) {
        console.log(line);
      }
      process.exit(1);
    }

    console.log(`- cloudflare auth: ok (${auth.method})`);
    console.log("");
    if (deployUrlVerification.ok && isProductionVerification(deployUrlVerification.verification)) {
      console.log("Next local commands:");
      console.log("  npm run cf:dns-status");
      console.log("  npm run cf:finalize-production");
    } else {
      console.log("Next local command:");
      console.log(
        deployUrlVerification.ok
          ? "  CLOUDFLARE_RELEASE_CONFIRM=deploy npm run cf:deploy"
          : "  CLOUDFLARE_RELEASE_CONFIRM=upload-and-verify npm run cf:upload-verify"
      );
    }
    if (!deployUrlVerification.ok) {
      console.log("");
      console.log("If the preview URL cannot be detected automatically, pass it explicitly:");
      console.log(
        "  CLOUDFLARE_RELEASE_CONFIRM=upload-and-verify npm run cf:upload-verify -- --base https://<preview-or-subdomain>"
      );
      console.log("");
      console.log("Manual split commands:");
      console.log("  CLOUDFLARE_RELEASE_CONFIRM=upload npm run cf:upload");
      console.log("  npm run cf:verify-url -- --base https://<preview-or-subdomain>");
    }
    process.exit(0);
  }

  console.log("- status: not ready");
  console.log(`- reason: ${reasonText(status.reason)}`);
  if (stamp?.created_at) {
    console.log(`- last preflight: ${stamp.created_at}`);
  }
  console.log("");
  console.log("Run:");
  console.log("  npm run cf:preflight");
  process.exit(1);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
