#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { printBudgetSourceReminders } from "./lib/budget-source-reminders.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const ROOT_DATA_DIR = path.join(REPO_ROOT, "data");
const SITE_DATA_DIR = path.join(REPO_ROOT, "site", "data");
const ROOT_MUNICIPALITIES_PATH = path.join(ROOT_DATA_DIR, "municipalities.json");
const SITE_MUNICIPALITIES_PATH = path.join(SITE_DATA_DIR, "municipalities.json");

const SYNC_ENTRIES = [
  "members.json",
  "members_activity.json",
  "minutes",
  "index.json",
  "sessions",
  "decisions.json",
  "schedule.json",
  "newsletter.json",
  "election.json",
  "comprehensive_plan.json",
  "plan_activity.json",
  "vocabulary.json",
  "budgets",
  "publications",
];

function printHelp() {
  console.log(`Usage:
  node scripts/sync-site-data.mjs --slug <slug> [options]
  node scripts/sync-site-data.mjs --all-active [options]
  node scripts/sync-site-data.mjs --all-with-data [options]

Options:
  --build-capabilities   Regenerate site/data/_city-capabilities.json after sync
  --include-segments      Also copy data/{slug}/segments for local-only workflows
  --verify               Run verify-municipality for synced slugs
  --dry-run              Print actions without writing files
  --help

Notes:
  - data/ is the collection source.
  - site/data/ is the public build copy.
  - This script copies known public data entries and does not delete site-only overlays.
  - segments are not copied by default because they are large local research data.
`);
}

function parseArgs(argv) {
  const options = {
    slugs: [],
    allActive: false,
    allWithData: false,
    buildCapabilities: false,
    verify: false,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--slug") {
      const value = argv[++i];
      if (!value) throw new Error("--slug requires a value");
      options.slugs.push(value);
    } else if (arg === "--all-active") {
      options.allActive = true;
    } else if (arg === "--all-with-data") {
      options.allWithData = true;
    } else if (arg === "--build-capabilities") {
      options.buildCapabilities = true;
    } else if (arg === "--include-segments") {
      options.includeSegments = true;
    } else if (arg === "--verify") {
      options.verify = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function rel(targetPath) {
  return path.relative(REPO_ROOT, targetPath);
}

async function copyPath(sourcePath, destPath, dryRun) {
  if (!(await pathExists(sourcePath))) return false;
  if (dryRun) {
    console.log(`[dry-run] copy ${rel(sourcePath)} -> ${rel(destPath)}`);
    return true;
  }
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await fs.cp(sourcePath, destPath, { recursive: true, force: true });
  console.log(`copied ${rel(sourcePath)} -> ${rel(destPath)}`);
  return true;
}

async function syncMunicipalities(dryRun) {
  await copyPath(ROOT_MUNICIPALITIES_PATH, SITE_MUNICIPALITIES_PATH, dryRun);
}

async function syncSlug(slug, dryRun) {
  const sourceDir = path.join(ROOT_DATA_DIR, slug);
  const destDir = path.join(SITE_DATA_DIR, slug);
  if (!(await pathExists(sourceDir))) {
    console.log(`skip ${slug}: data/${slug}/ not found`);
    return false;
  }

  if (dryRun) {
    console.log(`[dry-run] mkdir -p ${rel(destDir)}`);
  } else {
    await fs.mkdir(destDir, { recursive: true });
  }

  let copied = 0;
  const entries = optionsForSync.includeSegments ? [...SYNC_ENTRIES, "segments"] : SYNC_ENTRIES;
  for (const entry of entries) {
    const didCopy = await copyPath(path.join(sourceDir, entry), path.join(destDir, entry), dryRun);
    if (didCopy) copied += 1;
  }
  console.log(`synced ${slug}: ${copied} public entries`);
  return true;
}

const optionsForSync = {
  includeSegments: false,
};

async function runNodeScript(scriptPath, args, dryRun) {
  const command = ["node", path.relative(REPO_ROOT, scriptPath), ...args].join(" ");
  if (dryRun) {
    console.log(`[dry-run] ${command}`);
    return;
  }

  await new Promise((resolve, reject) => {
    const child = spawn("node", [scriptPath, ...args], {
      cwd: REPO_ROOT,
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed with exit code ${code}`));
    });
    child.on("error", reject);
  });
}

async function resolveSlugs(options) {
  const municipalities = await readJson(ROOT_MUNICIPALITIES_PATH);
  const slugs = new Set(options.slugs);

  if (options.allActive) {
    for (const municipality of municipalities) {
      if (municipality.active) slugs.add(municipality.slug);
    }
  }

  if (options.allWithData) {
    const entries = await fs.readdir(ROOT_DATA_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith("_")) slugs.add(entry.name);
    }
  }

  return [...slugs].sort();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const slugs = await resolveSlugs(options);
  if (!slugs.length) {
    throw new Error("Specify --slug, --all-active, or --all-with-data");
  }

  optionsForSync.includeSegments = options.includeSegments;

  await syncMunicipalities(options.dryRun);

  const syncedSlugs = [];
  for (const slug of slugs) {
    const synced = await syncSlug(slug, options.dryRun);
    if (synced) syncedSlugs.push(slug);
  }

  await printBudgetSourceReminders(REPO_ROOT, syncedSlugs, { dryRun: options.dryRun });

  if (options.buildCapabilities) {
    await runNodeScript(path.join(REPO_ROOT, "site", "scripts", "build-city-capabilities.mjs"), [], options.dryRun);
  }

  if (options.verify) {
    for (const slug of syncedSlugs) {
      await runNodeScript(path.join(REPO_ROOT, "scripts", "verify-municipality.mjs"), [slug], options.dryRun);
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
