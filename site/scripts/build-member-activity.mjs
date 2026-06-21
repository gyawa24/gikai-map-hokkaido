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
const segmentsDir = path.join(dataDir, "segments");

// --- メンバー読み込み ---
const members = JSON.parse(fs.readFileSync(path.join(dataDir, "members.json"), "utf-8"));
const memberNames = members.map((m) => m.name.replace(/\s/g, ""));
const memberNameMap = new Map(
  members.map((m) => [m.name.replace(/\s/g, ""), m.name])
);

// --- 名寄せ関数 ---
function normalizeQuestioner(raw) {
  return raw
    .replace(/[　\s]/g, "")
    .replace(/^[0-9０-９]+番/, "")
    .replace(/^.*?[（(]([^）)]+)[）)]$/, "$1")
    .replace(/(委員|議員|議長|副議長)$/, "")
    .replace(/(君|氏|殿)$/, "")
    .trim();
}

function findMember(raw) {
  const normalized = normalizeQuestioner(raw);
  if (!normalized) return null;

  // 1. 完全一致
  const exact = memberNames.findIndex((n) => n === normalized);
  if (exact !== -1) return memberNames[exact];

  // 2. 姓のみ（2文字以下）の場合は姓で前方一致。
  //    同姓議員が複数いるときは誤帰属を避けて名寄せ失敗にする（中立性ポリシー: 漏れより誤帰属の方が深刻）
  if (normalized.length <= 2) {
    const byLastName = memberNames.filter((n) => n.startsWith(normalized));
    if (byLastName.length === 1) return byLastName[0];
    if (byLastName.length > 1) {
      console.log(`  名寄せ曖昧: "${raw}" 候補複数 [${byLastName.join(", ")}]`);
      return null;
    }
  }

  // 3. 部分一致（名前全体が含まれる）。候補が一意のときだけ採用する
  const partials = memberNames.filter(
    (n) => n.includes(normalized) || normalized.includes(n)
  );
  if (partials.length === 1) return partials[0];
  if (partials.length > 1) {
    console.log(`  名寄せ曖昧: "${raw}" 候補複数 [${partials.join(", ")}]`);
    return null;
  }

  // 4. 姓のみ3文字以上でも前方一致を試みる
  const byPrefix = memberNames.find((n) => n.startsWith(normalized.slice(0, 2)));
  if (byPrefix && normalized.length >= 2) {
    // 曖昧すぎる（佐々木昭 vs 佐々木雅宏）は除外
    const candidates = memberNames.filter((n) => n.startsWith(normalized.slice(0, 2)));
    if (candidates.length === 1) return candidates[0];
  }

  return null;
}

function uniqueTopics(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function extractTopicsFromText(text) {
  const source = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!source) return [];

  const topics = [];
  const patterns = [
    /大項目\d+[、，\s　]+([^。\n]+?について)/g,
    /中項目\d+[、，\s　]+([^。\n]+?について)/g,
    /([^\n。]{8,40}?について)/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const topic = match[1].trim();
      if (topic && !topics.includes(topic)) topics.push(topic);
    }
    if (topics.length > 0) break;
  }

  if (topics.length > 0) return topics.slice(0, 6);

  const fallback = source.slice(0, 40).trim();
  return fallback ? [fallback] : [];
}

function loadEnrichedFiles() {
  if (!fs.existsSync(enrichedDir)) return [];
  return fs.readdirSync(enrichedDir)
    .filter((f) => f.endsWith(".json"))
    .sort();
}

function loadSegmentIndexes() {
  const indexPath = path.join(segmentsDir, "_index.json");
  if (!fs.existsSync(indexPath)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// activity: { [memberName]: { sessions: [...], allTopics: Set } }
const activity = {};
for (const name of memberNames) {
  activity[name] = { sessions: [], allTopics: new Set() };
}

function hasAnyActivity() {
  return Object.values(activity).some((entry) => entry.sessions.length > 0);
}

const enrichedFiles = loadEnrichedFiles();
if (enrichedFiles.length > 0) {
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
      const canonicalName = memberNameMap.get(memberName) ?? memberName;
      const allTopics = uniqueTopics([
        ...(q.topics ?? []),
        ...(q.ai_topics ?? []),
      ]);

      if (!activity[canonicalName]) continue;
      activity[canonicalName].sessions.push({
        session: sessionName,
        year: sessionYear,
        council_id: councilId,
        topics: allTopics,
      });
      for (const t of allTopics) {
        activity[canonicalName].allTopics.add(t);
      }
    }
  }
}

if (!hasAnyActivity()) {
  const segmentIndex = loadSegmentIndexes();
  const sessionMap = new Map();

  for (const item of segmentIndex) {
    const councilId = item.council_id;
    if (councilId == null) continue;
    const fp = path.join(segmentsDir, `${councilId}.json`);
    if (!fs.existsSync(fp)) continue;

    const segments = JSON.parse(fs.readFileSync(fp, "utf-8"));
    for (const seg of segments) {
      if (seg.speaker_role !== "質問") continue;
      const memberName = findMember(seg.member_name ?? seg.speaker);
      if (!memberName) continue;

      const topics = extractTopicsFromText(seg.text ?? seg.excerpt);
      const canonicalName = memberNameMap.get(memberName) ?? memberName;
      const sessionKey = `${canonicalName}::${councilId}`;
      const current = sessionMap.get(sessionKey) ?? {
        session: item.council_name ?? item.name ?? seg.council_name ?? "",
        year: item.council_name?.match(/令和\s*\d+年/)?.[0] ?? "",
        council_id: councilId,
        topics: [],
      };
      current.topics.push(...topics);
      sessionMap.set(sessionKey, current);
    }
  }

  for (const [sessionKey, session] of sessionMap.entries()) {
    const [memberName] = sessionKey.split("::");
    const activityKey = activity[memberName] ? memberName : memberName.replace(/[\s　]/g, "");
    if (!activity[activityKey]) continue;
    const normalizedTopics = uniqueTopics(session.topics);
    activity[activityKey].sessions.push({
      session: session.session,
      year: session.year,
      council_id: session.council_id,
      topics: normalizedTopics,
    });
    for (const topic of normalizedTopics) {
      activity[activityKey].allTopics.add(topic);
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

const SUMMARY_TOPIC_RULES = [
  { label: "学校・教育", keywords: ["教育行政"] },
  { label: "部活動の地域移行", keywords: ["部活動", "地域移行"] },
  { label: "部活動指導員", keywords: ["部活動指導員"] },
  { label: "部活動の地域移行の受け皿", keywords: ["運営主体", "受皿"] },
  { label: "部活動の地域移行の受け皿", keywords: ["担い手確保"] },
  { label: "スケート学習", keywords: ["スケート学習"] },
  { label: "危機管理", keywords: ["危機管理体制"] },
  { label: "学校への私物端末持ち込み", keywords: ["私的デバイス"] },
  { label: "除雪・排雪", keywords: ["除排雪"] },
  { label: "除雪体制", keywords: ["除雪体制"] },
  { label: "千歳駅前の路面凍結", keywords: ["路面凍結"] },
  { label: "除雪情報の発信", keywords: ["除雪情報システム"] },
  { label: "学力向上の取り組み", keywords: ["学力向上"] },
  { label: "事業評価の見直し", keywords: ["事務事業評価"] },
  { label: "市役所の電話対応", keywords: ["電話交換"] },
  { label: "職員研修", keywords: ["職員研修"] },
  { label: "人口ビジョン", keywords: ["人口ビジョン"] },
  { label: "人口予測計画", keywords: ["人口予測"] },
  { label: "学校給食", keywords: ["学校給食", "給食"] },
  { label: "若者支援・まちづくり", keywords: ["若者支援", "まちづくり"] },
];

const IGNORE_SUMMARY_TOPIC_PATTERNS = [
  /ありがとうございます/,
  /分かりました/,
  /質問を終わります/,
  /以下の[0-9０-９一二三四五六七八九十]+つの論点/,
  /今までの評価/,
  /具体的な効果/,
  /今後の対応/,
  /参考までに/,
  /そのあたり/,
  /本来目指すべき目的/,
  /事業の予算額/,
  /この事業費/,
  /この事業の概要/,
  /内容としまして/,
  /確認だった/,
  /再度確認/,
  /語尾が分から/,
  /具体的な効果/,
  /具体的な戦略/,
  /どのように受け止め/,
  /予測されている/,
  /それじゃ全然足りない/,
  /御答弁/,
  /答弁を伺/,
  /お答え/,
  /質問ではない/,
  /感想/,
  /御挨拶/,
  /御指名/,
  /終わります/,
  /本会議において設置/,
  /委員会に付託/,
  /予算特別委員会に付託/,
  /補正予算特別委員会に付託/,
  /決算特別委員会に付託/,
  /ただいま/,
  /今回/,
  /先ほど/,
  /それでは/,
  /^[0-9]+つの事業$/,
  /^事業内容$/,
  /^本事業$/,
  /^事業の目的$/,
  /^今後の活用の見通し$/,
  /^今後の整備$/,
  /^予算額/,
];

const SUMMARY_TOPIC_ALLOW_PATTERNS = [
  /(行政|事業|業務|制度|計画|体制|方針|政策|支援|対策|整備|管理|運用|活用|連携|保全|財政|予算|決算|交通|給食|保育|医療|福祉|観光|防災|安全|人口|除雪|学習|研修|手当|会計|負担|水道|下水道|土地|道路|空港|基地|農業|鳥獣|ヒグマ|公園|図書館|郷土資料|まちづくり|ビジョン)/,
];

function toHalfWidthDigits(text) {
  return text.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

function applySummaryRule(topic) {
  return SUMMARY_TOPIC_RULES.find((rule) => rule.keywords.every((kw) => topic.includes(kw)))?.label ?? null;
}

function cleanSummaryTopic(raw) {
  const source = toHalfWidthDigits(String(raw ?? ""))
    .replace(/\s+/g, " ")
    .replace(/^[、，。・\s]+/, "")
    .trim();
  let topic = source;
  if (!topic) return null;
  if (IGNORE_SUMMARY_TOPIC_PATTERNS.some((pattern) => pattern.test(topic))) return null;

  const ruled = applySummaryRule(topic);
  if (ruled) return ruled;

  const hasExplicitTopicMarker = /(大項目|中項目|小項目|質問項目|^[0-9一二三四五六七八九十]+[点つ目]|^の[0-9一二三四五六七八九十])/.test(topic);
  if (!hasExplicitTopicMarker && topic.length > 18) return null;

  topic = topic
    .replace(/^(まずは?|続きまして|なお|初めに|最後に|改めまして|そこで|また|そして|次に|では、次に|質問を始める前に)[、，。\s]*/g, "")
    .replace(/^の[0-9一二三四五六七八九十]+(点目)?として[、，\s]*/g, "")
    .replace(/^(番|に|上で)[、，\s]*/g, "")
    .replace(/^.*?(中項目|小項目)[0-9一二三四五六七八九十（）()]*[、，:\s]*/g, "")
    .replace(/^(大項目|中項目|小項目|質問項目)[0-9一二三四五六七八九十（）()]*[、，:\s]*/g, "")
    .replace(/^(大項目|中項目|小項目|質問項目)[0-9一二三四五六七八九十（）()]*の?/g, "")
    .replace(/^[0-9一二三四五六七八九十]+[点つ目として、，\s]+/g, "")
    .replace(/^(この|その|今の|昨今、特に)/g, "")
    .replace(/[、，]?(について|に関して|をめぐって).*$/g, "")
    .replace(/(事業|業務|計画|体制|制度|方針|政策)の概要$/g, "$1")
    .replace(/^(市の|今の|この)/g, "")
    .replace(/[。、「」『』（）()]+$/g, "")
    .trim();

  if (!topic || topic.length < 3) return null;
  if (IGNORE_SUMMARY_TOPIC_PATTERNS.some((pattern) => pattern.test(topic))) return null;
  if (!SUMMARY_TOPIC_ALLOW_PATTERNS.some((pattern) => pattern.test(topic))) return null;
  if (topic.length > 18) return null;
  return topic;
}

function addSummaryTopic(result, topic) {
  if (!topic) return;
  const existingIndex = result.findIndex((item) => item === topic || item.includes(topic) || topic.includes(item));
  if (existingIndex === -1) {
    result.push(topic);
    return;
  }
  if (topic.length < result[existingIndex].length) {
    result[existingIndex] = topic;
  }
}

function summarizeTopics(topics) {
  const result = [];
  for (const topic of topics) {
    addSummaryTopic(result, cleanSummaryTopic(topic));
    if (result.length >= 12) break;
  }
  return result;
}

function toOutputSession(session) {
  return {
    ...session,
    summary_topics: summarizeTopics(session.topics).slice(0, 8),
  };
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
  const summaryTopics = summarizeTopics(topTopics);

  result[name] = {
    name,
    session_count: a.sessions.length,
    themes,
    summary_topics: summaryTopics,
    top_topics: summaryTopics.slice(0, 6),
    all_topics: topTopics,
    sessions: a.sessions.map(toOutputSession),
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
