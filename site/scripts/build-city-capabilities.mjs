#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(SITE_DIR, "..");
const DATA_DIR = path.join(SITE_DIR, "data");
const OUT_FILE = path.join(DATA_DIR, "_city-capabilities.json");

const CAPABILITY_DEFINITIONS = [
  { key: "members", paths: ["members.json"] },
  { key: "minutes", paths: ["minutes/index.json", "index.json"] },
  { key: "sessions", paths: ["sessions/index.json"] },
  { key: "themes", paths: ["members_activity.json"] },
  { key: "budgets", paths: ["budgets/index.json"] },
  { key: "decisions", paths: ["decisions.json"] },
  { key: "schedule", paths: ["schedule.json"] },
  { key: "newsletter", paths: ["newsletter.json"] },
  { key: "election", paths: ["election.json"] },
  { key: "plan", paths: ["comprehensive_plan.json"] },
  { key: "segments", paths: ["segments/_index.json"] },
];

function readIgnoredFiles() {
  const result = spawnSync("git", ["ls-files", "--others", "--ignored", "--exclude-standard", "-z", "site/data"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0 || !result.stdout) return new Set();
  return new Set(result.stdout.split("\0").filter(Boolean));
}

function exists(cityDir, relativePath, ignoredFiles) {
  const targetPath = path.join(cityDir, relativePath);
  if (ignoredFiles.has(path.relative(REPO_ROOT, targetPath))) return false;
  return fs.existsSync(targetPath);
}

function firstExistingPath(cityDir, paths, ignoredFiles) {
  return paths.find((relativePath) => exists(cityDir, relativePath, ignoredFiles)) ?? null;
}

function readMunicipalities() {
  const filePath = path.join(DATA_DIR, "municipalities.json");
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function buildCapabilities() {
  const municipalities = readMunicipalities();
  const ignoredFiles = readIgnoredFiles();
  const cities = {};

  for (const municipality of municipalities) {
    const cityDir = path.join(DATA_DIR, municipality.slug);
    const capabilities = {};
    const paths = {};

    for (const definition of CAPABILITY_DEFINITIONS) {
      const foundPath = firstExistingPath(cityDir, definition.paths, ignoredFiles);
      capabilities[definition.key] = Boolean(foundPath);
      if (foundPath) paths[definition.key] = foundPath;
    }

    cities[municipality.slug] = {
      slug: municipality.slug,
      capabilities,
      paths,
    };
  }

  return {
    version: 2,
    generated_at: new Date().toISOString(),
    source: "site/data",
    cities,
  };
}

const out = buildCapabilities();
fs.writeFileSync(OUT_FILE, `${JSON.stringify(out, null, 2)}\n`);
console.log(
  `city-capabilities written: ${OUT_FILE.replace(SITE_DIR, "site")} (${Object.keys(out.cities).length} cities)`
);
