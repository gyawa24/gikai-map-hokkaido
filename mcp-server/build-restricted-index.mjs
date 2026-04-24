#!/usr/bin/env node
// minutes_access: "restricted" の自治体だけを対象にした MCP 専用検索インデックスを生成する。
//
// 目的: 札幌市のように著作権ポリシー上 chihougikai.com で公開していない自治体を、
//       個人利用の MCP（stdio）からは検索可能にしたい。サイト本体の
//       site/data/_search-index.json には決して混ざらないよう出力先を分離する。
//
// 出力: mcp-server/_restricted-index.json（公開ビルドからは独立）
// 形式: site/scripts/build-search-index.mjs と同じ agendas[] のサブセット。
//        ただし dnp と異なり gijiroku_com は 1 schedule = 1 巨大テキスト構造のため、
//        agenda 単位の分割ができない。schedule 全体を 1 agenda として索引化する。
//
// 実行: `npm run build-restricted-index` （mcp-server ディレクトリで）

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SITE_DATA_DIR = path.join(ROOT, "site", "data");
const RAW_DATA_DIR = path.join(ROOT, "data");
const OUT_FILE = path.join(__dirname, "_restricted-index.json");

const AGENDA_MARKER = "△議題";
const DISCUSSION_TYPES = new Set(["◆質問", "◎答弁", "◎市長", "○一般質問"]);
const EXCERPT_MAX = 500;
const GIJIROKU_TEXT_MAX = 20000; // 1 schedule の text を index に丸ごと入れる上限

function cleanText(s) {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

function dataDirFor(slug) {
  // site/data 側に揃っていればそれを優先（公開ビルド済みのデータ整形を流用）
  const sitePath = path.join(SITE_DATA_DIR, slug, "minutes");
  if (fs.existsSync(path.join(sitePath, "index.json"))) return sitePath;
  return path.join(RAW_DATA_DIR, slug, "minutes");
}

function readMunicipalities() {
  const p = fs.existsSync(path.join(SITE_DATA_DIR, "municipalities.json"))
    ? path.join(SITE_DATA_DIR, "municipalities.json")
    : path.join(RAW_DATA_DIR, "municipalities.json");
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function buildAgendasDnp(city, cityName, council, councilId, councilName, year) {
  const agendas = [];
  for (let schIdx = 0; schIdx < (council.schedules ?? []).length; schIdx++) {
    const sch = council.schedules[schIdx];
    const schName = sch.name ?? "";
    let currentAgendaTitle = null;
    let currentAgendaBody = [];
    let currentFirstMinuteId = null;

    const flush = () => {
      if (!currentAgendaTitle && currentAgendaBody.length === 0) return;
      const body = currentAgendaBody.join(" ");
      agendas.push({
        city,
        cityName,
        council_id: councilId,
        council_name: councilName,
        year,
        schedule_index: schIdx,
        schedule_name: schName,
        agenda_title: currentAgendaTitle ?? "",
        first_minute_id: currentFirstMinuteId,
        text: body.slice(0, EXCERPT_MAX),
        truncated: body.length > EXCERPT_MAX,
      });
    };

    for (const m of sch.minutes ?? []) {
      if (m.minute_type === "名簿") continue;
      if (m.minute_type === AGENDA_MARKER) {
        flush();
        currentAgendaTitle = cleanText(m.text).replace(/^△/, "");
        currentAgendaBody = [];
        currentFirstMinuteId = m.minute_id ?? null;
      } else if (DISCUSSION_TYPES.has(m.minute_type)) {
        if (currentFirstMinuteId === null) currentFirstMinuteId = m.minute_id ?? null;
        const speaker = m.title ? `${m.title}: ` : "";
        currentAgendaBody.push(speaker + cleanText(m.text));
      }
    }
    flush();
  }
  return agendas;
}

function buildAgendasGijiroku(city, cityName, council, councilId, councilName, year) {
  // gijiroku_com 形式: schedule.minutes は通常 1 件で、その text に当該日の全文が入る。
  // 議題マーカーが無いので schedule 全体を 1 agenda として索引化する。
  const agendas = [];
  for (let schIdx = 0; schIdx < (council.schedules ?? []).length; schIdx++) {
    const sch = council.schedules[schIdx];
    const schName = sch.name ?? "";
    const minutes = sch.minutes ?? [];
    const text = minutes.map((m) => cleanText(m.text)).join(" ");
    if (!text) continue;
    agendas.push({
      city,
      cityName,
      council_id: councilId,
      council_name: councilName,
      year,
      schedule_index: schIdx,
      schedule_name: schName,
      agenda_title: schName, // schedule 全体が 1 agenda 相当なので名前を流用
      first_minute_id: minutes[0]?.minute_id ?? null,
      text: text.slice(0, GIJIROKU_TEXT_MAX),
      truncated: text.length > GIJIROKU_TEXT_MAX,
    });
  }
  return agendas;
}

function buildIndex() {
  const municipalities = readMunicipalities();
  const restricted = municipalities.filter((m) => m.minutes_access === "restricted");
  if (restricted.length === 0) {
    console.log("no restricted municipalities; skipping write");
    return;
  }

  const agendas = [];
  const cityCounts = {};

  for (const m of restricted) {
    const minutesDir = dataDirFor(m.slug);
    const indexPath = path.join(minutesDir, "index.json");
    if (!fs.existsSync(indexPath)) {
      console.warn(`skip ${m.slug}: ${indexPath} not found`);
      continue;
    }
    const councilIndex = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
    const builder =
      m.system === "gijiroku_com" ? buildAgendasGijiroku : buildAgendasDnp;

    for (const entry of councilIndex) {
      const fp = path.join(minutesDir, entry.file);
      if (!fs.existsSync(fp)) continue;
      const council = JSON.parse(fs.readFileSync(fp, "utf-8"));
      const councilId = council.council_id ?? entry.council_id;
      const councilName = council.name ?? entry.name;
      const year = entry.year || council.year || "";
      const before = agendas.length;
      agendas.push(...builder(m.slug, m.name, council, councilId, councilName, year));
      cityCounts[m.slug] = (cityCounts[m.slug] ?? 0) + (agendas.length - before);
    }
  }

  const out = {
    version: 1,
    generated_at: new Date().toISOString(),
    excerpt_max_dnp: EXCERPT_MAX,
    excerpt_max_gijiroku: GIJIROKU_TEXT_MAX,
    count: agendas.length,
    by_city: cityCounts,
    agendas,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(out));
  const stat = fs.statSync(OUT_FILE);
  console.log(
    `restricted-index written: ${OUT_FILE.replace(ROOT, "")} ` +
      `(${agendas.length} agendas across ${Object.keys(cityCounts).length} cities, ` +
      `${(stat.size / 1024 / 1024).toFixed(1)} MB)`
  );
  console.log("by_city:", cityCounts);
}

buildIndex();
