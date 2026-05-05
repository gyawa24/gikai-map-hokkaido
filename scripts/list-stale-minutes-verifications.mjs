#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const MUNICIPALITIES_PATH = path.join(REPO_ROOT, "data", "municipalities.json");

const DAY_MS = 24 * 60 * 60 * 1000;
const CADENCES = {
  missingDate: { days: 0, label: "日付未記録", reason: "minutes_verified_at がない" },
  likelyAvailable: { days: 30, label: "30日", reason: "会議録本文らしき公開物があるが未取込" },
  explicitOffline: { days: 180, label: "180日", reason: "Web未公開または窓口閲覧と明記" },
  defaultUnavailable: { days: 90, label: "90日", reason: "未公開確認済みの定期再確認" },
};

const LIKELY_AVAILABLE_RE = /会議録PDF|会議記録ページ|全文会議録PDF|一般質問.*PDF|掲載予定|取り込み未対応|自動取込困難|OCR|JavaScript|構造確認|ファイル名|多階層|新旧形式|要約|正式な会議録とは異なる/u;
const CLEARLY_NOT_AVAILABLE_RE = /会議録PDF.*(?:公開されていません|未確認)|会議録.*(?:見つかりません|確認できていません|未確認)/u;
const EXPLICIT_OFFLINE_RE = /インターネット公開は未実施|情報開示請求|議会図書室|図書館で閲覧|議会事務局.*閲覧/u;

function printHelp() {
  console.log(`Usage:
  node scripts/list-stale-minutes-verifications.mjs [options]

Options:
  --as-of <YYYY-MM-DD>   基準日。省略時は今日
  --all                  期限前も含めて全件を表示
  --json                 JSONで出力
  --help

Rules:
  - minutes_status=unavailable かつ minutes feature が無い自治体だけを見る
  - minutes_verified_at が無いものは即再確認
  - 会議録PDFあり/取込未対応/掲載予定/OCR等の候補は30日ごと
  - Web未公開や窓口閲覧と明記されたものは180日ごと
  - それ以外の未公開確認済みは90日ごと
`);
}

function parseArgs(argv) {
  const options = { all: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--all") {
      options.all = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--as-of") {
      options.asOf = argv[i + 1];
      if (!options.asOf || options.asOf.startsWith("--")) {
        throw new Error("--as-of requires YYYY-MM-DD");
      }
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function parseDate(value, label) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must be YYYY-MM-DD: ${value}`);
  }
  const date = new Date(`${value}T00:00:00+09:00`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${label} is invalid: ${value}`);
  }
  return date;
}

function todayInJapan() {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return parseDate(parts, "today");
}

function classify(entry) {
  const note = entry.minutes_status_note ?? "";
  if (!entry.minutes_verified_at) return CADENCES.missingDate;
  if (EXPLICIT_OFFLINE_RE.test(note)) return CADENCES.explicitOffline;
  if (LIKELY_AVAILABLE_RE.test(note) && !CLEARLY_NOT_AVAILABLE_RE.test(note)) {
    return CADENCES.likelyAvailable;
  }
  return CADENCES.defaultUnavailable;
}

function daysBetween(a, b) {
  return Math.floor((a.getTime() - b.getTime()) / DAY_MS);
}

function escapeCell(value) {
  return String(value ?? "—").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const asOf = options.asOf ? parseDate(options.asOf, "--as-of") : todayInJapan();
  const asOfText = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(asOf);
  const municipalities = JSON.parse(fs.readFileSync(MUNICIPALITIES_PATH, "utf8"));

  const rows = municipalities
    .filter((entry) => entry.minutes_status === "unavailable")
    .filter((entry) => !entry.features?.includes("minutes"))
    .map((entry) => {
      const cadence = classify(entry);
      const verifiedAt = parseDate(entry.minutes_verified_at, `${entry.slug}.minutes_verified_at`);
      const ageDays = verifiedAt ? daysBetween(asOf, verifiedAt) : null;
      const due = ageDays == null || ageDays >= cadence.days;
      return {
        slug: entry.slug,
        name: entry.name,
        region: entry.region,
        verifiedAt: entry.minutes_verified_at ?? null,
        ageDays,
        cadenceDays: cadence.days,
        cadenceLabel: cadence.label,
        reason: cadence.reason,
        due,
        overdueDays: ageDays == null ? null : ageDays - cadence.days,
        note: entry.minutes_status_note ?? "",
      };
    })
    .filter((row) => options.all || row.due)
    .sort((a, b) => {
      if (a.due !== b.due) return a.due ? -1 : 1;
      if (a.overdueDays == null && b.overdueDays != null) return -1;
      if (a.overdueDays != null && b.overdueDays == null) return 1;
      if ((b.overdueDays ?? -Infinity) !== (a.overdueDays ?? -Infinity)) {
        return (b.overdueDays ?? -Infinity) - (a.overdueDays ?? -Infinity);
      }
      return (a.verifiedAt ?? "").localeCompare(b.verifiedAt ?? "") || a.slug.localeCompare(b.slug);
    });

  if (options.json) {
    console.log(JSON.stringify({ asOf: asOfText, count: rows.length, rows }, null, 2));
    return;
  }

  console.log(`# 議事録未公開の再確認候補`);
  console.log("");
  console.log(`基準日: ${asOfText}`);
  console.log(`対象: ${rows.length}件${options.all ? "（期限前を含む）" : ""}`);
  console.log("");
  console.log("| due | 地域 | 自治体 | slug | 確認日 | 経過 | 間隔 | 理由 | メモ |");
  console.log("|---|---|---|---|---|---:|---:|---|---|");
  for (const row of rows) {
    console.log(
      `| ${row.due ? "要確認" : "期限前"} | ${escapeCell(row.region)} | ${escapeCell(row.name)} | ${escapeCell(row.slug)} | ${escapeCell(row.verifiedAt)} | ${row.ageDays ?? "—"} | ${escapeCell(row.cadenceLabel)} | ${escapeCell(row.reason)} | ${escapeCell(row.note)} |`
    );
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
