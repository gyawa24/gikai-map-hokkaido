import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function GET() {
  const cwd = process.cwd();
  const minutesDir = path.join(cwd, "data", "chitose", "minutes");
  const indexPath = path.join(minutesDir, "index.json");

  const dirExists = fs.existsSync(minutesDir);

  let indexReadable = false;
  let indexCount: number | null = null;
  let indexError: string | null = null;
  let sampleFile: string | null = null;
  let sampleChunk: unknown = null;
  let sampleChunkError: string | null = null;
  let chunkBuildTotal: number | null = null;
  let keywordsTest: string[] = [];
  let searchHits: number | null = null;

  if (dirExists) {
    try {
      const raw = fs.readFileSync(indexPath, "utf-8");
      const index = JSON.parse(raw) as Array<{ file: string; name: string }>;
      indexReadable = true;
      indexCount = index.length;

      // 1件目のファイルからサンプルチャンクを取得
      if (index.length > 0) {
        sampleFile = index[0].file;
        const fp = path.join(minutesDir, sampleFile);
        const council = JSON.parse(fs.readFileSync(fp, "utf-8")) as {
          schedules: Array<{
            name: string;
            minutes: Array<{ title: string; minute_type: string; text: string }>;
          }>;
        };
        const firstSchedule = council.schedules[0];
        const firstMinute = firstSchedule?.minutes?.[0];
        sampleChunk = firstMinute
          ? {
              scheduleName: firstSchedule.name,
              title: firstMinute.title,
              minute_type: firstMinute.minute_type,
              text_preview: firstMinute.text.slice(0, 100),
            }
          : null;
      }

      // 全チャンク数を計算
      let total = 0;
      for (const entry of index) {
        const fp = path.join(minutesDir, entry.file);
        if (!fs.existsSync(fp)) continue;
        const council = JSON.parse(fs.readFileSync(fp, "utf-8")) as {
          schedules: Array<{ minutes: Array<{ text: string }> }>;
        };
        for (const s of council.schedules) {
          total += s.minutes.filter((m) => m.text.trim()).length;
        }
      }
      chunkBuildTotal = total;

      // "小川陽平" のキーワード抽出テスト
      const testQuestion = "小川陽平議員の一般質問について教えてください";
      keywordsTest = extractKeywords(testQuestion);

      // "小川陽平" にヒットするチャンク数
      let hits = 0;
      for (const entry of index) {
        const fp = path.join(minutesDir, entry.file);
        if (!fs.existsSync(fp)) continue;
        const council = JSON.parse(fs.readFileSync(fp, "utf-8")) as {
          schedules: Array<{
            name: string;
            minutes: Array<{ title: string; text: string }>;
          }>;
        };
        for (const s of council.schedules) {
          for (const m of s.minutes) {
            const haystack = m.title + " " + m.text;
            if (keywordsTest.some((kw) => haystack.includes(kw))) hits++;
          }
        }
      }
      searchHits = hits;
    } catch (e) {
      indexError = String(e);
      sampleChunkError = String(e);
    }
  }

  return NextResponse.json({
    cwd,
    minutesDir,
    dirExists,
    indexReadable,
    indexCount,
    indexError,
    sampleFile,
    sampleChunk,
    sampleChunkError,
    chunkBuildTotal,
    keywordsForOgawa: keywordsTest,
    searchHitsForOgawa: searchHits,
  });
}

// extractKeywords のローカルコピー（route.ts と同じロジック）
const STOP_WORDS = new Set([
  "は", "が", "を", "に", "で", "と", "も", "の", "へ", "から", "まで",
  "より", "など", "か", "や", "て", "で", "ば", "し", "ね", "よ", "な",
  "この", "その", "あの", "どの", "ここ", "そこ", "あそこ", "どこ",
  "こと", "もの", "ため", "よう", "ほど", "くらい", "だけ", "しか",
  "について", "において", "に関して", "に関する", "として", "による",
  "教えて", "ください", "何", "どう", "どんな", "いつ", "だれ", "誰",
  "あります", "います", "ありますか", "いますか",
]);

function extractKeywords(question: string): string[] {
  const tokens = new Set<string>();

  const kanjiSeqs = question.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  for (const seq of kanjiSeqs) {
    if (seq.length <= 8 && !STOP_WORDS.has(seq)) tokens.add(seq);
    for (let len = 2; len <= Math.min(4, seq.length); len++) {
      for (let i = 0; i <= seq.length - len; i++) {
        const sub = seq.slice(i, i + len);
        if (!STOP_WORDS.has(sub)) tokens.add(sub);
      }
    }
  }

  const kataSeqs = question.match(/[\u30a0-\u30ff]{2,}/g) ?? [];
  for (const seq of kataSeqs) {
    if (!STOP_WORDS.has(seq)) tokens.add(seq);
  }

  const spaceTokens = question
    .replace(/[。、！？!?「」『』【】（）()\s]+/g, " ")
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && t.length <= 20 && !STOP_WORDS.has(t));
  for (const t of spaceTokens) tokens.add(t);

  return [...tokens];
}
