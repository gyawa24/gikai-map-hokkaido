#!/usr/bin/env node

import { getMunicipalityName, searchMinutes } from "./lib/gikai-mcp.mjs";

const DEFAULT_TERMS = ["AI", "生成AI", "ChatGPT", "Copilot", "DX", "デジタル", "業務効率化"];

function printUsage() {
  console.error(`Usage:
  ./scripts/gikai-ai-survey.mjs [--term WORD ...] [--limit N] [--city SLUG ...] [--year-from YYYY] [--year-to YYYY] [--json]

Examples:
  ./scripts/gikai-ai-survey.mjs
  ./scripts/gikai-ai-survey.mjs --city chitose --city eniwa --year-from 2024
  ./scripts/gikai-ai-survey.mjs --term AI --term DX --json
`);
}

function parseArgs(argv) {
  const cities = [];
  const terms = [];
  let limit = 30;
  let yearFrom;
  let yearTo;
  let json = false;

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
    if (arg === "--term") {
      terms.push(argv[++i]);
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
    throw new Error(`Unknown option: ${arg}`);
  }

  return {
    cities,
    json,
    limit,
    terms: terms.length ? terms : DEFAULT_TERMS,
    yearFrom,
    yearTo,
  };
}

function buildCitySummary(results) {
  const cities = new Map();

  for (const result of results) {
    const term = result.query;
    for (const [slug, count] of Object.entries(result.by_city ?? {})) {
      const sample = result.hits?.find((hit) => hit.city === slug) ?? null;
      const entry = cities.get(slug) ?? {
        city: slug,
        city_name: sample?.city_name ?? getMunicipalityName(slug),
        total_term_hits: 0,
        terms: {},
        samples: [],
      };
      entry.total_term_hits += count;
      entry.terms[term] = count;
      if (sample && entry.samples.every((item) => item.url !== sample.url)) {
        entry.samples.push({
          query: term,
          agenda_title: sample.agenda_title,
          council_name: sample.council_name,
          excerpt: sample.excerpt,
          url: sample.url,
        });
      }
      cities.set(slug, entry);
    }
  }

  return [...cities.values()].sort((a, b) => b.total_term_hits - a.total_term_hits);
}

function printHuman(results, citySummary) {
  console.log(`terms: ${results.map((result) => result.query).join(", ")}`);
  console.log("");
  console.log("term_totals:");
  for (const result of results) {
    console.log(`  ${result.query}: ${result.total_hits}`);
  }

  console.log("");
  console.log("cities:");
  if (!citySummary.length) {
    console.log("  no hits");
    return;
  }

  citySummary.forEach((city, index) => {
    const termText = Object.entries(city.terms)
      .sort((a, b) => b[1] - a[1])
      .map(([term, count]) => `${term}=${count}`)
      .join(", ");
    console.log(`${index + 1}. ${city.city_name} (${city.city}) total=${city.total_term_hits}`);
    console.log(`   terms: ${termText}`);
    city.samples.slice(0, 2).forEach((sample) => {
      console.log(`   sample[${sample.query}]: ${sample.excerpt}`);
      console.log(`   url: ${sample.url}`);
    });
  });

  console.log("");
  console.log("note: counts are summed across keyword queries and can double-count the same agenda.");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const results = [];

  for (const term of args.terms) {
    results.push(
      await searchMinutes({
        query: term,
        limit: args.limit,
        cities: args.cities.length ? args.cities : undefined,
        year_from: args.yearFrom,
        year_to: args.yearTo,
      })
    );
  }

  const citySummary = buildCitySummary(results);
  const payload = {
    terms: args.terms,
    term_totals: results.map((result) => ({
      query: result.query,
      total_hits: result.total_hits,
      by_city: result.by_city ?? {},
    })),
    cities: citySummary,
    note: "counts are summed across keyword queries and can double-count the same agenda",
  };

  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  printHuman(results, citySummary);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
