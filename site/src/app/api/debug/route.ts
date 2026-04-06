import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

interface CityDebug {
  dirPath: string;
  dirExists: boolean;
  indexReadable: boolean;
  indexCount: number | null;
  chunkCount: number | null;
  error: string | null;
}

function debugCity(cityId: string): CityDebug {
  const cwd = process.cwd();
  const dirPath = path.join(cwd, "data", cityId, "minutes");
  const dirExists = fs.existsSync(dirPath);

  if (!dirExists) {
    return { dirPath, dirExists, indexReadable: false, indexCount: null, chunkCount: null, error: "directory not found" };
  }

  const indexPath = path.join(dirPath, "index.json");
  try {
    const raw = fs.readFileSync(indexPath, "utf-8");
    const index = JSON.parse(raw) as Array<{ file: string }>;
    const indexCount = index.length;

    let chunkCount = 0;
    for (const entry of index) {
      const fp = path.join(dirPath, entry.file);
      if (!fs.existsSync(fp)) continue;
      const council = JSON.parse(fs.readFileSync(fp, "utf-8")) as {
        schedules: Array<{ minutes: Array<{ text: string }> }>;
      };
      for (const s of council.schedules) {
        chunkCount += s.minutes.filter((m) => m.text.trim()).length;
      }
    }

    return { dirPath, dirExists, indexReadable: true, indexCount, chunkCount, error: null };
  } catch (e) {
    return { dirPath, dirExists, indexReadable: false, indexCount: null, chunkCount: null, error: String(e) };
  }
}

export async function GET() {
  const cwd = process.cwd();

  const chitose   = debugCity("chitose");
  const eniwa     = debugCity("eniwa");
  const tomakomai = debugCity("tomakomai");

  const totalChunks =
    (chitose.chunkCount ?? 0) +
    (eniwa.chunkCount ?? 0) +
    (tomakomai.chunkCount ?? 0);

  // keyword extraction test for 小川陽平
  const testQuestion = "小川陽平議員の一般質問について教えてください";
  const keywords = extractKeywords(testQuestion);

  return NextResponse.json({
    cwd,
    chitose,
    eniwa,
    tomakomai,
    totalChunks,
    keywordsForOgawa: keywords,
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
