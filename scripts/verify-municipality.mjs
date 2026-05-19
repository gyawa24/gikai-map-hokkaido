#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const ROOT_DATA_DIR = path.join(REPO_ROOT, "data");
const SITE_DATA_DIR = path.join(REPO_ROOT, "site", "data");
const ROOT_MUNICIPALITIES_PATH = path.join(ROOT_DATA_DIR, "municipalities.json");
const SITE_MUNICIPALITIES_PATH = path.join(SITE_DATA_DIR, "municipalities.json");
const CITY_CAPABILITIES_PATH = path.join(SITE_DATA_DIR, "_city-capabilities.json");

function printHelp() {
  console.log(`Usage:
  node scripts/verify-municipality.mjs <slug>

Checks:
  - municipalities.json entry exists in data/ and site/data/
  - generated city capabilities match site/data files
  - site/data/{slug}/ is synced from data/{slug}/
  - segments exist when minutes/index.json exists
  - themes data exists when expected
`);
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

async function readIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

function relative(targetPath) {
  return path.relative(REPO_ROOT, targetPath);
}

async function compareFiles(issues, rootPath, sitePath, label) {
  const [rootText, siteText] = await Promise.all([readIfExists(rootPath), readIfExists(sitePath)]);

  if (rootText == null) {
    issues.push(`missing ${label}: ${relative(rootPath)}`);
    return;
  }
  if (siteText == null) {
    issues.push(`missing synced ${label}: ${relative(sitePath)}`);
    return;
  }
  if (rootText !== siteText) {
    issues.push(`out of sync ${label}: ${relative(rootPath)} <> ${relative(sitePath)}`);
  }
}

async function main() {
  const slug = process.argv[2];
  if (!slug || slug === "--help" || slug === "-h") {
    printHelp();
    process.exit(slug ? 0 : 1);
  }

  const [rootMunicipalities, siteMunicipalities] = await Promise.all([
    readJson(ROOT_MUNICIPALITIES_PATH),
    readJson(SITE_MUNICIPALITIES_PATH),
  ]);

  const rootEntry = rootMunicipalities.find((item) => item.slug === slug);
  const siteEntry = siteMunicipalities.find((item) => item.slug === slug);
  const issues = [];
  const checks = [];

  if (!rootEntry) {
    issues.push(`missing municipality entry: data/municipalities.json -> ${slug}`);
  } else {
    checks.push(`entry found in data/municipalities.json`);
    if ("features" in rootEntry) {
      issues.push(`retired metadata field found: data/municipalities.json -> ${slug}.features`);
    }
  }

  if (!siteEntry) {
    issues.push(`missing municipality entry: site/data/municipalities.json -> ${slug}`);
  } else {
    checks.push(`entry found in site/data/municipalities.json`);
    if ("features" in siteEntry) {
      issues.push(`retired metadata field found: site/data/municipalities.json -> ${slug}.features`);
    }
  }

  if (
    rootEntry &&
    siteEntry &&
    JSON.stringify(rootEntry) !== JSON.stringify(siteEntry)
  ) {
    issues.push(`municipality metadata out of sync between data/ and site/data/: ${slug}`);
  } else if (rootEntry && siteEntry) {
    checks.push(`municipality metadata synced`);
  }

  const rootDir = path.join(ROOT_DATA_DIR, slug);
  const siteDir = path.join(SITE_DATA_DIR, slug);
  const rootDirExists = await pathExists(rootDir);
  const siteDirExists = await pathExists(siteDir);

  if (!rootDirExists) {
    issues.push(`missing directory: ${relative(rootDir)}/`);
  } else {
    checks.push(`directory exists: ${relative(rootDir)}/`);
  }
  if (!siteDirExists) {
    issues.push(`missing directory: ${relative(siteDir)}/`);
  } else {
    checks.push(`directory exists: ${relative(siteDir)}/`);
  }

  const membersRoot = path.join(rootDir, "members.json");
  const membersSite = path.join(siteDir, "members.json");
  const minutesIndexRoot = path.join(rootDir, "minutes", "index.json");
  const minutesIndexSite = path.join(siteDir, "minutes", "index.json");
  const minutesAltRoot = path.join(rootDir, "index.json");
  const minutesAltSite = path.join(siteDir, "index.json");
  const segmentsIndexRoot = path.join(rootDir, "segments", "_index.json");
  const themesRoot = path.join(rootDir, "members_activity.json");
  const themesSite = path.join(siteDir, "members_activity.json");
  const capabilityIndex = await readJson(CITY_CAPABILITIES_PATH).catch(() => null);
  const capability = capabilityIndex?.cities?.[slug] ?? null;

  const hasMembersFile = await pathExists(membersRoot);
  const hasMinutesIndex = (await pathExists(minutesIndexRoot)) || (await pathExists(minutesAltRoot));
  const hasSegmentsIndex = await pathExists(segmentsIndexRoot);
  const hasThemesFile = await pathExists(themesRoot);

  if (hasMembersFile) {
    checks.push(`members data exists`);
    await compareFiles(issues, membersRoot, membersSite, "members.json");
  }

  if (hasMinutesIndex) {
    checks.push(`minutes index exists`);
    if (await pathExists(minutesIndexRoot)) {
      await compareFiles(issues, minutesIndexRoot, minutesIndexSite, "minutes/index.json");
    } else {
      await compareFiles(issues, minutesAltRoot, minutesAltSite, "index.json");
    }
  }

  if (hasMinutesIndex) {
    if (!hasSegmentsIndex) {
      issues.push(`missing segments: data/${slug}/segments/_index.json`);
    } else {
      checks.push(`segments index exists`);
    }
  }

  if (hasThemesFile) {
    checks.push(`themes data exists`);
    await compareFiles(issues, themesRoot, themesSite, "members_activity.json");
  }

  if (rootEntry?.minutes_status === "unavailable" && capability?.capabilities?.minutes) {
    issues.push(`metadata mismatch: minutes_status is unavailable but city capabilities includes "minutes"`);
  }

  if (!capability) {
    issues.push(`missing city capabilities entry: site/data/_city-capabilities.json -> ${slug}`);
  } else {
    checks.push(`city capabilities entry found`);
    const capabilityChecks = {
      members: await pathExists(membersSite),
      minutes: (await pathExists(minutesIndexSite)) || (await pathExists(minutesAltSite)),
      sessions: await pathExists(path.join(siteDir, "sessions", "index.json")),
      themes: await pathExists(themesSite),
      budgets: await pathExists(path.join(siteDir, "budgets", "index.json")),
      decisions: await pathExists(path.join(siteDir, "decisions.json")),
      schedule: await pathExists(path.join(siteDir, "schedule.json")),
      newsletter: await pathExists(path.join(siteDir, "newsletter.json")),
      election: await pathExists(path.join(siteDir, "election.json")),
      plan: await pathExists(path.join(siteDir, "comprehensive_plan.json")),
    };

    for (const [key, expected] of Object.entries(capabilityChecks)) {
      const actual = Boolean(capability.capabilities?.[key]);
      if (actual !== expected) {
        issues.push(`capability mismatch: ${key} is ${actual} but site/data file existence is ${expected}`);
      }
    }
  }

  console.log(`# verify ${slug}`);
  for (const line of checks) {
    console.log(`ok  - ${line}`);
  }
  for (const line of issues) {
    console.log(`ng  - ${line}`);
  }

  if (issues.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
