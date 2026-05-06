#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = process.cwd();
const DATA_DIR = path.join(REPO_ROOT, "data");
const DOC_PATH = path.join(REPO_ROOT, "docs", "municipality-information-inventory.md");

const OCR_WAIT = new Set(["shosanbetsu", "yubetsu"]);

const RECHECK_WAIT = new Set([
  "kamikawa",
  "ikeda",
  "nakagawa",
  "naganuma",
  "shimamaki",
  "suttsu",
  "kuromatsunai",
  "kimobetsu",
  "kyogoku",
  "kyowa",
  "tomari",
  "kamoenai",
  "shakotan",
  "samani",
  "erimo",
  "shikabe",
  "otobe",
  "okushiri",
  "takasu",
  "higashikagura",
  "pippu",
  "nakafurano",
  "wassamu",
  "otoineppu",
  "mashike",
  "obira",
  "tomamae",
  "hamatombetsu",
  "rebun",
  "rishiri",
  "rishirifuji",
  "shari",
  "okoppe",
  "nishiokoppe",
  "teshikaga",
  "tsurui",
  "shiranuka",
  "shibetsucho",
]);

const ALT_FEATURES = new Map([
  ["nakashibetsu", "一般質問・委員会代表質問PDF"],
  ["sarufutsu", "一般質問PDF"],
  ["kaminokuni", "一般質問の質問・答弁要旨"],
  ["toma", "一般質問と答弁"],
  ["minamifurano", "会議結果・一般質問"],
  ["shinshinotsu", "議決結果・一般質問"],
  ["aibetsu", "一般質問動画"],
  ["omu", "一般質問単位の議事録"],
  ["saroma", "令和2年までの古い会議録"],
  ["takinoue", "会議結果・議会広報・瓦版"],
  ["teshio", "議会だより・視察研修報告書"],
  ["kenbuchi", "議会だより・YouTube配信・議会情報"],
  ["rusutsu", "議事日程・議決結果・議会活動"],
  ["iwanai", "議事日程・議会だより・一般質問順序表"],
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function exists(filePath) {
  return fs.existsSync(filePath);
}

function hasNonEmptyArrayJson(filePath) {
  if (!exists(filePath)) return false;
  try {
    const data = readJson(filePath);
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

function hasNonEmptyObjectJson(filePath) {
  if (!exists(filePath)) return false;
  try {
    const data = readJson(filePath);
    return Boolean(data && typeof data === "object" && Object.keys(data).length > 0);
  } catch {
    return false;
  }
}

function hasMinutesData(cityDir) {
  return hasNonEmptyArrayJson(path.join(cityDir, "minutes", "index.json")) || hasNonEmptyArrayJson(path.join(cityDir, "index.json"));
}

function hasSegmentsData(cityDir) {
  return hasNonEmptyArrayJson(path.join(cityDir, "segments", "_index.json"));
}

function hasThemesData(cityDir) {
  return hasNonEmptyObjectJson(path.join(cityDir, "members_activity.json"));
}

function mark(value) {
  return value ? "○" : "—";
}

function escapeCell(value) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replace(/\s+/g, " ")
    .trim();
}

function systemLabel(system) {
  switch (system) {
    case "dnp":
      return "DNP系";
    case "gijiroku_com":
      return "gijiroku.com系";
    case "pdf_inhouse":
      return "PDF自前";
    case "html_inhouse":
      return "HTML自前";
    default:
      return "独自/未分類";
  }
}

function collectOtherInfo(files) {
  const labels = [];
  if (files.election) labels.push("選挙");
  if (files.decisions) labels.push("議決");
  if (files.schedule) labels.push("行事");
  if (files.newsletter) labels.push("だより");
  if (files.plan) labels.push("総合計画");
  return labels.length > 0 ? labels.join("・") : "—";
}

function hasFeature(entry, feature) {
  return Array.isArray(entry.features) && entry.features.includes(feature);
}

function minutesState(entry, files) {
  if (files.minutes) return "掲載中";
  if (OCR_WAIT.has(entry.slug)) return "OCR待ち";
  if (ALT_FEATURES.has(entry.slug)) return "別feature候補";
  if (RECHECK_WAIT.has(entry.slug)) return "再確認待ち";
  if (entry.minutes_status === "unavailable") return "未公開確認済み";
  return "未分類";
}

function publicationMethod(entry, files) {
  if (files.minutes) return systemLabel(entry.system);
  if (OCR_WAIT.has(entry.slug)) return "画像PDF";
  if (ALT_FEATURES.has(entry.slug)) return ALT_FEATURES.get(entry.slug);
  if (RECHECK_WAIT.has(entry.slug)) return "Web本文未確認";
  return entry.minutes_status === "unavailable" ? "Web本文未確認" : "未確認";
}

function scrapePolicy(entry, files) {
  if (files.minutes) {
    if (entry.system === "dnp" || entry.system === "gijiroku_com") return "共通系で再取得";
    if (entry.system === "pdf_inhouse") return "PDF戦略で再取得";
    if (entry.system === "html_inhouse") return "HTML戦略で再取得";
    return "既存scraperで再取得";
  }
  if (OCR_WAIT.has(entry.slug)) return "OCR下書き・原文照合";
  if (ALT_FEATURES.has(entry.slug)) return "minutesと分離して設計";
  if (RECHECK_WAIT.has(entry.slug)) return "90日再確認";
  return "要確認";
}

function nextAction(entry, files) {
  if (files.minutes) return "定期更新";
  if (OCR_WAIT.has(entry.slug)) return "公開昇格は保留";
  if (ALT_FEATURES.has(entry.slug)) return "別feature候補へ分類";
  if (RECHECK_WAIT.has(entry.slug)) return "次回確認日で再調査";
  return "分類見直し";
}

function buildRow(entry) {
  const cityDir = path.join(DATA_DIR, entry.slug);
  const files = {
    members: exists(path.join(cityDir, "members.json")),
    minutes: hasMinutesData(cityDir),
    segments: hasSegmentsData(cityDir),
    themes: hasThemesData(cityDir),
    sessionsData: exists(path.join(cityDir, "sessions", "index.json")),
    sessionsFeature: hasFeature(entry, "sessions"),
    election: exists(path.join(cityDir, "election.json")),
    decisions: exists(path.join(cityDir, "decisions.json")),
    schedule: exists(path.join(cityDir, "schedule.json")),
    newsletter: exists(path.join(cityDir, "newsletter.json")),
    plan: exists(path.join(cityDir, "comprehensive_plan.json")),
  };

  return {
    region: entry.region,
    name: entry.name,
    slug: entry.slug,
    files,
    minutesState: minutesState(entry, files),
    method: publicationMethod(entry, files),
    scrapePolicy: scrapePolicy(entry, files),
    otherInfo: collectOtherInfo(files),
    nextAction: nextAction(entry, files),
    verifiedAt: entry.minutes_verified_at ?? "—",
  };
}

function count(rows, predicate) {
  return rows.filter(predicate).length;
}

function main() {
  const municipalities = readJson(path.join(DATA_DIR, "municipalities.json"))
    .filter((entry) => entry.active)
    .sort((a, b) => a.region.localeCompare(b.region, "ja") || a.name.localeCompare(b.name, "ja"));
  const rows = municipalities.map(buildRow);

  const generatedDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const lines = [];
  lines.push("# 全市町村情報整理表");
  lines.push("");
  lines.push(`生成日: ${generatedDate}`);
  lines.push("");
  lines.push("北海道179市町村 + 北海道議会について、速報ではなく市民が後から参照できる議会情報を中心に整理するための棚卸し。");
  lines.push("");
  lines.push("## 基本方針");
  lines.push("");
  lines.push("- `minutes`: 正式な本会議会議録本文だけを入れる。一般質問要旨、議会だより、議決結果、会議結果は混ぜない。");
  lines.push("- `sessions`: 速報・会議単位の補助情報。今後の全道展開では優先度を下げる。");
  lines.push("- `themes`: `minutes` から作る議員活動・テーマ別データ。議事録がある自治体の主要な次段階。");
  lines.push("- 会議録の公開時期は議会ごとに異なり、会議後2〜3か月以上かかる場合もある。再確認待ちの90日は公式期限ではなく、見落としを減らすための運用上の見回り間隔とする。");
  lines.push("- OCR由来データは下書きに隔離し、原文照合と誤認識評価を通るまで公開用 `minutes` に昇格しない。");
  lines.push("- 一般質問、議決結果、議会だより、要約資料は別feature候補として設計する。");
  lines.push("");
  lines.push("## サマリー");
  lines.push("");
  lines.push(`- 対象: ${rows.length}`);
  lines.push(`- 議員一覧: ${count(rows, (row) => row.files.members)}`);
  lines.push(`- 議事録: ${count(rows, (row) => row.files.minutes)}`);
  lines.push(`- segments: ${count(rows, (row) => row.files.segments)}`);
  lines.push(`- themes: ${count(rows, (row) => row.files.themes)}`);
  lines.push(`- 速報系 sessions feature: ${count(rows, (row) => row.files.sessionsFeature)}`);
  lines.push(`- 速報系 sessions 実データ: ${count(rows, (row) => row.files.sessionsData)}`);
  lines.push(`- 速報系 sessions metadata/data 要整理: ${count(rows, (row) => row.files.sessionsFeature !== row.files.sessionsData)}`);
  lines.push(`- その他featureあり: ${count(rows, (row) => row.otherInfo !== "—")}`);
  lines.push(`- 議事録未掲載: ${count(rows, (row) => !row.files.minutes)}`);
  lines.push(`- 再確認待ち: ${count(rows, (row) => row.minutesState === "再確認待ち")}`);
  lines.push(`- OCR待ち: ${count(rows, (row) => row.minutesState === "OCR待ち")}`);
  lines.push(`- 別feature候補: ${count(rows, (row) => row.minutesState === "別feature候補")}`);
  lines.push("");
  lines.push("## 別feature候補の入口");
  lines.push("");
  lines.push("| 候補 | 用途 | minutes に混ぜない理由 |");
  lines.push("|---|---|---|");
  lines.push("| `general_questions` | 一般質問・質問答弁要旨・質問者別PDF | 本会議全文ではなく、範囲や編集粒度が自治体ごとに違う |");
  lines.push("| `votes` | 議決結果・議案賛否 | 発言本文ではなく意思決定データ |");
  lines.push("| `meeting_summaries` | 会議結果・概要・議事日程 | 会議録本文ではなく要約/予定/結果情報 |");
  lines.push("| `newsletters` | 議会だより・瓦版 | 広報編集済み資料で、原文議事録とは性格が違う |");
  lines.push("| `videos` | YouTube配信・録画 | テキスト本文化や発言者分割とは別工程 |");
  lines.push("");
  lines.push("## 市町村別テーブル");
  lines.push("");
  lines.push("| 地域 | 自治体 | slug | 議員 | 議事録 | themes | 速報feature | 速報data | その他 | 議事録状態 | 公開/取得方法 | スクレイピング方針 | 確認日 | 次の扱い |");
  lines.push("|---|---|---|---:|---:|---:|---:|---:|---|---|---|---|---|---|");
  for (const row of rows) {
    lines.push(
      `| ${escapeCell(row.region)} | ${escapeCell(row.name)} | ${escapeCell(row.slug)} | ${mark(row.files.members)} | ${mark(row.files.minutes)} | ${mark(row.files.themes)} | ${mark(row.files.sessionsFeature)} | ${mark(row.files.sessionsData)} | ${escapeCell(row.otherInfo)} | ${escapeCell(row.minutesState)} | ${escapeCell(row.method)} | ${escapeCell(row.scrapePolicy)} | ${escapeCell(row.verifiedAt)} | ${escapeCell(row.nextAction)} |`
    );
  }
  lines.push("");
  lines.push("## 生成元");
  lines.push("");
  lines.push("- `data/municipalities.json`");
  lines.push("- `data/{slug}/members.json`");
  lines.push("- `data/{slug}/minutes/index.json`");
  lines.push("- `data/{slug}/segments/_index.json`");
  lines.push("- `data/{slug}/members_activity.json`");
  lines.push("- `docs/minutes-expansion-candidates.md` の分類方針");

  fs.writeFileSync(DOC_PATH, `${lines.join("\n")}\n`, "utf-8");
  console.log(`wrote ${path.relative(REPO_ROOT, DOC_PATH)}`);
}

main();
