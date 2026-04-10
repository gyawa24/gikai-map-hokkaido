#!/usr/bin/env node
/**
 * enriched議事録データから議員ごとの活動履歴を生成するスクリプト
 *
 * 使い方:
 *   node scripts/build-member-activity.mjs --city chitose
 *
 * 出力:
 *   data/{city}/members_activity.json
 *   site/data/{city}/members_activity.json
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const SITE_ROOT = path.resolve(__dirname, "..");

const city = process.argv[process.argv.indexOf("--city") + 1] ?? "chitose";

const dataDir = path.join(ROOT, "data", city);
const siteDataDir = path.join(SITE_ROOT, "data", city);
const enrichedDir = path.join(dataDir, "minutes", "enriched");

// --- メンバー読み込み ---
const members = JSON.parse(fs.readFileSync(path.join(dataDir, "members.json"), "utf-8"));
const memberNames = members.map((m) => m.name.replace(/\s/g, ""));

// --- 名寄せ関数 ---
function normalizeQuestioner(raw) {
  return raw
    .replace(/[　\s]/g, "")
    .replace(/(委員|議員|議長|副議長)$/, "")
    .trim();
}

function findMember(raw) {
  const normalized = normalizeQuestioner(raw);
  if (!normalized) return null;

  // 1. 完全一致
  const exact = memberNames.findIndex((n) => n === normalized);
  if (exact !== -1) return memberNames[exact];

  // 2. 姓のみ（2文字以下）の場合は姓で前方一致
  if (normalized.length <= 2) {
    const byLastName = memberNames.find((n) => n.startsWith(normalized));
    if (byLastName) return byLastName;
  }

  // 3. 部分一致（名前全体が含まれる）
  const partial = memberNames.find(
    (n) => n.includes(normalized) || normalized.includes(n)
  );
  if (partial) return partial;

  // 4. 姓のみ3文字以上でも前方一致を試みる
  const byPrefix = memberNames.find((n) => n.startsWith(normalized.slice(0, 2)));
  if (byPrefix && normalized.length >= 2) {
    // 曖昧すぎる（佐々木昭 vs 佐々木雅宏）は除外
    const candidates = memberNames.filter((n) => n.startsWith(normalized.slice(0, 2)));
    if (candidates.length === 1) return candidates[0];
  }

  return null;
}

// --- enrichedファイルを処理 ---
const enrichedFiles = fs.readdirSync(enrichedDir)
  .filter((f) => f.endsWith(".json"))
  .sort();

// activity: { [memberName]: { sessions: [...], allTopics: Set } }
const activity = {};
for (const name of memberNames) {
  activity[name] = { sessions: [], allTopics: new Set() };
}

for (const file of enrichedFiles) {
  const data = JSON.parse(fs.readFileSync(path.join(enrichedDir, file), "utf-8"));
  const sessionName = data.name;
  const sessionYear = data.name.match(/令和\s*\d+年/)?.[0] ?? "";
  const councilId = data.council_id;

  for (const q of (data.questioners ?? [])) {
    const memberName = findMember(q.name);
    if (!memberName) {
      console.log(`  名寄せ失敗: "${q.name}" (${sessionName})`);
      continue;
    }
    // topics: 直接抽出 + AI補完を合体
    const allTopics = [
      ...(q.topics ?? []),
      ...(q.ai_topics ?? []),
    ].filter(Boolean);

    activity[memberName].sessions.push({
      session: sessionName,
      year: sessionYear,
      council_id: councilId,
      topics: allTopics,
    });
    for (const t of allTopics) {
      activity[memberName].allTopics.add(t);
    }
  }
}

// --- 出力形式に変換 ---
const result = {};
for (const name of memberNames) {
  const a = activity[name];
  if (a.sessions.length === 0) continue;

  // トピック頻度集計
  const topicCounts = {};
  for (const s of a.sessions) {
    for (const t of s.topics) {
      topicCounts[t] = (topicCounts[t] ?? 0) + 1;
    }
  }
  const topTopics = Object.entries(topicCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t);

  result[name] = {
    name,
    session_count: a.sessions.length,
    top_topics: topTopics.slice(0, 6),
    all_topics: topTopics,
    sessions: a.sessions,
  };
}

// --- 保存 ---
const json = JSON.stringify(result, null, 2);
const outData = path.join(dataDir, "members_activity.json");
const outSite = path.join(siteDataDir, "members_activity.json");
fs.writeFileSync(outData, json, "utf-8");
fs.writeFileSync(outSite, json, "utf-8");

console.log(`\n完了: ${Object.keys(result).length}名分の活動データを生成`);
console.log(`保存先: ${outData}`);
