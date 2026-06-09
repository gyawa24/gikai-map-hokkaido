#!/usr/bin/env node
/**
 * YouTube の自動字幕を速報セッションJSONに取り込む。
 *
 * 使い方:
 *   node site/scripts/import-youtube-caption-session.mjs \
 *     --city chitose \
 *     --id r8-teireikai2-ogawa-question-20260608 \
 *     --caption-file /path/to/video.ja-orig.json3 \
 *     --title "令和8年 第2回定例会 第2日目（6/8）一般質問" \
 *     --start 1:42:46 \
 *     --end 2:56:48 \
 *     --label "小川陽平 一般質問" \
 *     --speaker "小川陽平" \
 *     --summary "..." \
 *     --topics "男女共同参画,生成AI"
 *
 * 複数セグメント:
 *   --segment "古川昌俊 一般質問|古川昌俊|18:43|1:11:31|要約|地域福祉,防災"
 *   --segment "佐々木昭 一般質問|佐々木昭|1:11:44|1:42:35|要約|公園管理,道路行政"
 */

import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const SITE_ROOT = path.resolve(__dirname, "..");

const args = parseArgs(process.argv.slice(2));
const city = required("--city");
const id = required("--id");
const lang = args["--lang"] ?? "ja-orig";
const withTimestamps = !hasFlag("--no-timestamps");
const specs = parseSegmentSpecs();

const sessionPath = path.join(ROOT, "data", city, "sessions", `${id}.json`);
if (!fs.existsSync(sessionPath)) {
  throw new Error(`Session file not found: ${sessionPath}`);
}

const session = JSON.parse(fs.readFileSync(sessionPath, "utf-8"));
const sourceUrl =
  args["--source-url"] ?? session.source_url ?? (session.youtube_id ? `https://www.youtube.com/watch?v=${session.youtube_id}` : "");
const captionFile = args["--caption-file"] ?? downloadCaption({ id, sourceUrl, lang });
const captionRows = readCaptionRows(captionFile);
const vocab = readJson(path.join(ROOT, "data", city, "vocabulary.json"), null);

const segments = specs.map((spec, index) => {
  const startSeconds = timeToSeconds(spec.start_time);
  const endSeconds = timeToSeconds(spec.end_time);
  const filtered = cleanupRows(
    captionRows.filter((row) => row.seconds >= startSeconds && row.seconds <= endSeconds),
    vocab
  );
  if (filtered.length === 0) {
    throw new Error(`No captions found for ${spec.label}: ${spec.start_time} - ${spec.end_time}`);
  }
  return {
    index: index + 1,
    label: spec.label,
    start_time: spec.start_time,
    end_time: spec.end_time,
    summary: spec.summary,
    topics: spec.topics,
    transcript: buildTranscript(filtered, { withTimestamps }),
    transcript_source: "youtube_auto_caption",
    transcript_note:
      "YouTube自動字幕をもとにした速報用の暫定文字起こしです。正式な議事録ではありません。",
  };
});

const updated = {
  ...session,
  city,
  ...(args["--title"] ? { title: args["--title"] } : {}),
  source_url: sourceUrl,
  generated_at: new Date().toISOString().slice(0, 10),
  transcript_source: "youtube_auto_caption",
  transcript_source_url: sourceUrl,
  transcript_note:
    "YouTube自動字幕をもとに、明らかな誤変換のみ機械的に補正しています。正式な議事録ではありません。",
  segments,
};

writeSession(updated);
updateIndexes(updated, { speakers: specs.map((spec) => spec.speaker).filter(Boolean) });

console.log(`updated: ${city}/sessions/${id}.json`);
console.log(
  `segments: ${segments.length}, transcript: ${segments.reduce((sum, seg) => sum + seg.transcript.length, 0)} chars`
);

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }
    if (parsed[key]) {
      parsed[key] = Array.isArray(parsed[key]) ? [...parsed[key], next] : [parsed[key], next];
    } else {
      parsed[key] = next;
    }
    i++;
  }
  return parsed;
}

function hasFlag(name) {
  return args[name] === true;
}

function required(name) {
  const value = args[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required argument: ${name}`);
  }
  return value;
}

function parseSegmentSpecs() {
  const rawSegments = args["--segment"];
  const values = Array.isArray(rawSegments)
    ? rawSegments
    : typeof rawSegments === "string"
    ? [rawSegments]
    : [];

  if (values.length > 0) {
    return values.map((value) => {
      const [label, speaker, start_time, end_time, summary, topicsRaw = ""] = value
        .split("|")
        .map((part) => part.trim());
      if (!label || !start_time || !end_time || !summary) {
        throw new Error(`Invalid --segment value: ${value}`);
      }
      return {
        label,
        speaker,
        start_time,
        end_time,
        summary,
        topics: topicsRaw.split(",").map((topic) => topic.trim()).filter(Boolean),
      };
    });
  }

  const startTime = required("--start");
  const endTime = required("--end");
  return [
    {
      label: args["--label"] ?? "発言",
      speaker: args["--speaker"] ?? "",
      start_time: startTime,
      end_time: endTime,
      summary: required("--summary"),
      topics: (args["--topics"] ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    },
  ];
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

function downloadCaption({ id, sourceUrl, lang }) {
  if (!sourceUrl) throw new Error("source_url or youtube_id is required to download captions");
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), `gikai-caption-${id}-`));
  const outputTemplate = path.join(outputDir, "%(id)s.%(ext)s");
  const result = spawnSync(
    "yt-dlp",
    [
      "--skip-download",
      "--write-auto-subs",
      "--sub-langs",
      lang,
      "--sub-format",
      "json3",
      "-o",
      outputTemplate,
      sourceUrl,
    ],
    { encoding: "utf-8" }
  );
  if (result.status !== 0) {
    throw new Error(`yt-dlp caption download failed: ${result.stderr.trim().slice(0, 400)}`);
  }
  const files = fs.readdirSync(outputDir).filter((name) => name.endsWith(".json3"));
  if (files.length === 0) throw new Error(`Caption file was not created in ${outputDir}`);
  return path.join(outputDir, files[0]);
}

function readCaptionRows(filePath) {
  const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  const rows = [];
  for (const event of data.events ?? []) {
    const text = (event.segs ?? [])
      .map((seg) => seg.utf8 ?? "")
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    const seconds = (event.tStartMs ?? 0) / 1000;
    rows.push({
      seconds,
      start_time: formatTime(seconds),
      text,
    });
  }
  return rows;
}

function cleanupRows(rows, vocab) {
  const cleaned = [];
  let previous = "";
  for (const row of rows) {
    let text = normalizeCaptionText(row.text, vocab);
    if (!text || text === previous) continue;
    if (/^\d+$/.test(text)) continue;
    cleaned.push({ ...row, text });
    previous = text;
  }
  return cleaned;
}

function normalizeCaptionText(text, vocab) {
  let result = text
    .replaceAll("男女共同三角", "男女共同参画")
    .replaceAll("男女共同三画", "男女共同参画")
    .replaceAll("共同三角", "共同参画")
    .replaceAll("共同三画", "共同参画")
    .replaceAll("第3次都歳", "第3次千歳")
    .replaceAll("千都歳", "千歳")
    .replaceAll("地都歳", "千歳")
    .replaceAll("都歳", "千歳")
    .replaceAll("弱年", "若年")
    .replaceAll("小座世帯", "子育て世帯")
    .replaceAll("小子育て", "子育て")
    .replaceAll("小育て", "子育て")
    .replaceAll("街づり", "街づくり")
    .replaceAll("天出", "転出")
    .replaceAll("天入", "転入")
    .replaceAll("出傷", "出生")
    .replaceAll("自然現象", "自然減少")
    .replaceAll("社会減少", "社会減少")
    .replaceAll("拍書", "白書")
    .replaceAll("白所", "白書")
    .replaceAll("首都して", "市として")
    .replaceAll("地域府市", "地域福祉")
    .replaceAll("要護者", "要援護者")
    .replaceAll("用援護者", "要援護者")
    .replaceAll("新千都歳", "新千歳")
    .replaceAll("ラビダス", "ラピダス")
    .replaceAll("反動体", "半導体")
    .replaceAll("特許高齢者", "独居高齢者")
    .replaceAll("通印", "通院")
    .replaceAll("ゴみ", "ゴミ")
    .replaceAll("公演行政", "公園行政")
    .replaceAll("公演管理", "公園管理")
    .replaceAll("公演における", "公園における")
    .replaceAll("公演融語", "公園遊具")
    .replaceAll("公園融合", "公園遊具")
    .replaceAll("有具", "遊具")
    .replaceAll("地目調査", "樹木調査")
    .replaceAll("公北樹目", "公園樹木")
    .replaceAll("古村目", "枯損木")
    .replaceAll("中央分隊", "中央分離帯")
    .replaceAll("中央理隊", "中央分離帯")
    .replaceAll("開部", "開口部")
    .replaceAll("道路負体設備", "道路附帯設備")
    .replaceAll("負体設備", "附帯設備")
    .replaceAll("時期DX", "次期DX")
    .replaceAll("時期計画", "次期計画")
    .replaceAll("時期男女", "次期男女")
    .replaceAll("一時期DX", "次期DX")
    .replaceAll("効果ができて", "効果が出て")
    .replaceAll("現内", "源内")
    .replaceAll("現の", "源内の")
    .replaceAll("ガバネントAI", "ガバメントAI")
    .replaceAll("ガントAI", "ガバメントAI")
    .replaceAll("ガベント", "ガバメント")
    .replaceAll("ラグ", "RAG")
    .replaceAll("AIRPA", "AI、RPA")
    .replaceAll("効立", "効率")
    .replaceAll("行動化", "高度化")
    .replaceAll("貸化", "可視化")
    .replaceAll("貸視化", "可視化")
    .replaceAll("使用書", "仕様書")
    .replaceAll("受宅", "受託")
    .replaceAll("録院", "ロックイン")
    .replaceAll("集熟度", "習熟度")
    .replaceAll("利り活用", "利活用")
    .replaceAll("地法自治体", "地方自治体")
    .replaceAll("実証事件", "実証実験")
    .replaceAll("職品", "職員")
    .replaceAll("ワークショップや職品", "ワークショップや職員")
    .replaceAll("技似録", "議事録")
    .replaceAll("C公式ホームページ", "市公式ホームページ")
    .replaceAll("中目", "中項目")
    .replaceAll("世未来", "ちとせ未来クラブ")
    .replaceAll("千都未来クラブ", "ちとせ未来クラブ")
    .replaceAll("地都歳未来", "ちとせ未来クラブ")
    .replaceAll("小川洋平", "小川陽平");
  result = result
    .replaceAll("古川正", "古川昌俊")
    .replaceAll("佐々木明", "佐々木昭")
    .replaceAll("佐々議員", "佐々木昭議員");

  if (vocab?.corrections) {
    for (const { wrong, right } of vocab.corrections) {
      result = result.replaceAll(wrong, right);
    }
  }

  return result
    .replace(/^番小川議員。?/, "3番 小川議員。")
    .replace(/\s+/g, " ")
    .trim();
}

function buildTranscript(rows, { withTimestamps }) {
  if (withTimestamps) {
    return rows.map((row) => `${row.start_time} ${row.text}`).join("\n");
  }
  return rows.map((row) => row.text).join("\n");
}

function writeSession(updated) {
  for (const root of [ROOT, SITE_ROOT]) {
    const dir = path.join(root, "data", city, "sessions");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${id}.json`), `${JSON.stringify(updated, null, 2)}\n`);
  }
}

function updateIndexes(updated, { speakers }) {
  for (const root of [ROOT, SITE_ROOT]) {
    const indexPath = path.join(root, "data", city, "sessions", "index.json");
    const index = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
    const entry = index.find((item) => item.id === id);
    if (!entry) throw new Error(`Index entry not found: ${indexPath}`);
    entry.youtube_id = updated.youtube_id;
    entry.source_url = updated.source_url;
    entry.title = updated.title;
    entry.date = updated.date;
    entry.committee = updated.committee;
    entry.segment_count = updated.segments.length;
    entry.has_transcript = updated.segments.some((seg) => Boolean(seg.transcript?.trim()));
    entry.has_summary = updated.segments.some((seg) => Boolean(seg.summary?.trim()));
    if (speakers.length > 0) entry.speakers = [...new Set(speakers)];
    fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  }
}

function timeToSeconds(value) {
  const parts = value.split(":").map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part))) {
    throw new Error(`Invalid time: ${value}`);
  }
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  throw new Error(`Invalid time: ${value}`);
}

function formatTime(seconds) {
  const rounded = Math.max(0, Math.floor(seconds));
  const h = Math.floor(rounded / 3600);
  const m = Math.floor((rounded % 3600) / 60);
  const s = rounded % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}
