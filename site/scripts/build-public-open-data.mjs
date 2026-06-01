#!/usr/bin/env node
// 公開オープンデータとしてそのまま配信できる静的ファイルを生成する。
// Cloudflare では CSV ダウンロードのためだけに Worker API を動かさない。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(SITE_DIR, "data");
const OUT_DIR = path.join(SITE_DIR, "public", "generated", "open-data", "members");

const HEADERS = [
  "seat_number",
  "name",
  "furigana",
  "party",
  "faction",
  "committees",
  "votes",
  "photo_url",
];

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function memberRow(member) {
  return [
    csvEscape(member.seat_number),
    csvEscape(member.name),
    csvEscape(member.furigana),
    csvEscape(member.party ?? ""),
    csvEscape(member.faction ?? ""),
    csvEscape((member.committees ?? []).join(" / ")),
    csvEscape(member.votes ?? ""),
    csvEscape(member.photo_url ?? ""),
  ].join(",");
}

function buildMembersCsv() {
  const municipalities = readJson(path.join(DATA_DIR, "municipalities.json"), []);
  if (!Array.isArray(municipalities)) {
    throw new Error("municipalities.json is not an array");
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  let written = 0;

  for (const municipality of municipalities) {
    if (!municipality?.active || !municipality.slug) continue;
    const members = readJson(path.join(DATA_DIR, municipality.slug, "members.json"), []);
    if (!Array.isArray(members) || members.length === 0) continue;

    const body = "\uFEFF" + [HEADERS.join(","), ...members.map(memberRow)].join("\n");
    fs.writeFileSync(path.join(OUT_DIR, `${municipality.slug}.csv`), body);
    written += 1;
  }

  console.log(
    `open-data members CSV written: ${path.relative(SITE_DIR, OUT_DIR)} (${written} cities)`
  );
}

buildMembersCsv();
