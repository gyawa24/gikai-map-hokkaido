#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const NEWS_PATH = path.join(REPO_ROOT, "site", "data", "news.json");
const VALID_CATEGORIES = new Set(["機能追加", "改善", "修正", "お知らせ", "自治体追加"]);

function printHelp() {
  console.log(`Usage:
  node scripts/add-news-item.mjs \\
    --date 2026-05-03 \\
    --category 改善 \\
    --title "導線を整理" \\
    --body "市町村追加フローを整理しました。"

Options:
  --date <YYYY-MM-DD>        default: today (JST)
  --category <category>      機能追加 | 改善 | 修正 | お知らせ | 自治体追加
  --title <text>
  --body <text>
  --dry-run
  --help
`);
}

function todayJst() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

function parseArgs(argv) {
  const options = { date: todayJst(), dryRun: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help") {
      options.help = true;
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

function validate(options) {
  if (!options.title) throw new Error("--title is required");
  if (!options.body) throw new Error("--body is required");
  if (!options.category) throw new Error("--category is required");
  if (!VALID_CATEGORIES.has(options.category)) {
    throw new Error(`Invalid --category: ${options.category}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date)) {
    throw new Error(`Invalid --date: ${options.date}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  validate(options);

  const current = JSON.parse(await fs.readFile(NEWS_PATH, "utf8"));
  if (!Array.isArray(current)) {
    throw new Error("site/data/news.json must be an array");
  }

  const nextItem = {
    date: options.date,
    category: options.category,
    title: options.title,
    body: options.body,
  };

  const next = [nextItem, ...current].sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : 0
  );
  const text = `${JSON.stringify(next, null, 2)}\n`;

  if (options.dryRun) {
    console.log(text);
    return;
  }

  await fs.writeFile(NEWS_PATH, text, "utf8");
  console.log(`appended ${options.date} ${options.category}: ${options.title}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
