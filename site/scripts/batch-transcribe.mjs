#!/usr/bin/env node
/**
 * 議会中継 全自動バッチ処理スクリプト
 *
 * 処理フロー:
 *   動画URL → yt-dlp(音声) → mlx_whisper(文字起こし) → Claude Haiku(要約) → JSON保存
 *
 * 使い方:
 *   cd /Users/yohei/gikai-map-hokkaido/site
 *   node scripts/batch-transcribe.mjs
 *
 * オプション:
 *   --city <slug>       対象都市（デフォルト: chitose）
 *   --id <session-id>   特定の1件だけ処理
 *   --skip-done         処理済み（has_summary:true）をスキップ（デフォルトON）
 *   --dry-run           ダウンロードせず対象一覧を表示
 */

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { prepareSessionAudio, resolveSourceUrl } from "./lib/session-audio.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "../..");
const SITE_ROOT = path.resolve(__dirname, "..");

// --- claude -p でMaxPlanを使って同期テキスト生成 ---
function claudeQuery(prompt) {
  const result = spawnSync("claude", ["-p", "--output-format", "text"], {
    input: prompt,
    encoding: "utf-8",
    timeout: 120_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`claude -p failed: ${result.stderr?.trim().slice(0, 200)}`);
  }
  return result.stdout.trim();
}
const TMP_DIR   = path.join(ROOT, "tmp_audio");

const MLX_WHISPER = "/Users/yohei/.local/bin/mlx_whisper";
const WHISPER_MODEL = "mlx-community/whisper-large-v3-turbo";

// --- CLI引数 ---
const args = process.argv.slice(2);
const getFlag = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };
const hasFlag = (f) => args.includes(f);
const city      = getFlag("--city") ?? "chitose";
const targetId  = getFlag("--id");
const dryRun    = hasFlag("--dry-run");
const skipDone  = !hasFlag("--no-skip");   // デフォルトでスキップ

// --- ノイズフィルター（Super Whisper と同じ基準） ---
const NOISE = [/^ご視聴ありがとうございました[。]?$/, /^ありがとうございました[。]?$/];
const isNoise = (t) => NOISE.some((p) => p.test(t.trim()));

// --- 語彙辞書を読み込む ---
function loadVocabulary(city) {
  const fp = path.join(ROOT, "data", city, "vocabulary.json");
  try { return JSON.parse(fs.readFileSync(fp, "utf-8")); } catch { return null; }
}

function getCouncilName(city, vocab) {
  if (vocab?.council_name) return vocab.council_name;
  try {
    const municipalities = JSON.parse(
      fs.readFileSync(path.join(ROOT, "data", "municipalities.json"), "utf-8")
    );
    return municipalities.find((m) => m.slug === city)?.council_name ?? `${city}議会`;
  } catch {
    return `${city}議会`;
  }
}

// Whisper initial_prompt 用の文字列を生成
function buildInitialPrompt(vocab) {
  if (!vocab) return null;
  const members = (vocab.members ?? []).join("、");
  const terms = (vocab.key_terms ?? []).join("、");
  return `${vocab.council_name ?? "市議会"}。議員：${members}。キーワード：${terms}。`;
}

// テキストに語彙辞書の補正を適用
function applyCorrections(text, vocab) {
  if (!vocab?.corrections) return text;
  let result = text;
  for (const { wrong, right } of vocab.corrections) {
    result = result.replaceAll(wrong, right);
  }
  return result;
}

// --- セッション一覧を読み込む ---
const indexPath = path.join(ROOT, "data", city, "sessions", "index.json");
if (!fs.existsSync(indexPath)) {
  console.error(`Session index not found: ${indexPath}`);
  process.exit(1);
}
let sessions = JSON.parse(fs.readFileSync(indexPath, "utf-8"));

if (targetId) {
  sessions = sessions.filter((s) => s.id === targetId);
  if (!sessions.length) { console.error(`ID not found: ${targetId}`); process.exit(1); }
}
if (skipDone) {
  sessions = sessions.filter((s) => !s.has_summary);
}

console.log(`\n処理対象: ${sessions.length}件`);
sessions.forEach((s) => console.log(`  ${s.date} ${s.title}`));

if (dryRun || sessions.length === 0) {
  console.log("\n(--dry-run: 処理しません)");
  process.exit(0);
}


fs.mkdirSync(TMP_DIR, { recursive: true });

// ==============================
// メイン処理
// ==============================
let successCount = 0;
let failCount = 0;

const vocab = loadVocabulary(city);
const councilName = getCouncilName(city, vocab);
const initialPrompt = buildInitialPrompt(vocab);
if (initialPrompt) console.log(`\n語彙ヒント: ${initialPrompt.slice(0, 80)}…`);

for (const entry of sessions) {
  const sessionFile = path.join(ROOT, "data", city, "sessions", `${entry.id}.json`);
  const sessionMeta = fs.existsSync(sessionFile)
    ? JSON.parse(fs.readFileSync(sessionFile, "utf-8"))
    : entry;
  console.log(`\n${"=".repeat(60)}`);
  console.log(`▶ ${entry.title} (${entry.date})`);
  const sourceUrl = resolveSourceUrl(sessionMeta);
  const sourceSegments = Array.isArray(sessionMeta.source_segments)
    ? sessionMeta.source_segments
    : [];
  console.log(`  Source: ${sourceUrl ?? "(未設定)"}`);

  const audioPath = path.join(TMP_DIR, `${entry.id}.mp3`);
  const whisperJson = path.join(TMP_DIR, `${entry.id}.json`);

  try {
    if (!sourceUrl) throw new Error("source_url または youtube_id が未設定です");

    // 1. 音声ダウンロード
    if (!fs.existsSync(audioPath)) {
      console.log("  [1/3] 音声ダウンロード中...");
      prepareSessionAudio({
        entryId: entry.id,
        sourceUrl,
        sourceSegments,
        outputPath: audioPath,
        tmpDir: TMP_DIR,
      });
      console.log(`  → 保存: ${path.basename(audioPath)}`);
    } else {
      console.log("  [1/3] 音声ファイル既存 → スキップ");
    }

    // 2. mlx_whisper 文字起こし
    if (!fs.existsSync(whisperJson)) {
      console.log("  [2/3] 文字起こし中 (mlx_whisper)...");
      const whisperArgs = [
        audioPath,
        "--model", WHISPER_MODEL,
        "--language", "ja",
        "--output-format", "json",
        "--output-dir", TMP_DIR,
        "--fp16", "False",
        "--condition-on-previous-text", "False",  // ハルシネーション防止
        "--no-speech-threshold", "0.1",           // 無音判定を緩く（0件対策）
      ];
      if (initialPrompt) whisperArgs.push("--initial-prompt", initialPrompt);
      const ws = spawnSync(MLX_WHISPER, whisperArgs, { stdio: "pipe", timeout: 7200000 }); // 最大2時間
      if (ws.status !== 0) throw new Error(`mlx_whisper failed: ${ws.stderr?.toString().slice(0, 200)}`);

      // mlx_whisper は {id}.json ではなく {id}.mp3.json か {basename}.json を出力することがある
      const possiblePaths = [
        path.join(TMP_DIR, `${entry.id}.json`),
        path.join(TMP_DIR, `${entry.id}.mp3.json`),
      ];
      const found = possiblePaths.find(fs.existsSync);
      if (found && found !== whisperJson) fs.renameSync(found, whisperJson);
      if (!fs.existsSync(whisperJson)) throw new Error("whisper JSON output not found");
      console.log("  → 文字起こし完了");
    } else {
      console.log("  [2/3] 文字起こし済み → スキップ");
    }

    // 3. セグメント分割 & 要約生成
    console.log("  [3/3] 要約生成中...");
    // mlx_whisper は NaN を出力することがある（有効なJSONでないため置換）
    const whisperRaw = fs.readFileSync(whisperJson, "utf-8").replace(/:\s*NaN/g, ": null");
    const whisperData = JSON.parse(whisperRaw);
    const rawSegs = whisperData.segments ?? [];
    console.log(`  → whisperセグメント数: ${rawSegs.length}  (JSONキー: ${Object.keys(whisperData).join(", ")})`);
    if (rawSegs.length > 0) console.log(`    最初のセグメント: ${JSON.stringify(rawSegs[0]).slice(0, 120)}`);

    // 10分休憩を探してパートに分割
    const breakIndices = rawSegs.reduce((acc, s, i) => {
      if (/10分間休憩/.test(s.text)) acc.push(i);
      return acc;
    }, []);

    const firstReal = rawSegs.findIndex((s) => !isNoise(s.text));
    const boundaries = [
      firstReal >= 0 ? firstReal : 0,
      ...breakIndices.map((i) => i + 1),
      rawSegs.length,
    ];

    const parts = [];
    for (let pi = 0; pi < boundaries.length - 1; pi++) {
      const slice = rawSegs.slice(boundaries[pi], boundaries[pi + 1]);
      const cleaned = [];
      let prev = "";
      for (const s of slice) {
        const t = s.text.trim();
        if (!isNoise(t) && t !== prev && t.length > 0) { cleaned.push(s); prev = t; }
      }
      if (cleaned.length === 0) continue;
      const rawText = cleaned.map((s) => s.text.trim()).join("\n");
      const text = applyCorrections(rawText, vocab);
      parts.push({
        index: parts.length + 1,
        label: `第${parts.length + 1}部`,
        start_time: formatTime(cleaned[0].start),
        end_time:   formatTime(cleaned[cleaned.length - 1].end),
        transcript: text,
      });
    }

    // 要約生成（claude -p / MaxPlan使用）
    const segments = [];
    for (const p of parts) {
      process.stdout.write(`    ${p.label}/${parts.length} ... `);
      const truncated = p.transcript.length > 6000
        ? p.transcript.slice(0, 6000) + "\n…（省略）"
        : p.transcript;
      const vocabNote = vocab
        ? `【正しい固有名詞】議員名：${(vocab.members ?? []).join("、")}。重要用語：${(vocab.key_terms ?? []).slice(0, 8).join("、")}。文字起こし中の誤表記は正しい表記に直して要約してください。\n\n`
        : "";
      const prompt = `あなたは${councilName}の会議記録を整理するアシスタントです。
以下は${councilName}の文字起こし（${p.label}）です。次のJSON形式のみで回答してください:
{"summary":"3〜4文の日本語要約","topics":["キーワード1","キーワード2","キーワード3"]}

${vocabNote}文字起こし:\n${truncated}`;
      const text = claudeQuery(prompt);
      const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)[0]);
      console.log("完了");
      segments.push({ ...p, summary: parsed.summary, topics: parsed.topics ?? [] });
    }

    // 4. JSON保存
    const session = JSON.parse(fs.readFileSync(sessionFile, "utf-8"));
    const updated = { ...session, city, generated_at: new Date().toISOString().split("T")[0], segments };

    for (const dir of [
      path.join(ROOT, "data", city, "sessions"),
      path.join(SITE_ROOT, "data", city, "sessions"),
    ]) {
      fs.writeFileSync(path.join(dir, `${entry.id}.json`), JSON.stringify(updated, null, 2));
    }

    // index.json を更新
    for (const dir of [
      path.join(ROOT, "data", city, "sessions"),
      path.join(SITE_ROOT, "data", city, "sessions"),
    ]) {
      const ip = path.join(dir, "index.json");
      const idx = JSON.parse(fs.readFileSync(ip, "utf-8"));
      const e = idx.find((x) => x.id === entry.id);
      if (e) { e.segment_count = segments.length; e.has_transcript = true; e.has_summary = true; }
      fs.writeFileSync(ip, JSON.stringify(idx, null, 2));
    }

    console.log(`  ✓ 完了: ${segments.length}部`);
    successCount++;

    // 一時ファイル削除（ディスク節約）
    fs.unlinkSync(audioPath);
    fs.unlinkSync(whisperJson);

  } catch (err) {
    console.error(`  ✗ エラー: ${err.message}`);
    failCount++;
  }
}

console.log(`\n${"=".repeat(60)}`);
console.log(`完了: ${successCount}件成功 / ${failCount}件失敗`);
console.log(`\n次のステップ:`);
console.log(`  cd ${ROOT}`);
console.log(`  git add data/ site/data/`);
console.log(`  git commit -m "Add transcripts: ${city}"`);
console.log(`  git push`);

function formatTime(secs) {
  if (!secs && secs !== 0) return undefined;
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = Math.floor(secs % 60);
  return h > 0 ? `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}` : `${m}:${String(s).padStart(2,"0")}`;
}
