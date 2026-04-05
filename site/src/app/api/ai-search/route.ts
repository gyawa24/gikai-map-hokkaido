import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Rate limiting (in-memory)
// Note: resets on serverless cold-start. For production use Vercel KV etc.
// ---------------------------------------------------------------------------
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();
const MAX_REQUESTS_PER_DAY = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

function getClientIP(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

function checkRateLimit(ip: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const entry = rateLimitStore.get(ip);

  if (!entry || now > entry.resetTime) {
    rateLimitStore.set(ip, { count: 1, resetTime: now + DAY_MS });
    return { allowed: true, remaining: MAX_REQUESTS_PER_DAY - 1 };
  }
  if (entry.count >= MAX_REQUESTS_PER_DAY) {
    return { allowed: false, remaining: 0 };
  }
  entry.count++;
  return { allowed: true, remaining: MAX_REQUESTS_PER_DAY - entry.count };
}

// ---------------------------------------------------------------------------
// Base context: load members/decisions/newsletter/schedule once at module init
// ---------------------------------------------------------------------------
function buildBaseContext(): string {
  const dir = path.join(process.cwd(), "data", "chitose");
  const read = (file: string) =>
    fs.readFileSync(path.join(dir, file), "utf-8");

  return [
    "### 議員名簿\n" + read("members.json"),
    "### 議決結果（直近4回）\n" + read("decisions.json"),
    "### 議会だより（最新号）\n" + read("newsletter.json"),
    "### 行事予定\n" + read("schedule.json"),
  ].join("\n\n");
}

// ---------------------------------------------------------------------------
// Minutes search: build flat chunk index once at module init
// ---------------------------------------------------------------------------
interface MinuteChunk {
  councilName: string;
  year: string;
  typeLabel: string;
  scheduleName: string;
  title: string;
  text: string;
}

function buildMinuteChunks(): MinuteChunk[] {
  const minutesDir = path.join(process.cwd(), "data", "chitose", "minutes");
  if (!fs.existsSync(minutesDir)) return [];

  const indexPath = path.join(minutesDir, "index.json");
  if (!fs.existsSync(indexPath)) return [];

  const index = JSON.parse(fs.readFileSync(indexPath, "utf-8")) as Array<{
    council_id: number;
    name: string;
    year: string;
    type_label: string;
    file: string;
  }>;

  const chunks: MinuteChunk[] = [];

  for (const entry of index) {
    const filePath = path.join(minutesDir, entry.file);
    if (!fs.existsSync(filePath)) continue;

    const council = JSON.parse(fs.readFileSync(filePath, "utf-8")) as {
      schedules: Array<{
        name: string;
        minutes: Array<{ title: string; minute_type: string; text: string }>;
      }>;
    };

    for (const schedule of council.schedules) {
      for (const minute of schedule.minutes) {
        if (!minute.text.trim()) continue;
        chunks.push({
          councilName: entry.name,
          year: entry.year,
          typeLabel: entry.type_label,
          scheduleName: schedule.name,
          title: minute.title,
          text: minute.text,
        });
      }
    }
  }

  return chunks;
}

// 検索に使わない日本語助詞・助動詞・一般的すぎる語
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

  // 漢字連続列を抽出してサブストリングも生成
  // 例: "小川陽平議員について" → kanjiSeqs=["小川陽平議員"]
  //   → "小川", "川陽", "陽平", "平議", "議員",
  //      "小川陽", "川陽平", …, "小川陽平", …, "小川陽平議員" など
  const kanjiSeqs = question.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  for (const seq of kanjiSeqs) {
    // 全体（8文字以下）
    if (seq.length <= 8 && !STOP_WORDS.has(seq)) tokens.add(seq);
    // 2〜4文字のサブストリング（人名・複合語をカバー）
    for (let len = 2; len <= Math.min(4, seq.length); len++) {
      for (let i = 0; i <= seq.length - len; i++) {
        const sub = seq.slice(i, i + len);
        if (!STOP_WORDS.has(sub)) tokens.add(sub);
      }
    }
  }

  // カタカナ語（外来語・固有名詞）
  const kataSeqs = question.match(/[\u30a0-\u30ff]{2,}/g) ?? [];
  for (const seq of kataSeqs) {
    if (!STOP_WORDS.has(seq)) tokens.add(seq);
  }

  // スペース区切りがある場合（英数字・ローマ字混じり質問への対応）
  const spaceTokens = question
    .replace(/[。、！？!?「」『』【】（）()\s]+/g, " ")
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && t.length <= 20 && !STOP_WORDS.has(t));
  for (const t of spaceTokens) tokens.add(t);

  return [...tokens];
}

function scoreChunk(chunk: MinuteChunk, keywords: string[]): number {
  if (keywords.length === 0) return 0;
  const haystack = (chunk.title + " " + chunk.text).toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    const kl = kw.toLowerCase();
    if (haystack.includes(kl)) {
      // タイトルマッチは重み付け
      score += chunk.title.toLowerCase().includes(kl) ? 3 : 1;
      // 出現回数も加味（最大5回まで）
      const count = (haystack.match(new RegExp(kl, "g")) ?? []).length;
      score += Math.min(count, 5);
    }
  }
  return score;
}

const MAX_SNIPPET_CHARS = 500;
const MAX_MINUTES_CHUNKS = 8;

function searchMinutes(question: string, chunks: MinuteChunk[]): string {
  if (chunks.length === 0) return "";

  const keywords = extractKeywords(question);
  if (keywords.length === 0) return "";

  // スコアリングして上位を取得
  const scored = chunks
    .map((chunk) => ({ chunk, score: scoreChunk(chunk, keywords) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_MINUTES_CHUNKS);

  if (scored.length === 0) return "";

  const lines: string[] = ["### 関連議事録（キーワード検索結果）"];
  for (const { chunk } of scored) {
    const snippet =
      chunk.text.length > MAX_SNIPPET_CHARS
        ? chunk.text.slice(0, MAX_SNIPPET_CHARS) + "…"
        : chunk.text;
    lines.push(
      `\n【${chunk.councilName} / ${chunk.scheduleName} / ${chunk.title}】\n${snippet}`
    );
  }
  return lines.join("\n");
}

const BASE_CONTEXT = buildBaseContext();
const MINUTE_CHUNKS = buildMinuteChunks();

const SYSTEM_PROMPT_BASE = `あなたは千歳市議会の情報アシスタントです。
以下の千歳市議会データを参照して、ユーザーの質問に日本語で正確かつ簡潔に答えてください。

【回答ルール】
- 提供データに基づいた事実のみを回答してください
- データにない情報は「データに含まれていないため確認できません」と明示してください
- 議員名・会派名・委員会名はデータの表記に従ってください
- 議事録の発言を引用する際は「【会議名 / 日付 / 発言者】」の形式で出典を示してください

【千歳市議会データ】
${BASE_CONTEXT}`;

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  // Rate limit check
  const ip = getClientIP(req);
  const { allowed, remaining } = checkRateLimit(ip);
  if (!allowed) {
    return NextResponse.json(
      { error: `1日の利用上限（${MAX_REQUESTS_PER_DAY}回）に達しました。明日またお試しください。` },
      { status: 429 }
    );
  }

  // Parse request body
  let question: string;
  try {
    const body = await req.json();
    question = (body.question ?? "").trim();
    if (!question) throw new Error("empty");
  } catch {
    return NextResponse.json(
      { error: "質問を入力してください。" },
      { status: 400 }
    );
  }

  // API key check
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY が設定されていません。" },
      { status: 500 }
    );
  }

  // Build per-request system prompt: base context + relevant minutes snippets
  const minutesContext = searchMinutes(question, MINUTE_CHUNKS);
  const systemPrompt = minutesContext
    ? `${SYSTEM_PROMPT_BASE}\n\n${minutesContext}`
    : SYSTEM_PROMPT_BASE;

  // Stream response from Claude
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const claudeStream = anthropic.messages.stream({
    model: "claude-opus-4-6",
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: "user", content: question }],
  });

  const readableStream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        for await (const chunk of claudeStream) {
          if (
            chunk.type === "content_block_delta" &&
            chunk.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(chunk.delta.text));
          }
        }
      } catch (err) {
        controller.error(err);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readableStream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-RateLimit-Remaining": String(remaining),
    },
  });
}
