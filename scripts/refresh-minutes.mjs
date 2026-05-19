#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const ROOT_DATA_DIR = path.join(REPO_ROOT, "data");
const ROOT_MUNICIPALITIES_PATH = path.join(ROOT_DATA_DIR, "municipalities.json");
const PDF_SCRAPER_PATH = path.join(REPO_ROOT, "scraper", "scrape_minutes_pdf.py");

function printHelp() {
  console.log(`Usage:
  node scripts/refresh-minutes.mjs --slug <slug> [options]
  node scripts/refresh-minutes.mjs --slugs <slug1,slug2> [options]
  node scripts/refresh-minutes.mjs --all-published [options]
  node scripts/refresh-minutes.mjs --all-supported [options]

Options:
  --years <csv>              e.g. 2024,2025,2026
  --force                    Pass through to scraper
  --build-segments           Run build-segments after scraping (default: on)
  --no-build-segments        Skip build-segments
  --verify                   Run verify-municipality after scraping
  --coverage                 Regenerate municipality coverage after completion
  --concurrency <n>          Run scraper jobs in parallel (default: 1)
  --parallel <n>             Alias for --concurrency
  --dry-run                  Print commands without executing
  --help

Selection:
  --all-published            Run municipalities with published minutes data files and a known runner
  --all-supported            Run every municipality that has a known scraper path/config

Examples:
  node scripts/refresh-minutes.mjs --slug yakumo --years 2024 --verify
  node scripts/refresh-minutes.mjs --slugs chitose,eniwa,tomakomai --years 2025,2026
  node scripts/refresh-minutes.mjs --all-published --years 2025,2026 --coverage --concurrency 2
`);
}

function parseArgs(argv) {
  const options = {
    buildSegments: true,
    verify: false,
    coverage: false,
    force: false,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--force") {
      options.force = true;
      continue;
    }
    if (arg === "--build-segments") {
      options.buildSegments = true;
      continue;
    }
    if (arg === "--no-build-segments") {
      options.buildSegments = false;
      continue;
    }
    if (arg === "--verify") {
      options.verify = true;
      continue;
    }
    if (arg === "--coverage") {
      options.coverage = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--all-published") {
      options["all-published"] = true;
      continue;
    }
    if (arg === "--all-supported") {
      options["all-supported"] = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (value == null || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }
    options[key] = value;
    i += 1;
  }

  return options;
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

async function hasPublishedMinutesData(slug) {
  return (
    (await pathExists(path.join(ROOT_DATA_DIR, slug, "minutes", "index.json"))) ||
    (await pathExists(path.join(ROOT_DATA_DIR, slug, "index.json")))
  );
}

async function loadPdfConfigSlugs() {
  const text = await fs.readFile(PDF_SCRAPER_PATH, "utf8");
  const configsText = text.split("PDF_CONFIGS: dict[str, dict] = {")[1]?.split("\n}\n\nTYPE_FLAGS")[0] ?? "";
  return new Set(
    [...configsText.matchAll(/^\s{4}"([^"]+)":\s*\{/gm)].map((match) => match[1]),
  );
}

function csvToList(raw) {
  return String(raw ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePositiveInteger(raw, flagName) {
  const value = Number.parseInt(String(raw), 10);
  if (!Number.isInteger(value) || value < 1 || String(value) !== String(raw).trim()) {
    throw new Error(`${flagName} must be a positive integer`);
  }
  return value;
}

async function runWithConcurrency(items, concurrency, worker) {
  const results = [];
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, runWorker));
  return results;
}

async function resolveRunner(slug, municipalitiesMap, pdfConfigSlugs) {
  const customScraper = path.join(REPO_ROOT, "scraper", slug, "scrape_minutes.py");
  if (await pathExists(customScraper)) {
    return {
      label: `${slug}/scrape_minutes.py`,
      command: ["python3", [customScraper, "--years"]],
    };
  }

  if (pdfConfigSlugs.has(slug)) {
    return {
      label: "scrape_minutes_pdf.py",
      command: ["python3", [path.join(REPO_ROOT, "scraper", "scrape_minutes_pdf.py"), "--slug", slug, "--years"]],
    };
  }

  const municipality = municipalitiesMap.get(slug);
  if (!municipality) return null;

  if (municipality.system === "gijiroku_com" || municipality.gijiroku_subdomain) {
    return {
      label: "scrape_minutes_gijiroku.py",
      command: ["python3", [path.join(REPO_ROOT, "scraper", "scrape_minutes_gijiroku.py"), "--slug", slug, "--years"]],
    };
  }

  if (municipality.system === "dnp" || municipality.tenant_id != null) {
    return {
      label: "scrape_minutes.py",
      command: ["python3", [path.join(REPO_ROOT, "scraper", "scrape_minutes.py"), "--slug", slug, "--years"]],
    };
  }

  return null;
}

async function run(command, args, dryRun) {
  const printable = [command, ...args].join(" ");
  if (dryRun) {
    console.log(`[dry-run] ${printable}`);
    return;
  }

  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${printable} exited with code ${code}`));
    });
  });
}

async function determineSlugs(options, municipalities, pdfConfigSlugs) {
  const municipalitiesMap = new Map(municipalities.map((item) => [item.slug, item]));

  if (options.slug) return [options.slug];
  if (options.slugs) return csvToList(options.slugs);

  if (options["all-published"]) {
    const slugs = [];
    for (const item of municipalities) {
      if (
        (await hasPublishedMinutesData(item.slug)) &&
        (await resolveRunner(item.slug, municipalitiesMap, pdfConfigSlugs))
      ) {
        slugs.push(item.slug);
      }
    }
    return slugs;
  }

  if (options["all-supported"]) {
    const slugs = [];
    for (const item of municipalities) {
      const runner = await resolveRunner(item.slug, municipalitiesMap, pdfConfigSlugs);
      if (runner) slugs.push(item.slug);
    }
    return slugs;
  }

  return [];
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const years = options.years ? csvToList(options.years) : ["2024", "2025"];
  if (years.length === 0) {
    throw new Error("years is empty");
  }
  const concurrency = parsePositiveInteger(options.concurrency ?? options.parallel ?? "1", "--concurrency");

  const municipalities = await readJson(ROOT_MUNICIPALITIES_PATH);
  const municipalitiesMap = new Map(municipalities.map((item) => [item.slug, item]));
  const pdfConfigSlugs = await loadPdfConfigSlugs();
  const slugs = await determineSlugs(options, municipalities, pdfConfigSlugs);

  if (slugs.length === 0) {
    printHelp();
    throw new Error("No target slugs selected");
  }

  const failures = [];
  const targets = [];

  for (const slug of slugs) {
    const runner = await resolveRunner(slug, municipalitiesMap, pdfConfigSlugs);
    if (!runner) {
      failures.push({ slug, error: "unsupported slug" });
      console.error(`\n[${slug}] unsupported slug`);
      continue;
    }
    targets.push({ slug, runner });
  }

  const scraperResults = await runWithConcurrency(targets, concurrency, async ({ slug, runner }) => {
    console.log(`\n=== ${slug} (${runner.label}) ===`);
    try {
      const [command, baseArgs] = runner.command;
      const args = [...baseArgs, years.join(",")];
      if (options.force) args.push("--force");
      await run(command, args, options.dryRun);
      return { slug, ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[${slug}] failed: ${message}`);
      return { slug, ok: false, error: message };
    }
  });

  const failedScraperSlugs = new Set();
  for (const result of scraperResults) {
    if (!result?.ok) {
      failures.push({ slug: result.slug, error: result.error });
      failedScraperSlugs.add(result.slug);
    }
  }

  for (const { slug } of targets) {
    if (failedScraperSlugs.has(slug)) continue;

    try {
      const onboardArgs = [path.join(REPO_ROOT, "scripts", "onboard-municipality.mjs"), "--slug", slug];
      if (options.buildSegments) onboardArgs.push("--build-segments");
      if (options.verify) onboardArgs.push("--verify");
      await run("node", onboardArgs, options.dryRun);
    } catch (error) {
      failures.push({ slug, error: error instanceof Error ? error.message : String(error) });
      console.error(`[${slug}] failed: ${failures.at(-1).error}`);
    }
  }

  if (options.coverage && failures.length === 0) {
    await run("node", [path.join(REPO_ROOT, "scripts", "generate-municipality-coverage.mjs")], options.dryRun);
  }

  if (failures.length > 0) {
    console.error("\nFailed targets:");
    for (const failure of failures) {
      console.error(`- ${failure.slug}: ${failure.error}`);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
