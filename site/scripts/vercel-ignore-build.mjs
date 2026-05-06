#!/usr/bin/env node

const env = process.env.VERCEL_ENV ?? "";
const branch = process.env.VERCEL_GIT_COMMIT_REF ?? "";
const message = process.env.VERCEL_GIT_COMMIT_MESSAGE ?? "";
const force = process.env.FORCE_VERCEL_BUILD === "1";
const explicitDeploy = /\[(deploy|vercel)\]/i.test(message);

function build(reason) {
  console.log(`Vercel build: run (${reason})`);
  process.exit(1);
}

function skip(reason) {
  console.log(`Vercel build: skip (${reason})`);
  process.exit(0);
}

if (force) build("FORCE_VERCEL_BUILD=1");
if (env === "production") build("production deployment");
if (explicitDeploy) build("commit message requested deployment");

skip(`preview deployment on ${branch || "unknown branch"}`);
