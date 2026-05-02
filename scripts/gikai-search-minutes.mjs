#!/usr/bin/env node

import { listTools, searchMinutes } from "./lib/gikai-mcp.mjs";

function printUsage() {
  console.error(`Usage:
  ./scripts/gikai-search-minutes.mjs <query> [--limit N] [--city SLUG ...] [--year-from YYYY] [--year-to YYYY] [--json]
  ./scripts/gikai-search-minutes.mjs --list-tools

Examples:
  ./scripts/gikai-search-minutes.mjs AI --limit 5
  ./scripts/gikai-search-minutes.mjs 介護保険 値上げ --city chitose --city eniwa --year-from 2024
  ./scripts/gikai-search-minutes.mjs DX --json
`);
}

function parseArgs(argv) {
  const cities = [];
  const queryParts = [];
  let limit = 10;
  let yearFrom;
  let yearTo;
  let json = false;
  let listOnly = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--list-tools") {
      listOnly = true;
      continue;
    }
    if (arg === "--limit") {
      limit = Number(argv[++i]);
      continue;
    }
    if (arg === "--city") {
      cities.push(argv[++i]);
      continue;
    }
    if (arg === "--year-from") {
      yearFrom = Number(argv[++i]);
      continue;
    }
    if (arg === "--year-to") {
      yearTo = Number(argv[++i]);
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    queryParts.push(arg);
  }

  return {
    cities,
    json,
    limit,
    listOnly,
    query: queryParts.join(" ").trim(),
    yearFrom,
    yearTo,
  };
}

function printHuman(result) {
  console.log(`query: ${result.query}`);
  console.log(`total_hits: ${result.total_hits}`);
  console.log(`returned: ${result.returned}`);

  const byCity = Object.entries(result.by_city ?? {});
  if (byCity.length) {
    console.log("by_city:");
    for (const [slug, count] of byCity.sort((a, b) => b[1] - a[1])) {
      console.log(`  ${slug}: ${count}`);
    }
  }

  if (!result.hits?.length) {
    return;
  }

  console.log("");
  result.hits.forEach((hit, index) => {
    console.log(`${index + 1}. [${hit.city_name}] ${hit.council_name}`);
    console.log(`   agenda: ${hit.agenda_title ?? "-"}`);
    console.log(`   excerpt: ${hit.excerpt}`);
    console.log(`   url: ${hit.url}`);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.listOnly) {
    const tools = await listTools();
    console.log(JSON.stringify({ tool_names: tools }, null, 2));
    return;
  }

  if (!args.query) {
    printUsage();
    process.exit(1);
  }

  const result = await searchMinutes({
    query: args.query,
    limit: args.limit,
    cities: args.cities.length ? args.cities : undefined,
    year_from: args.yearFrom,
    year_to: args.yearTo,
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printHuman(result);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
