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

// --- 大テーマへのキーワードマッピング ---
const THEME_KEYWORDS = [
  { theme: "教育",         keywords: ["学力", "学校", "教育", "授業", "不登校", "図書", "給食", "学習", "高校", "大学", "奨学"] },
  { theme: "子育て・保育", keywords: ["子育て", "保育", "幼稚園", "育児", "待機児童", "少子化", "放課後", "児童", "子ども", "こども", "出産"] },
  { theme: "福祉・介護",   keywords: ["福祉", "介護", "高齢者", "障害", "生活保護", "支援", "老人", "ケア", "デイ", "障がい"] },
  { theme: "防災・安全",   keywords: ["防災", "避難", "災害", "ハザード", "消防", "救急", "緊急", "安全", "熊", "ヒグマ", "鳥獣"] },
  { theme: "農業・農地",   keywords: ["農業", "農地", "農家", "農産", "収穫", "農協", "水田", "畜産", "漁業", "水産"] },
  { theme: "観光・交流",   keywords: ["観光", "宿泊", "インバウンド", "旅行", "交流", "イベント", "にぎわい", "シティ"] },
  { theme: "道路・インフラ", keywords: ["道路", "橋", "インフラ", "修繕", "公共施設", "舗装", "整備", "上下水道", "水道"] },
  { theme: "環境",         keywords: ["環境", "ごみ", "廃棄物", "リサイクル", "脱炭素", "カーボン", "ゼロ", "再生可能", "太陽光"] },
  { theme: "産業・経済",   keywords: ["産業", "企業", "工業", "経済", "雇用", "振興", "誘致", "工場", "商業", "商店街", "起業"] },
  { theme: "DX・デジタル", keywords: ["DX", "デジタル", "ICT", "AI", "システム", "電子", "オンライン", "マイナンバー"] },
  { theme: "財政・予算",   keywords: ["予算", "財政", "歳入", "歳出", "決算", "基金", "税", "補助金", "交付金"] },
  { theme: "健康・医療",   keywords: ["医療", "健康", "病院", "診療", "クリニック", "がん", "検診", "メンタル"] },
  { theme: "まちづくり",   keywords: ["まちづくり", "都市", "開発", "再開発", "市街地", "景観", "空き家", "移住", "定住", "人口"] },
  { theme: "交通",         keywords: ["交通", "バス", "鉄道", "自転車", "駐車", "路線", "タクシー"] },
  { theme: "スポーツ・文化", keywords: ["スポーツ", "文化", "芸術", "体育", "スタジアム", "アリーナ", "図書館", "合宿"] },
];

function extractThemes(topics) {
  const themeCounts = {};
  for (const topic of topics) {
    for (const { theme, keywords } of THEME_KEYWORDS) {
      if (keywords.some((kw) => topic.includes(kw))) {
        themeCounts[theme] = (themeCounts[theme] ?? 0) + 1;
      }
    }
  }
  return Object.entries(themeCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t);
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

  const themes = extractThemes(topTopics);

  result[name] = {
    name,
    session_count: a.sessions.length,
    themes,
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
