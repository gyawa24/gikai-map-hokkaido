#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const ROOT_DATA_DIR = path.join(REPO_ROOT, "data");
const SITE_DATA_DIR = path.join(REPO_ROOT, "site", "data");
const ROOT_MUNICIPALITIES_PATH = path.join(ROOT_DATA_DIR, "municipalities.json");
const SITE_MUNICIPALITIES_PATH = path.join(SITE_DATA_DIR, "municipalities.json");

const FIELD_ORDER = [
  "slug",
  "name",
  "council_name",
  "region",
  "furigana",
  "features",
  "level",
  "active",
  "tenant_id",
  "system",
  "minutes_status",
  "minutes_status_note",
  "minutes_verified_at",
  "minutes_access",
  "minutes_access_note",
];

function printHelp() {
  console.log(`Usage:
  node scripts/onboard-municipality.mjs --slug <slug> [options]

Required when creating a new municipality:
  --name <name>
  --council-name <council_name>
  --region <region>
  --furigana <furigana>

Optional:
  --features <csv>            e.g. members,minutes
  --level <municipality|prefecture>
  --active <true|false>
  --tenant-id <number>
  --system <name>
  --minutes-status <available|unavailable>
  --minutes-status-note <text>
  --minutes-verified-at <YYYY-MM-DD>
  --minutes-access <restricted>
  --minutes-access-note <text>
  --build-segments            Build data/{slug}/segments when minutes exist
  --dry-run                   Print actions without writing files
  --help

Examples:
  node scripts/onboard-municipality.mjs \\
    --slug sample \\
    --name 例市 \\
    --council-name 例市議会 \\
    --region 石狩 \\
    --furigana れいし \\
    --features members,minutes \\
    --tenant-id 999 \\
    --system dnp \\
    --build-segments

  node scripts/onboard-municipality.mjs \\
    --slug suttsu \\
    --minutes-status unavailable \\
    --minutes-status-note "公式サイトでは本会議会議録の公開を確認できない" \\
    --minutes-verified-at 2026-05-03
`);
}

function parseArgs(argv) {
  const options = {
    buildSegments: false,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help") {
      options.help = true;
      continue;
    }
    if (arg === "--build-segments") {
      options.buildSegments = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (value == null || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    options[key] = value;
    i += 1;
  }

  return options;
}

function parseFeatures(raw) {
  if (raw == null) return undefined;
  if (!raw.trim()) return [];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBoolean(raw, fallback) {
  if (raw == null) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`Boolean option must be true/false: ${raw}`);
}

function parseInteger(raw, fallback) {
  if (raw == null) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) {
    throw new Error(`Integer option is invalid: ${raw}`);
  }
  return value;
}

function normalizeEntry(entry) {
  const normalized = {};
  for (const key of FIELD_ORDER) {
    if (entry[key] !== undefined) {
      normalized[key] = entry[key];
    }
  }
  return normalized;
}

function preserveEntryOrder(existingEntry, nextEntry) {
  if (!existingEntry) return normalizeEntry(nextEntry);

  const ordered = {};
  const seen = new Set();

  for (const key of Object.keys(existingEntry)) {
    if (nextEntry[key] !== undefined) {
      ordered[key] = nextEntry[key];
      seen.add(key);
    }
  }

  for (const key of FIELD_ORDER) {
    if (!seen.has(key) && nextEntry[key] !== undefined) {
      ordered[key] = nextEntry[key];
      seen.add(key);
    }
  }

  return ordered;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(filePath, data, dryRun) {
  const text = `${JSON.stringify(data, null, 2)}\n`;
  const currentText = await fs.readFile(filePath, "utf8").catch(() => null);
  if (currentText === text) {
    console.log(`skip ${path.relative(REPO_ROOT, filePath)} (unchanged)`);
    return;
  }
  if (dryRun) {
    console.log(`[dry-run] write ${path.relative(REPO_ROOT, filePath)}`);
    return;
  }
  await fs.writeFile(filePath, text, "utf8");
  console.log(`wrote ${path.relative(REPO_ROOT, filePath)}`);
}

async function ensureDir(dirPath, dryRun) {
  if (dryRun) {
    console.log(`[dry-run] mkdir -p ${path.relative(REPO_ROOT, dirPath)}`);
    return;
  }
  await fs.mkdir(dirPath, { recursive: true });
  console.log(`ensured ${path.relative(REPO_ROOT, dirPath)}/`);
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function syncMunicipalityDirectory(slug, dryRun) {
  const sourceDir = path.join(ROOT_DATA_DIR, slug);
  const destDir = path.join(SITE_DATA_DIR, slug);
  const sourceExists = await pathExists(sourceDir);

  await ensureDir(sourceDir, dryRun);
  await ensureDir(destDir, dryRun);

  if (!sourceExists) {
    console.log(`skip sync: data/${slug}/ has no files yet`);
    return;
  }

  if (dryRun) {
    console.log(`[dry-run] cp -R data/${slug}/ -> site/data/${slug}/`);
    return;
  }

  await fs.cp(sourceDir, destDir, { recursive: true, force: true });
  console.log(`synced data/${slug}/ -> site/data/${slug}/`);
}

async function hasMinutes(slug) {
  return (
    (await pathExists(path.join(ROOT_DATA_DIR, slug, "minutes", "index.json"))) ||
    (await pathExists(path.join(ROOT_DATA_DIR, slug, "index.json")))
  );
}

async function runBuildSegments(slug, dryRun) {
  if (!(await hasMinutes(slug))) {
    console.log(`skip segments: data/${slug}/minutes/index.json not found`);
    return;
  }

  if (dryRun) {
    console.log(`[dry-run] node scripts/build-segments.mjs ${slug}`);
    return;
  }

  await new Promise((resolve, reject) => {
    const child = spawn("node", [path.join(REPO_ROOT, "scripts", "build-segments.mjs"), slug], {
      cwd: REPO_ROOT,
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`build-segments failed for ${slug} with exit code ${code}`));
    });
    child.on("error", reject);
  });
}

function mergeEntry(existingEntry, options) {
  const base = existingEntry ? { ...existingEntry } : {};
  const next = {
    ...base,
    slug: options.slug ?? base.slug,
    name: options.name ?? base.name,
    council_name: options["council-name"] ?? base.council_name,
    region: options.region ?? base.region,
    furigana: options.furigana ?? base.furigana,
    features: parseFeatures(options.features) ?? base.features ?? [],
    level: options.level ?? base.level ?? "municipality",
    active: parseBoolean(options.active, base.active ?? true),
    tenant_id: parseInteger(options["tenant-id"], base.tenant_id),
    system: options.system ?? base.system,
    minutes_status: options["minutes-status"] ?? base.minutes_status,
    minutes_status_note: options["minutes-status-note"] ?? base.minutes_status_note,
    minutes_verified_at: options["minutes-verified-at"] ?? base.minutes_verified_at,
    minutes_access: options["minutes-access"] ?? base.minutes_access,
    minutes_access_note: options["minutes-access-note"] ?? base.minutes_access_note,
  };

  const requiredFields = ["slug", "name", "council_name", "region", "furigana"];
  for (const field of requiredFields) {
    if (!next[field]) {
      throw new Error(`Missing required field for municipality entry: ${field}`);
    }
  }

  return preserveEntryOrder(existingEntry, next);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  if (!options.slug) {
    throw new Error("--slug is required");
  }

  const municipalities = await readJson(ROOT_MUNICIPALITIES_PATH);
  const index = municipalities.findIndex((item) => item.slug === options.slug);
  const existingEntry = index >= 0 ? municipalities[index] : null;
  const nextEntry = mergeEntry(existingEntry, options);

  if (index >= 0) {
    municipalities[index] = nextEntry;
    console.log(`updated municipality entry: ${options.slug}`);
  } else {
    municipalities.push(nextEntry);
    console.log(`added municipality entry: ${options.slug}`);
  }

  await writeJson(ROOT_MUNICIPALITIES_PATH, municipalities, options.dryRun);
  await writeJson(SITE_MUNICIPALITIES_PATH, municipalities, options.dryRun);

  await syncMunicipalityDirectory(options.slug, options.dryRun);

  if (options.buildSegments) {
    await runBuildSegments(options.slug, options.dryRun);
    await syncMunicipalityDirectory(options.slug, options.dryRun);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
