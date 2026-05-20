#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(REPO_ROOT, "data");
const SITE_DATA_DIR = path.join(REPO_ROOT, "site", "data");

const CAPABILITY_LABELS = {
  members: "議員",
  minutes: "議事録",
  sessions: "速報",
  themes: "テーマ",
  budgets: "予算書",
  decisions: "議決",
  schedule: "行事",
  newsletter: "だより",
  plan: "総合計画",
};

function printHelp() {
  console.log(`Usage:
  node scripts/operations-check.mjs [--weekly|--monthly|--yearly]

Purpose:
  継続運用のために、現在の台帳状況と次に見るべき項目を表示する。
  データは変更しない。
`);
}

function parseArgs(argv) {
  const options = { mode: "weekly" };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--weekly") options.mode = "weekly";
    else if (arg === "--monthly") options.mode = "monthly";
    else if (arg === "--yearly") options.mode = "yearly";
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function daysSince(dateString) {
  if (!dateString) return null;
  const date = new Date(`${dateString}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  const now = new Date(`${todayIso()}T00:00:00Z`);
  return Math.floor((now.getTime() - date.getTime()) / 86_400_000);
}

function countCapabilities(cities) {
  const counts = Object.fromEntries(Object.keys(CAPABILITY_LABELS).map((key) => [key, 0]));
  for (const city of Object.values(cities)) {
    for (const key of Object.keys(counts)) {
      if (city.capabilities?.[key]) counts[key] += 1;
    }
  }
  return counts;
}

function line(item) {
  console.log(`- ${item}`);
}

function checklist(item) {
  console.log(`- [ ] ${item}`);
}

function printSnapshot({ municipalities, capabilityCounts, budgetSources }) {
  const activeMunicipalities = municipalities.filter((item) => item.active);
  const importedBudgets = budgetSources.filter((source) => source.status === "取込済み");
  const candidateBudgets = budgetSources.filter((source) => source.status === "取得候補");
  const unavailableMinutes = activeMunicipalities.filter((item) => item.minutes_status === "unavailable");
  const staleUnavailable = unavailableMinutes
    .map((item) => ({ ...item, days: daysSince(item.minutes_verified_at) }))
    .filter((item) => item.days == null || item.days >= 90)
    .sort((a, b) => (b.days ?? 9999) - (a.days ?? 9999));

  console.log("## Snapshot");
  line(`active municipalities: ${activeMunicipalities.length}`);
  for (const [key, label] of Object.entries(CAPABILITY_LABELS)) {
    line(`${label}: ${capabilityCounts[key] ?? 0}`);
  }
  line(`予算書 取込済み: ${importedBudgets.length}`);
  line(`予算書 取得候補: ${candidateBudgets.length}`);
  line(`議事録 unavailable: ${unavailableMinutes.length}`);
  line(`90日以上の再確認候補: ${staleUnavailable.length}`);

  if (candidateBudgets.length) {
    console.log("\n## Budget Candidates");
    for (const source of candidateBudgets) {
      line(`${source.slug} ${source.year}: ${source.source_label}`);
    }
  }

  if (staleUnavailable.length) {
    console.log("\n## Minutes Recheck Candidates");
    for (const item of staleUnavailable.slice(0, 15)) {
      const age = item.days == null ? "確認日なし" : `${item.days}日前`;
      line(`${item.slug}: ${item.name} (${age})`);
    }
    if (staleUnavailable.length > 15) {
      line(`...and ${staleUnavailable.length - 15} more`);
    }
  }
}

function printWeeklyChecklist() {
  console.log("\n## Weekly Checklist");
  checklist("node scripts/data-health.mjs --strict");
  checklist("docs/operations-board.md の Now / Next を見直す");
  checklist("直近追加した予算書・議事録・記事の出典URLを確認する");
  checklist("予算書候補から次にOCR取込する2件を選ぶ");
  checklist("更新情報に値する変更があれば site/data/news.json を追記する");
}

function printMonthlyChecklist() {
  console.log("\n## Monthly Checklist");
  checklist("未公開・再確認待ち自治体の確認日を見直す");
  checklist("docs/municipality-coverage.md を更新する");
  checklist("docs/municipality-information-inventory.md を更新する");
  checklist("予算書、議決結果、速報、議会だよりの候補を並べ替える");
  checklist("次の1か月で増やす自治体・予算・記事テーマを docs/operations-board.md に置く");
}

function printYearlyChecklist() {
  console.log("\n## Yearly Checklist");
  checklist("新年度予算書の主要都市公開状況を budget_sources.json に反映する");
  checklist("議員改選があった自治体の members.json と出典を確認する");
  checklist("主要スクレイパを小さく再実行して公式ページ構造変更を確認する");
  checklist("年度表記、記事、OGP、サイト内コピーに古い年度が残っていないか確認する");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const municipalities = await readJson(path.join(DATA_DIR, "municipalities.json"), []);
  const cityCapabilities = await readJson(path.join(SITE_DATA_DIR, "_city-capabilities.json"), { cities: {} });
  const budgetSources = await readJson(path.join(SITE_DATA_DIR, "budget_sources.json"), []);
  const capabilityCounts = countCapabilities(cityCapabilities.cities ?? {});

  console.log(`# operations check: ${options.mode}`);
  console.log(`date: ${todayIso()}`);
  console.log("");

  printSnapshot({
    municipalities: Array.isArray(municipalities) ? municipalities : [],
    capabilityCounts,
    budgetSources: Array.isArray(budgetSources) ? budgetSources : [],
  });

  if (options.mode === "weekly") printWeeklyChecklist();
  if (options.mode === "monthly") printMonthlyChecklist();
  if (options.mode === "yearly") printYearlyChecklist();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
