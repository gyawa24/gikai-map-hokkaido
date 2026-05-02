#!/usr/bin/env node

import { searchSegments } from "./lib/gikai-mcp.mjs";

function printUsage() {
  console.error(`Usage:
  ./scripts/gikai-search-segments.mjs [<query...>] [options]

Options:
  --city SLUG             市町村slug（複数指定可、例: --city chitose --city eniwa）
  --member NAME           議員名で絞り込み（部分一致）
  --faction NAME          会派/政党で絞り込み（部分一致、例: --faction 自民）
  --role 質問|答弁         発言の役割
  --include-procedural    進行発言（議長・委員長等）も含める
  --date-from YYYY-MM-DD  日付下限
  --date-to YYYY-MM-DD    日付上限
  --include-text          発言全文も表示（excerpt より長い）
  --limit N               最大件数（default 20）
  --json                  JSON で出力

Examples:
  ./scripts/gikai-search-segments.mjs 子育て --city chitose --limit 5
  ./scripts/gikai-search-segments.mjs --member 大山 --role 質問
  ./scripts/gikai-search-segments.mjs DX --faction 自民 --date-from 2025-01-01
`);
}

function parseArgs(argv) {
  const out = {
    query: [],
    cities: [],
    member_name: undefined,
    faction: undefined,
    speaker_role: undefined,
    exclude_procedural: true,
    date_from: undefined,
    date_to: undefined,
    include_text: false,
    limit: 20,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--json") { out.json = true; continue; }
    if (arg === "--include-text") { out.include_text = true; continue; }
    if (arg === "--include-procedural") { out.exclude_procedural = false; continue; }
    if (arg === "--limit") { out.limit = Number(argv[++i]); continue; }
    if (arg === "--city") { out.cities.push(argv[++i]); continue; }
    if (arg === "--member") { out.member_name = argv[++i]; continue; }
    if (arg === "--faction") { out.faction = argv[++i]; continue; }
    if (arg === "--role") { out.speaker_role = argv[++i]; continue; }
    if (arg === "--date-from") { out.date_from = argv[++i]; continue; }
    if (arg === "--date-to") { out.date_to = argv[++i]; continue; }
    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    out.query.push(arg);
  }

  return out;
}

function printHuman(result) {
  console.log(`query: ${result.query ?? "(none)"}`);
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
    const member = hit.member_name
      ? ` ${hit.member_name}${hit.member_faction ? ` (${hit.member_faction})` : ""}`
      : "";
    console.log(
      `${index + 1}. [${hit.city_name}] ${hit.date} ${hit.speaker} [${hit.speaker_role}]${member}`
    );
    console.log(`   ${hit.council_name}`);
    if (hit.text) {
      console.log(`   text: ${hit.text}`);
    } else {
      console.log(`   excerpt: ${hit.excerpt}`);
    }
    console.log(`   url: ${hit.url}`);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const queryStr = args.query.join(" ").trim();
  const payload = {
    cities: args.cities.length ? args.cities : undefined,
    member_name: args.member_name,
    faction: args.faction,
    speaker_role: args.speaker_role,
    exclude_procedural: args.exclude_procedural,
    date_from: args.date_from,
    date_to: args.date_to,
    include_text: args.include_text,
    limit: args.limit,
  };
  if (queryStr) payload.query = queryStr;

  if (
    !queryStr &&
    !args.member_name &&
    !args.faction &&
    !args.speaker_role &&
    !args.cities.length
  ) {
    console.error(
      "少なくとも 1 つの絞り込み（query / --city / --member / --faction / --role）が必要です。"
    );
    printUsage();
    process.exit(1);
  }

  const result = await searchSegments(payload);

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
