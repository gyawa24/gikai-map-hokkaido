#!/usr/bin/env node
/**
 * セッションindex.jsonに speakers[] を追加するスクリプト
 * transcript テキストから議員名（苗字＋委員/議員）を抽出する
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");

// 対象都市（sessionsデータがある都市）
const CITIES = ["chitose"];

function extractSpeakers(sessionJson, memberLastnames) {
  const found = new Set();
  for (const seg of sessionJson.segments ?? []) {
    const text = seg.transcript ?? "";
    for (const ln of memberLastnames) {
      const pattern = new RegExp(ln + "(?:委員|議員|委員長)", "g");
      if (pattern.test(text)) {
        found.add(ln);
      }
    }
  }
  return [...found].sort();
}

function getMemberLastnames(city) {
  const fp = path.join(DATA_DIR, city, "members.json");
  if (!fs.existsSync(fp)) return [];
  const members = JSON.parse(fs.readFileSync(fp, "utf-8"));
  // 苗字（スペース前）を抽出
  return members.map((m) => m.name.split(/[\s　]/)[0]).filter(Boolean);
}

for (const city of CITIES) {
  const indexPath = path.join(DATA_DIR, city, "sessions", "index.json");
  if (!fs.existsSync(indexPath)) {
    console.log(`[${city}] index.json not found, skip`);
    continue;
  }

  const memberLastnames = getMemberLastnames(city);
  console.log(`[${city}] members: ${memberLastnames.join(", ")}`);

  const index = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
  let updated = 0;

  for (const entry of index) {
    const sessionPath = path.join(DATA_DIR, city, "sessions", `${entry.id}.json`);
    if (!fs.existsSync(sessionPath)) continue;

    const session = JSON.parse(fs.readFileSync(sessionPath, "utf-8"));
    const speakers = extractSpeakers(session, memberLastnames);

    if (speakers.length > 0) {
      entry.speakers = speakers;
      console.log(`  ${entry.id}: ${speakers.join(", ")}`);
      updated++;
    } else {
      entry.speakers = [];
    }
  }

  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf-8");
  console.log(`[${city}] Done. ${updated}/${index.length} sessions have speakers.`);
}
