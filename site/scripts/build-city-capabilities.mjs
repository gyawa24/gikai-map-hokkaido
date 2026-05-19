#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE_DIR = path.resolve(__dirname, "..");
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

function exists(cityDir, relativePath) {
  return fs.existsSync(path.join(cityDir, relativePath));
}

function firstExistingPath(cityDir, paths) {
  return paths.find((relativePath) => exists(cityDir, relativePath)) ?? null;
}

function readMunicipalities() {
  const filePath = path.join(DATA_DIR, "municipalities.json");
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function buildCapabilities() {
  const municipalities = readMunicipalities();
  const cities = {};

  for (const municipality of municipalities) {
    const cityDir = path.join(DATA_DIR, municipality.slug);
    const capabilities = {};
    const paths = {};

    for (const definition of CAPABILITY_DEFINITIONS) {
      const foundPath = firstExistingPath(cityDir, definition.paths);
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
