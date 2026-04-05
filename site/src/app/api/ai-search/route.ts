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
// Context: load all JSON data once at module init
// ---------------------------------------------------------------------------
function buildContext(): string {
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

const CONTEXT = buildContext();

const SYSTEM_PROMPT = `あなたは千歳市議会の情報アシスタントです。
以下の千歳市議会データを参照して、ユーザーの質問に日本語で正確かつ簡潔に答えてください。

【回答ルール】
- 提供データに基づいた事実のみを回答してください
- データにない情報は「データに含まれていないため確認できません」と明示してください
- 議員名・会派名・委員会名はデータの表記に従ってください

【千歳市議会データ】
${CONTEXT}`;

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

  // Stream response from Claude
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const claudeStream = anthropic.messages.stream({
    model: "claude-opus-4-6",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
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
