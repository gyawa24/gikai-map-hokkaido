#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const ROOT_DATA_DIR = path.join(REPO_ROOT, "data");
const SITE_DATA_DIR = path.join(REPO_ROOT, "site", "data");

const CAPABILITY_DEFINITIONS = {
  members: ["members.json"],
  minutes: ["minutes/index.json", "index.json"],
  sessions: ["sessions/index.json"],
  themes: ["members_activity.json"],
  budgets: ["budgets/index.json"],
  decisions: ["decisions.json"],
  schedule: ["schedule.json"],
  newsletter: ["newsletter.json"],
  election: ["election.json"],
  plan: ["comprehensive_plan.json"],
  segments: ["segments/_index.json"],
};

const PUBLIC_SYNC_ENTRIES = [
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
];

const SITE_GENERATED = new Set([
  "_city-capabilities.json",
  "_search-index.json",
]);
const SITE_GLOBAL = new Set([
  "budget_sources.json",
  "municipalities.json",
  "news.json",
]);
const ROOT_PRIVATE_PREFIXES = ["_discovery/", "chunks/", "processed/", "raw/"];
const ROOT_PRIVATE_FILES = new Set([".DS_Store"]);

function parseArgs(argv) {
  const options = {
    json: false,
    strict: false,
  };
  for (const arg of argv) {
    if (arg === "--json") options.json = true;
    else if (arg === "--strict") options.strict = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function printHelp() {
  console.log(`Usage:
  node scripts/data-health.mjs [options]

Options:
  --json      Print machine-readable JSON
  --strict    Exit non-zero when warnings exist
  --help

Checks:
  - data/municipalities.json and site/data/municipalities.json are synced
  - retired municipalities.features has not returned
  - site/data/_city-capabilities.json matches site/data files
  - known public data in data/{slug}/ is copied to site/data/{slug}/
  - site-only overlays are classified instead of hidden
`);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function statOrNull(targetPath) {
  try {
    return await fs.stat(targetPath);
  } catch {
    return null;
  }
}

function readIgnoredFiles() {
  const result = spawnSync("git", ["ls-files", "--others", "--ignored", "--exclude-standard", "-z", "data", "site/data"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0 || !result.stdout) return new Set();
  return new Set(result.stdout.split("\0").filter(Boolean));
}

function isIgnoredFile(targetPath, ignoredFiles) {
  return ignoredFiles.has(path.relative(REPO_ROOT, targetPath));
}

function rel(targetPath) {
  return path.relative(REPO_ROOT, targetPath);
}

async function walkFiles(baseDir, ignoredFiles) {
  const out = [];
  async function walk(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const filePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(filePath);
      } else if (entry.isFile()) {
        if (isIgnoredFile(filePath, ignoredFiles)) continue;
        out.push(path.relative(baseDir, filePath));
      }
    }
  }
  await walk(baseDir);
  return out.sort();
}

async function readMunicipalities() {
  const root = await readJson(path.join(ROOT_DATA_DIR, "municipalities.json"));
  const site = await readJson(path.join(SITE_DATA_DIR, "municipalities.json"));
  return { root, site };
}

function hasRetiredFeatures(rows) {
  return rows.filter((row) => Object.prototype.hasOwnProperty.call(row, "features")).map((row) => row.slug);
}

async function hasAnyPath(baseDir, slug, relativePaths, ignoredFiles) {
  for (const relativePath of relativePaths) {
    const targetPath = path.join(baseDir, slug, relativePath);
    if (isIgnoredFile(targetPath, ignoredFiles)) continue;
    if (await pathExists(targetPath)) return true;
  }
  return false;
}

async function checkMetadata(report) {
  const { root, site } = await readMunicipalities();
  report.counts.municipalities = root.length;
  if (JSON.stringify(root) !== JSON.stringify(site)) {
    report.errors.push("data/municipalities.json and site/data/municipalities.json differ");
  }

  const rootFeatures = hasRetiredFeatures(root);
  const siteFeatures = hasRetiredFeatures(site);
  if (rootFeatures.length) {
    report.errors.push(`retired features field found in data/municipalities.json: ${rootFeatures.slice(0, 10).join(", ")}`);
  }
  if (siteFeatures.length) {
    report.errors.push(`retired features field found in site/data/municipalities.json: ${siteFeatures.slice(0, 10).join(", ")}`);
  }

  return root;
}

async function checkCapabilities(report, municipalities, ignoredFiles) {
  const capabilityPath = path.join(SITE_DATA_DIR, "_city-capabilities.json");
  if (!(await pathExists(capabilityPath))) {
    report.errors.push("missing site/data/_city-capabilities.json");
    return;
  }

  const index = await readJson(capabilityPath);
  report.counts.cityCapabilityVersion = index.version ?? null;
  if (index.version !== 2) {
    report.warnings.push(`city capabilities version is ${index.version ?? "missing"}; expected 2`);
  }

  for (const municipality of municipalities) {
    const city = index.cities?.[municipality.slug];
    if (!city) {
      report.errors.push(`missing capability entry: ${municipality.slug}`);
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(city, "features")) {
      report.errors.push(`retired features field found in capability entry: ${municipality.slug}`);
    }

    for (const [key, relativePaths] of Object.entries(CAPABILITY_DEFINITIONS)) {
      const expected = await hasAnyPath(SITE_DATA_DIR, municipality.slug, relativePaths, ignoredFiles);
      const actual = Boolean(city.capabilities?.[key]);
      if (actual !== expected) {
        report.errors.push(`capability mismatch ${municipality.slug}.${key}: ${actual} vs file=${expected}`);
      }
    }
  }
}

async function checkPublicSync(report, municipalities, ignoredFiles) {
  for (const municipality of municipalities) {
    const rootDir = path.join(ROOT_DATA_DIR, municipality.slug);
    const siteDir = path.join(SITE_DATA_DIR, municipality.slug);
    if (!(await pathExists(rootDir))) {
      report.warnings.push(`missing data directory: data/${municipality.slug}/`);
      continue;
    }
    if (!(await pathExists(siteDir))) {
      report.errors.push(`missing site data directory: site/data/${municipality.slug}/`);
      continue;
    }

    for (const entry of PUBLIC_SYNC_ENTRIES) {
      const rootPath = path.join(rootDir, entry);
      const rootStat = await statOrNull(rootPath);
      if (!rootStat) continue;
      if (rootStat.isFile() && isIgnoredFile(rootPath, ignoredFiles)) continue;
      const sitePath = path.join(siteDir, entry);
      const siteStat = await statOrNull(sitePath);
      if (!siteStat) {
        report.warnings.push(`not synced: data/${municipality.slug}/${entry} -> site/data/${municipality.slug}/${entry}`);
        continue;
      }
      if (rootStat.isFile() && siteStat.isFile() && rootStat.size !== siteStat.size) {
        report.warnings.push(`size differs: data/${municipality.slug}/${entry} -> site/data/${municipality.slug}/${entry}`);
      }
    }
  }
}

function classifySiteOnly(file) {
  if (SITE_GENERATED.has(file)) return "generated";
  if (SITE_GLOBAL.has(file)) return "global";
  if (/^[^/]+\/budgets\//.test(file) || /^[^/]+\/budgets\/index\.json$/.test(file)) return "budget_overlay";
  if (/^[^/]+\/(?:index|\d+)\.json$/.test(file)) return "legacy_flat_minutes";
  if (/^[^/]+\/(?:decisions|schedule|newsletter)\.json$/.test(file)) return "public_overlay";
  return "unclassified_site_only";
}

function classifyRootOnly(file) {
  if (ROOT_PRIVATE_FILES.has(file)) return "private";
  if (ROOT_PRIVATE_PREFIXES.some((prefix) => file.startsWith(prefix))) return "private";
  if (/^[^/]+\/ocr_drafts\//.test(file)) return "private";
  if (/^[^/]+\/segments\//.test(file)) return "local_segments";
  if (/\.pdf$/i.test(file)) return "source_documents";
  return "root_only_public_candidate";
}

async function checkSiteOnly(report, ignoredFiles) {
  const rootFiles = new Set(await walkFiles(ROOT_DATA_DIR, ignoredFiles));
  const siteFiles = new Set(await walkFiles(SITE_DATA_DIR, ignoredFiles));

  for (const file of siteFiles) {
    if (rootFiles.has(file)) continue;
    const category = classifySiteOnly(file);
    report.siteOnly[category] ??= [];
    report.siteOnly[category].push(file);
  }

  for (const file of rootFiles) {
    if (siteFiles.has(file)) continue;
    const category = classifyRootOnly(file);
    report.rootOnly[category] ??= [];
    report.rootOnly[category].push(file);
  }

  for (const [category, files] of Object.entries(report.siteOnly)) {
    if (category === "unclassified_site_only" && files.length) {
      report.warnings.push(`unclassified site-only files: ${files.length}`);
    }
  }
  for (const [category, files] of Object.entries(report.rootOnly)) {
    if (category === "root_only_public_candidate" && files.length) {
      report.warnings.push(`root-only public candidates: ${files.length}`);
    }
  }
}

function summarizeBuckets(buckets) {
  return Object.fromEntries(
    Object.entries(buckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, files]) => [key, { count: files.length, samples: files.slice(0, 8) }])
  );
}

function printText(report) {
  console.log("# data health");
  console.log(`municipalities: ${report.counts.municipalities}`);
  console.log(`city capability version: ${report.counts.cityCapabilityVersion}`);
  console.log(`errors: ${report.errors.length}`);
  console.log(`warnings: ${report.warnings.length}`);

  if (report.errors.length) {
    console.log("\n## errors");
    for (const error of report.errors.slice(0, 40)) console.log(`- ${error}`);
  }

  if (report.warnings.length) {
    console.log("\n## warnings");
    for (const warning of report.warnings.slice(0, 40)) console.log(`- ${warning}`);
  }

  console.log("\n## site-only files");
  for (const [category, info] of Object.entries(summarizeBuckets(report.siteOnly))) {
    console.log(`- ${category}: ${info.count}`);
    for (const sample of info.samples) console.log(`  - ${sample}`);
  }

  console.log("\n## root-only files");
  for (const [category, info] of Object.entries(summarizeBuckets(report.rootOnly))) {
    console.log(`- ${category}: ${info.count}`);
    for (const sample of info.samples) console.log(`  - ${sample}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const report = {
    counts: {
      municipalities: 0,
      cityCapabilityVersion: null,
    },
    errors: [],
    warnings: [],
    siteOnly: {},
    rootOnly: {},
  };

  const ignoredFiles = readIgnoredFiles();
  const municipalities = await checkMetadata(report);
  await checkCapabilities(report, municipalities, ignoredFiles);
  await checkPublicSync(report, municipalities, ignoredFiles);
  await checkSiteOnly(report, ignoredFiles);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printText(report);
  }

  if (report.errors.length || (options.strict && report.warnings.length)) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
