import {
  checkUrlVerificationStamp,
  checkPreflightStamp,
  PREFLIGHT_STAMP_PATH,
  PREFLIGHT_STAMP_TTL_MS,
  URL_VERIFICATION_PATH,
} from "./cloudflare-preflight-stamp.mjs";
import { checkCloudflareAuth, cloudflareAuthHelpLines } from "./cloudflare-auth.mjs";

const action = process.argv[2];
const allowedActions = new Set(["upload", "deploy", "staging"]);
const actionDetails = {
  upload: {
    description: "uploads a new Worker version for preview/validation, without promoting it to live traffic by itself",
    confirmation: "CLOUDFLARE_RELEASE_CONFIRM=upload npm run cf:upload",
  },
  staging: {
    description: "deploys the verified artifacts to the separate workers.dev staging Worker, without changing chihougikai.com traffic",
    confirmation: "CLOUDFLARE_RELEASE_CONFIRM=staging npm run cf:deploy-staging",
  },
  deploy: {
    description: "deploys the verified Worker version to Cloudflare live traffic/routes",
    confirmation: "CLOUDFLARE_RELEASE_CONFIRM=deploy npm run cf:deploy",
  },
};

if (!allowedActions.has(action)) {
  console.error("Usage: node scripts/confirm-cloudflare-release.mjs <upload|staging|deploy>");
  process.exit(1);
}

const expected = action;
const actual = process.env.CLOUDFLARE_RELEASE_CONFIRM;
const detail = actionDetails[action];

if (actual === expected) {
  const preflight = checkPreflightStamp();
  if (preflight.ok) {
    if (action === "deploy") {
      const urlVerification = checkUrlVerificationStamp(preflight, { allowLocal: false });
      if (!urlVerification.ok) {
        const reasonText = {
          artifact_mismatch: "the verified URL belongs to different built artifacts",
          fingerprint_mismatch: "the verified URL belongs to different site files",
          local_only: "only a local preview URL has been verified",
          missing: "no verified Cloudflare URL stamp exists",
          not_ready: "the verified URL stamp is not linked to a ready preflight",
          preflight_not_ready: "the preflight stamp is not ready",
        }[urlVerification.reason] ?? urlVerification.reason;

        console.error(
          [
            `Cloudflare deploy is blocked because ${reasonText}.`,
            `Action: ${detail.description}.`,
            "",
            `Required URL verification stamp: ${URL_VERIFICATION_PATH}`,
            "",
            "Run this after cf:upload succeeds:",
            "  npm run cf:verify-url -- --base https://<preview-or-subdomain>",
            "",
            "Then rerun the deploy command.",
          ].join("\n")
        );
        process.exit(1);
      }
    }

    const auth = checkCloudflareAuth();
    if (auth.ok) {
      process.exit(0);
    }

    console.error(
      [
        `Cloudflare ${action} is blocked because Wrangler is not authenticated.`,
        `Action: ${detail.description}.`,
        "",
        ...cloudflareAuthHelpLines(),
      ].join("\n")
    );
    process.exit(1);
  }

  const ttlHours = Math.round(PREFLIGHT_STAMP_TTL_MS / 60 / 60 / 1000);
  const reasonText = {
    artifact_mismatch: "the built Cloudflare artifacts changed after the last preflight",
    expired: "the last preflight is too old",
    fingerprint_mismatch: "site files changed after the last preflight",
    invalid_timestamp: "the preflight stamp timestamp is invalid",
    missing: "no preflight stamp exists",
  }[preflight.reason] ?? preflight.reason;

  console.error(
    [
      `Cloudflare ${action} is blocked because ${reasonText}.`,
      `Action: ${detail.description}.`,
      "",
      `Required stamp: ${PREFLIGHT_STAMP_PATH}`,
      `Max age: ${ttlHours} hours`,
      "",
      "Run this first:",
      "  npm run cf:preflight",
      "",
      "Then rerun the release command.",
    ].join("\n")
  );
  process.exit(1);
}

console.error(
  [
    `Cloudflare ${action} is an external release operation and is blocked by default.`,
    `Action: ${detail.description}.`,
    "",
    "Run local verification first:",
    "  npm run cf:preflight",
    "",
    `If you intentionally want to continue, rerun with:`,
    `  ${detail.confirmation}`,
  ].join("\n")
);
process.exit(1);
