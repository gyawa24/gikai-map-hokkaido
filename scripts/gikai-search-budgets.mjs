#!/usr/bin/env node

import { listTools, searchBudgets } from "./lib/gikai-mcp.mjs";

function printUsage() {
  console.error(`Usage:
  ./scripts/gikai-search-budgets.mjs <query> [--limit N] [--city SLUG ...] [--year YYYY] [--match-mode normal|fuzzy|exact] [--include-text] [--json]
  ./scripts/gikai-search-budgets.mjs --list-tools

Examples:
  ./scripts/gikai-search-budgets.mjs 除雪 --city chitose --city eniwa --year 2026
  ./scripts/gikai-search-budgets.mjs 士木費 --match-mode fuzzy
  ./scripts/gikai-search-budgets.mjs 学校 給食 --limit 20 --json
`);
}

function parseArgs(argv) {
  const cities = [];
  const queryParts = [];
  let limit = 10;
  let year;
  let matchMode = "normal";
  let includeText = false;
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
    if (arg === "--include-text") {
      includeText = true;
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
    if (arg === "--year") {
      year = argv[++i];
      continue;
    }
    if (arg === "--match-mode") {
      matchMode = argv[++i];
      if (!["normal", "fuzzy", "exact"].includes(matchMode)) {
        throw new Error(`Invalid --match-mode: ${matchMode}`);
      }
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    queryParts.push(arg);
  }

  return {
    cities,
    includeText,
    json,
    limit,
    listOnly,
    matchMode,
    query: queryParts.join(" ").trim(),
    year,
  };
}

function printHuman(result) {
  console.log(`query: ${result.query}`);
  console.log(`match_mode: ${result.match_mode}`);
  console.log(`total_hits: ${result.total_hits}`);
  console.log(`returned: ${result.returned}`);

  const byCity = Object.entries(result.by_city ?? {});
  if (byCity.length) {
    console.log("by_city:");
    for (const [slug, count] of byCity.sort((a, b) => b[1] - a[1])) {
      console.log(`  ${slug}: ${count}`);
    }
  }

  if (!result.hits?.length) return;

  console.log("");
  result.hits.forEach((hit, index) => {
    console.log(`${index + 1}. [${hit.city_name}] ${hit.document_title}`);
    console.log(`   page: ${hit.page} ${hit.toc_label ? `(${hit.toc_label})` : ""}`);
    console.log(`   snippet: ${hit.snippet}`);
    console.log(`   page_url: ${hit.page_url}`);
    console.log(`   image_url: ${hit.image_url}`);
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

  const result = await searchBudgets({
    query: args.query,
    limit: args.limit,
    cities: args.cities.length ? args.cities : undefined,
    year: args.year,
    match_mode: args.matchMode,
    include_text: args.includeText,
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHuman(result);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
