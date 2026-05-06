#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

const DEFAULT_WARN_MIB = 900;
const DEFAULT_MAX_MIB = 1000;

function parseArgs(argv) {
  const options = {
    strict: false,
    warnMib: DEFAULT_WARN_MIB,
    maxMib: DEFAULT_MAX_MIB,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--strict") {
      options.strict = true;
      continue;
    }
    if (arg === "--warn-mib" || arg === "--max-mib") {
      const value = Number(argv[i + 1]);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`Invalid ${arg}: ${argv[i + 1]}`);
      }
      if (arg === "--warn-mib") options.warnMib = value;
      if (arg === "--max-mib") options.maxMib = value;
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function dirSize(targetPath) {
  if (!(await exists(targetPath))) return 0;
  const entries = await fs.readdir(targetPath, { withFileTypes: true });
  let total = 0;

  for (const entry of entries) {
    const childPath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      total += await dirSize(childPath);
      continue;
    }
    if (entry.isFile()) {
      const stat = await fs.stat(childPath);
      total += stat.size;
    }
  }

  return total;
}

function formatMib(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const targets = [
    ["site/data", path.join(REPO_ROOT, "site", "data")],
    ["site/.next", path.join(REPO_ROOT, "site", ".next")],
  ];

  let failed = false;
  for (const [label, targetPath] of targets) {
    const bytes = await dirSize(targetPath);
    const mib = bytes / 1024 / 1024;
    const status = mib >= options.maxMib ? "over" : mib >= options.warnMib ? "warn" : "ok";
    console.log(`${status.padEnd(4)} ${label.padEnd(10)} ${formatMib(bytes)}`);
    if (options.strict && mib >= options.maxMib) failed = true;
  }

  if (failed) {
    console.error(`deployment footprint exceeds ${options.maxMib} MiB`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
