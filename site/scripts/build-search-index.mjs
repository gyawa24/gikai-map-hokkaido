#!/usr/bin/env node
// 議事録本文を議題単位で集約した軽量な全文検索インデックスを生成する。
//
// 目的: Vercel の Serverless Function 250MB 制限で /api/search bundle に
//       data/*/minutes/*.json (202MB) を含められないため、build 時に全
//       議事録を議題単位で truncate して 1 ファイルに纏める。/api/search
//       はそのインデックス 1 本だけを読めば議題横断の全文検索ができる。
//
// 出力: site/data/_search-index.json (~4-5 MB)
// 構造: { version: 1, generated_at, agendas: [ { city, council_id, ... } ] }
//
// 実行: `npm run build-search-index` または `npm run build` の prebuild で自動実行

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(SITE_DIR, "data");
const OUT_FILE = path.join(DATA_DIR, "_search-index.json");

const AGENDA_MARKER = "△議題";
const DISCUSSION_TYPES = new Set([
  "◆質問",
  "◎答弁",
  "◎市長",
  "○一般質問",
]);
const EXCERPT_MAX = 500;

function cleanText(s) {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

function getCityName(municipalities, slug) {
  const m = municipalities.find((x) => x.slug === slug);
  return m?.name ?? slug;
}

function buildIndex() {
  const municipalitiesPath = path.join(DATA_DIR, "municipalities.json");
  const municipalities = JSON.parse(fs.readFileSync(municipalitiesPath, "utf-8"));

  /** @type {Array<object>} */
  const agendas = [];

  const cityDirs = fs
    .readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
    .map((d) => d.name);

  for (const city of cityDirs) {
    const cityName = getCityName(municipalities, city);
    const minutesDir = path.join(DATA_DIR, city, "minutes");
    const indexPath = path.join(minutesDir, "index.json");
    if (!fs.existsSync(indexPath)) continue;

    let councilIndex;
    try {
      councilIndex = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
    } catch {
      continue;
    }

    for (const entry of councilIndex) {
      const councilFile = path.join(minutesDir, entry.file);
      if (!fs.existsSync(councilFile)) continue;
      let council;
      try {
        council = JSON.parse(fs.readFileSync(councilFile, "utf-8"));
      } catch {
        continue;
      }

      const councilId = council.council_id ?? entry.council_id;
      const councilName = council.name ?? entry.name;

      for (let schIdx = 0; schIdx < (council.schedules ?? []).length; schIdx++) {
        const sch = council.schedules[schIdx];
        let currentAgendaTitle = null;
        let currentAgendaBody = [];
        let currentFirstMinuteId = null;
        const schName = sch.name ?? "";

        const flush = () => {
          if (!currentAgendaTitle && currentAgendaBody.length === 0) return;
          const body = currentAgendaBody.join(" ");
          agendas.push({
            city,
            cityName,
            council_id: councilId,
            council_name: councilName,
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
    }
  }

  const out = {
    version: 1,
    generated_at: new Date().toISOString(),
    excerpt_max: EXCERPT_MAX,
    count: agendas.length,
    agendas,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(out));
  const stat = fs.statSync(OUT_FILE);
  console.log(
    `search-index written: ${OUT_FILE.replace(SITE_DIR, "site")} (${agendas.length} agendas, ${(stat.size / 1024 / 1024).toFixed(1)} MB)`
  );
}

buildIndex();
