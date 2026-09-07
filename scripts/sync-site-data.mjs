#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { printBudgetSourceReminders } from "./lib/budget-source-reminders.mjs";
import { printPublicDataReminders } from "./lib/public-data-reminders.mjs";

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
  - This script preserves site-only overlays outside minutes/.
  - Within minutes/, a valid source index is the publication manifest. Only index.json,
    referenced meeting JSON, and matching enriched JSON are copied; other JSON stays local.
  - segments are not copied by default because they are large local research data.
  - After copying, the script prints reminders for public news, coverage, inventory, and source ledgers.
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

function atomicTempPath(destPath) {
  return path.join(
    path.dirname(destPath),
    `.${path.basename(destPath)}.${process.pid}.${randomUUID()}.tmp`
  );
}

async function stageCopiedFile(sourcePath, destPath, dryRun) {
  const stagedFile = { sourcePath, destPath, tempPath: null };
  if (dryRun) return stagedFile;
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  stagedFile.tempPath = atomicTempPath(destPath);
  try {
    await fs.copyFile(sourcePath, stagedFile.tempPath);
    return stagedFile;
  } catch (error) {
    await fs.rm(stagedFile.tempPath, { force: true }).catch(() => {});
    stagedFile.tempPath = null;
    throw error;
  }
}

async function stageFileContents(contents, sourcePath, destPath, dryRun) {
  const stagedFile = { sourcePath, destPath, tempPath: null };
  if (dryRun) return stagedFile;
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  stagedFile.tempPath = atomicTempPath(destPath);
  try {
    await fs.writeFile(stagedFile.tempPath, contents);
    return stagedFile;
  } catch (error) {
    await fs.rm(stagedFile.tempPath, { force: true }).catch(() => {});
    stagedFile.tempPath = null;
    throw error;
  }
}

async function assertDestinationsReplaceable(stagedFiles) {
  for (const { destPath } of stagedFiles) {
    try {
      const stats = await fs.lstat(destPath);
      if (stats.isDirectory()) {
        throw new Error(`minutes publication destination is a directory: ${rel(destPath)}`);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

async function commitStagedFile(stagedFile, dryRun) {
  if (dryRun) {
    console.log(
      `[dry-run] atomic copy ${rel(stagedFile.sourcePath)} -> ${rel(stagedFile.destPath)}`
    );
    return;
  }
  await fs.rename(stagedFile.tempPath, stagedFile.destPath);
  stagedFile.tempPath = null;
  console.log(`copied atomically ${rel(stagedFile.sourcePath)} -> ${rel(stagedFile.destPath)}`);
}

async function cleanupStagedFiles(stagedFiles) {
  await Promise.all(
    stagedFiles
      .filter((stagedFile) => stagedFile?.tempPath)
      .map((stagedFile) => fs.rm(stagedFile.tempPath, { force: true }).catch(() => {}))
  );
}

async function listJsonFiles(baseDir) {
  if (!(await pathExists(baseDir))) return [];
  const files = [];
  async function visit(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const filePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) await visit(filePath);
      else if (entry.isFile() && entry.name.endsWith(".json")) {
        files.push(path.relative(baseDir, filePath));
      }
    }
  }
  await visit(baseDir);
  return files.sort();
}

async function publicationMinutesFiles(sourceIndex, sourceDir) {
  const files = new Set(["index.json"]);
  const councilIds = new Set();
  for (const entry of sourceIndex) {
    const file = typeof entry?.file === "string" ? entry.file.trim() : "";
    if (!/^[^/\\]+\.json$/u.test(file)) {
      throw new Error(`minutes index contains an unsafe file reference: ${file || "(empty)"}`);
    }
    if (!(await pathExists(path.join(sourceDir, file)))) {
      throw new Error(`minutes index references missing meeting JSON: ${rel(path.join(sourceDir, file))}`);
    }
    const councilId = String(entry.council_id ?? "");
    if (!councilId || councilIds.has(councilId) || files.has(file)) {
      throw new Error(`minutes index contains a missing or duplicate council identity: ${councilId}`);
    }
    councilIds.add(councilId);
    const council = await readJson(path.join(sourceDir, file));
    if (String(council?.council_id) !== councilId || !Array.isArray(council?.schedules) || !council.schedules.length) {
      throw new Error(`minutes index references malformed or mismatched meeting JSON: ${file}`);
    }
    if (entry.schedule_count != null && entry.schedule_count !== council.schedules.length) {
      throw new Error(`minutes index schedule_count differs from meeting JSON: ${file}`);
    }
    const scheduleIds = new Set();
    for (const schedule of council.schedules) {
      const scheduleId = String(schedule?.schedule_id ?? "");
      if (!scheduleId || scheduleIds.has(scheduleId) || !Array.isArray(schedule?.minutes)) {
        throw new Error(`minutes meeting contains invalid or duplicate schedules: ${file}`);
      }
      scheduleIds.add(scheduleId);
    }
    files.add(file);
    const enrichedFile = path.join("enriched", file);
    if (await pathExists(path.join(sourceDir, enrichedFile))) {
      files.add(enrichedFile);
    }
  }
  return files;
}

export async function assertManagedMinutesProjection(sourceDir, sourceIndex) {
  const municipalityDir = path.dirname(sourceDir);
  const registryPath = path.join(municipalityDir, "council-records", "index.json");
  const active = new Map();
  if (!(await pathExists(registryPath))) return active;
  const registry = await readJson(registryPath);
  if (registry?.schema_version !== "council-record-body-registry.v1"
      || registry.municipality_id !== path.basename(municipalityDir)
      || !Array.isArray(registry.records)) {
    throw new Error(`Invalid v2 managed minutes registry: ${rel(registryPath)}`);
  }
  const seen = new Set();
  for (const record of registry.records) {
    const id = record?.council_id;
    if (!Number.isSafeInteger(id) || id < 1 || seen.has(id)
        || !["active", "rolled_back"].includes(record.state)
        || !/^[a-f0-9]{64}$/u.test(record.minutes_sha256 ?? "")
        || !/^[a-f0-9]{64}$/u.test(record.publication_sha256 ?? "")
        || !new RegExp(`^council-records/${id}/releases/[A-Za-z0-9][A-Za-z0-9_-]*$`, "u").test(record.release_path ?? "")) {
      throw new Error(`Invalid v2 managed minutes registry entry: ${rel(registryPath)}`);
    }
    seen.add(id);
    if (record.state !== "active") continue;
    const entry = sourceIndex.filter((item) => String(item?.council_id) === String(id));
    if (entry.length !== 1 || entry[0].file !== `${id}.json`) {
      throw new Error(`v2 managed council ${id}: publication index entry missing or changed; use the council-record publication workflow`);
    }
    const bodyPath = path.join(sourceDir, `${id}.json`);
    if (!(await pathExists(bodyPath))
        || createHash("sha256").update(await fs.readFile(bodyPath)).digest("hex") !== record.minutes_sha256) {
      throw new Error(`v2 managed council ${id}: projection hash mismatch; legacy update held`);
    }
    active.set(`${id}.json`, record.minutes_sha256);
  }
  return active;
}

async function verifyManagedMinutesReleases(sourceDir, active) {
  if (!active.size) return;
  const { verifyCouncilRecordV2BodyRelease } = await import("./lib/council-record-v2-body-storage.mjs");
  const slug = path.basename(path.dirname(sourceDir));
  const repoRoot = path.resolve(sourceDir, "../../..");
  for (const file of active.keys()) {
    await verifyCouncilRecordV2BodyRelease(repoRoot, slug, Number(path.basename(file, ".json")));
  }
}

export async function pruneStaleMinutesJson(sourceDir, destDir, options = {}) {
  if (!(await pathExists(destDir))) return [];
  const sourceIndexPath = path.join(sourceDir, "index.json");
  const sourceIndex = await pathExists(sourceIndexPath) ? await readJson(sourceIndexPath) : [];
  if (!Array.isArray(sourceIndex)) {
    throw new Error(`${rel(sourceIndexPath)} must contain a JSON array before minutes pruning`);
  }
  const active = await assertManagedMinutesProjection(sourceDir, sourceIndex);
  await verifyManagedMinutesReleases(sourceDir, active);
  let publishedFiles = options.publishedFiles;
  if (!publishedFiles) {
    if (!(await pathExists(sourceDir))) return [];
    if (!(await pathExists(sourceIndexPath))) return [];
    publishedFiles = await publicationMinutesFiles(sourceIndex, sourceDir);
  }
  for (const file of active.keys()) {
    if (!publishedFiles.has(file)) throw new Error(`v2 managed council ${file}: refusing to prune its published projection`);
  }
  const staleFiles = (await listJsonFiles(destDir)).filter(
    (relativePath) => !publishedFiles.has(relativePath)
  );
  for (const relativePath of staleFiles) {
    const targetPath = path.join(destDir, relativePath);
    if (options.dryRun) console.log(`[dry-run] remove stale ${rel(targetPath)}`);
    else {
      await fs.unlink(targetPath);
      console.log(`removed stale ${rel(targetPath)}`);
    }
  }
  return staleFiles;
}

export async function syncPublishedMinutes(sourceDir, destDir, dryRun = false) {
  if (!(await pathExists(sourceDir))) {
    await assertManagedMinutesProjection(sourceDir, []);
    return false;
  }
  const sourceIndexPath = path.join(sourceDir, "index.json");
  if (!(await pathExists(sourceIndexPath))) {
    throw new Error(`minutes publication requires a source index: ${rel(sourceIndexPath)}`);
  }
  const sourceIndexContents = await fs.readFile(sourceIndexPath, "utf8");
  const sourceIndex = JSON.parse(sourceIndexContents);
  if (!Array.isArray(sourceIndex)) {
    throw new Error(`${rel(sourceIndexPath)} must contain a JSON array before minutes sync`);
  }

  const active = await assertManagedMinutesProjection(sourceDir, sourceIndex);
  await verifyManagedMinutesReleases(sourceDir, active);
  const publishedFiles = await publicationMinutesFiles(sourceIndex, sourceDir);
  const stagedBodies = [];
  let stagedIndex;
  try {
    for (const relativePath of publishedFiles) {
      if (relativePath === "index.json") continue;
      const sourcePath = path.join(sourceDir, relativePath);
      try {
        stagedBodies.push(
          await stageCopiedFile(sourcePath, path.join(destDir, relativePath), dryRun)
        );
      } catch (error) {
        if (await pathExists(sourcePath)) throw error;
        throw new Error(`minutes publication file disappeared during sync: ${rel(sourcePath)}`);
      }
    }
    stagedIndex = await stageFileContents(
      sourceIndexContents,
      sourceIndexPath,
      path.join(destDir, "index.json"),
      dryRun
    );
    await assertDestinationsReplaceable([...stagedBodies, stagedIndex]);
    for (const stagedBody of stagedBodies) {
      const file = path.basename(stagedBody.destPath);
      if (active.has(file) && path.dirname(path.resolve(stagedBody.destPath)) === path.resolve(destDir)) {
        const bytes = await fs.readFile(stagedBody.tempPath ?? path.join(sourceDir, file));
        if (createHash("sha256").update(bytes).digest("hex") !== active.get(file)) {
          throw new Error(`v2 managed council ${file}: projection changed during sync; legacy update held`);
        }
      }
    }

    // The filesystem cannot commit multiple renames as one transaction. Staging and
    // preflight remove deterministic failures; an external failure during commit is surfaced.
    for (const stagedBody of stagedBodies) {
      await commitStagedFile(stagedBody, dryRun);
    }
    await commitStagedFile(stagedIndex, dryRun);
  } catch (error) {
    await cleanupStagedFiles([...stagedBodies, stagedIndex]);
    throw error;
  }
  await pruneStaleMinutesJson(sourceDir, destDir, { dryRun, publishedFiles });
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
    const sourcePath = path.join(sourceDir, entry);
    const destPath = path.join(destDir, entry);
    if (entry === "minutes") {
      const didCopy = await syncPublishedMinutes(sourcePath, destPath, dryRun);
      if (didCopy) copied += 1;
      continue;
    }
    const didCopy = await copyPath(sourcePath, destPath, dryRun);
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

  await printPublicDataReminders(REPO_ROOT, syncedSlugs, { dryRun: options.dryRun });
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
