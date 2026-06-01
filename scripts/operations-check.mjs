#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { minutesVerificationCategory } from "./lib/minutes-verification-categories.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(REPO_ROOT, "data");
const SITE_DATA_DIR = path.join(REPO_ROOT, "site", "data");
const SITE_ROOT = path.join(REPO_ROOT, "site");

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
  node scripts/operations-check.mjs [--weekly|--monthly|--yearly|--cloudflare]

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
    else if (arg === "--cloudflare") options.mode = "cloudflare";
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
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
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

function runJson(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    throw new Error(output || `${command} ${args.join(" ")} failed`);
  }

  return JSON.parse(result.stdout);
}

function shortUrlStatus(status) {
  if (!status?.ok) return `failed (${status?.error ?? "unknown"})`;
  const server = status.server ? ` ${status.server}` : "";
  return `${status.status}${server}`.trim();
}

function firstDeploymentDetail(output) {
  return String(output ?? "")
    .split("\n")
    .map((item) => item.trim())
    .find((item) => item.startsWith("Version(s):") || item.startsWith("Created:"));
}

function printSnapshot({ municipalities, capabilityCounts, budgetSources }) {
  const activeMunicipalities = municipalities.filter((item) => item.active);
  const importedBudgets = budgetSources.filter((source) => source.status === "取込済み");
  const candidateBudgets = budgetSources.filter((source) => source.status === "取得候補");
  const heldBudgets = budgetSources.filter((source) => source.status === "保留");
  const unavailableMinutes = activeMunicipalities.filter((item) => item.minutes_status === "unavailable");
  const recheckWaitMinutes = unavailableMinutes.filter(
    (item) => minutesVerificationCategory(item.slug).id === "recheck"
  );
  const ocrWaitMinutes = unavailableMinutes.filter(
    (item) => minutesVerificationCategory(item.slug).id === "ocr"
  );
  const altFeatureMinutes = unavailableMinutes.filter(
    (item) => minutesVerificationCategory(item.slug).id === "alt-feature"
  );
  const staleRecheckWait = recheckWaitMinutes
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
  line(`予算書 保留: ${heldBudgets.length}`);
  line(`議事録 unavailable: ${unavailableMinutes.length}`);
  line(`議事録 再確認待ち: ${recheckWaitMinutes.length}`);
  line(`議事録 OCR待ち: ${ocrWaitMinutes.length}`);
  line(`議事録 別feature候補: ${altFeatureMinutes.length}`);
  line(`90日以上の再確認候補: ${staleRecheckWait.length}`);

  if (candidateBudgets.length) {
    console.log("\n## Budget Candidates");
    for (const source of candidateBudgets) {
      line(`${source.slug} ${source.year}: ${source.source_label}`);
    }
  }

  if (heldBudgets.length) {
    console.log("\n## Budget Holds");
    for (const source of heldBudgets) {
      line(`${source.slug} ${source.year}: ${source.note}`);
    }
  }

  if (staleRecheckWait.length) {
    console.log("\n## Minutes Recheck Candidates");
    for (const item of staleRecheckWait.slice(0, 15)) {
      const age = item.days == null ? "確認日なし" : `${item.days}日前`;
      line(`${item.slug}: ${item.name} (${age})`);
    }
    if (staleRecheckWait.length > 15) {
      line(`...and ${staleRecheckWait.length - 15} more`);
    }
  }
}

function printWeeklyChecklist() {
  console.log("\n## Weekly Checklist");
  checklist("node scripts/data-health.mjs --strict");
  checklist("cd site && npm run cf:post-cutover-check");
  checklist("docs/operations-board.md の Now / Next を見直す");
  checklist("直近追加した予算書・議事録・記事の出典URLを確認する");
  checklist("予算書候補から次にOCR取込する2件を選ぶ");
  checklist("Search Console URL-prefix property `https://chihougikai.com/` で検索パフォーマンスとサイトマップを確認する");
  checklist("更新情報に値する変更があれば site/data/news.json を追記する");
}

function printMonthlyChecklist() {
  console.log("\n## Monthly Checklist");
  checklist("node scripts/data-health.mjs --strict");
  checklist("cd site && npm run cf:post-cutover-check");
  checklist("Cloudflare Dashboard で Workers requests / CPU time / Static Assets の増加を確認する");
  checklist("Search Console URL-prefix property `https://chihougikai.com/` でページ、サイトマップ、検索パフォーマンスを確認する");
  checklist("未公開・再確認待ち自治体の確認日を見直す");
  checklist("docs/municipality-coverage.md を更新する");
  checklist("docs/municipality-information-inventory.md を更新する");
  checklist("budget_sources.json の 取得候補 / 取込済み / 保留 を実データと照合する");
  checklist("予算書、議決結果、速報、議会だより、別feature候補を並べ替える");
  checklist("site/data/news.json と /news が公開済み変更と合っているか確認する");
  checklist("Vercel rollback を残す必要があるか、Cloudflare metrics と Search Console の結果で判断する");
  checklist("今月追加した公開データ、直した台帳、保留理由、来月の Now 1〜3件を docs/operations-board.md に残す");
}

function printYearlyChecklist() {
  console.log("\n## Yearly Checklist");
  checklist("Cloudflare / GitHub Raw / Vercel rollback の役割が現状と合っているか確認する");
  checklist("新年度予算書の主要都市公開状況を budget_sources.json に反映する");
  checklist("議員改選があった自治体の members.json と出典を確認する");
  checklist("主要スクレイパを小さく再実行して公式ページ構造変更を確認する");
  checklist("年度表記、記事、OGP、サイト内コピーに古い年度が残っていないか確認する");
}

function printCloudflareChecklist() {
  console.log("\n## Cloudflare Checklist");
  checklist("cd site && npm run cf:post-cutover-check");
  checklist("Search Console URL-prefix property `https://chihougikai.com/` のページ、サイトマップ、検索パフォーマンスを見る");
  checklist("Cloudflare Dashboard の Workers requests / CPU time / Static Assets を見る");
  checklist("異常や判断があれば docs/cloudflare-release-log.md に短く残す");
  checklist("数日安定したら Vercel rollback を残す範囲を整理する");
}

function printCloudflareSnapshot(status) {
  const workerDetail = firstDeploymentDetail(status.worker_deployment?.output);
  const publicNs = status.public_resolver_ns ?? [];
  const publicResolverSummary = publicNs
    .map((record) => `${record.resolver_label}:${record.nameserver_status}`)
    .join(", ");
  const productionOk =
    status.nameserver_status === "cloudflare_nameservers" &&
    status.public_nameserver_status === "cloudflare_nameservers" &&
    status.urls?.production?.ok &&
    status.urls.production.status === 200 &&
    status.urls.production.server?.toLowerCase().includes("cloudflare") &&
    status.urls?.www?.ok &&
    status.urls.www.status === 200 &&
    status.urls.www.server?.toLowerCase().includes("cloudflare") &&
    status.worker_deployment?.ok;

  console.log("\n## Cloudflare Snapshot");
  line(`domain: ${status.domain}`);
  line(`nameserver status: ${status.nameserver_status}`);
  line(`public resolver status: ${status.public_nameserver_status}`);
  if (publicResolverSummary) line(`public resolvers: ${publicResolverSummary}`);
  line(`production: ${shortUrlStatus(status.urls?.production)}`);
  line(`www: ${shortUrlStatus(status.urls?.www)}`);
  line(`workers.dev: ${shortUrlStatus(status.urls?.workers)}`);
  line(`Worker deployment: ${status.worker_deployment?.ok ? "ok" : "not ready"}`);
  if (workerDetail) line(`Worker deployment detail: ${workerDetail}`);
  line(`verified deploy URL: ${status.verified_deploy_url ?? "not ready"}`);
  line(`judgement: ${productionOk ? "public host is on Cloudflare" : "needs attention"}`);
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
  if (options.mode === "cloudflare") {
    const cloudflareStatus = runJson("node", ["scripts/cloudflare-dns-status.mjs", "--json"], {
      cwd: SITE_ROOT,
    });
    printCloudflareSnapshot(cloudflareStatus);
    printCloudflareChecklist();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
