import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Rate limiting (in-memory)
// ---------------------------------------------------------------------------
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();
const MAX_REQUESTS_PER_DAY = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

function getClientIP(req: NextRequest): string {
  // Vercelではx-forwarded-forの最初のIPがクライアントIP（Vercelが付与）
  // x-real-ipはVercelが設定する信頼できるヘッダー
  return (
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
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
// Base context builders
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

const CITY_META = [
  { id: "chitose",       name: "千歳市" },
  { id: "eniwa",         name: "恵庭市" },
  { id: "tomakomai",     name: "苫小牧市" },
  { id: "asahikawa",     name: "旭川市" },
  { id: "ashibetsu",     name: "芦別市" },
  { id: "date",          name: "伊達市" },
  { id: "fukushima",     name: "福島町" },
  { id: "hakodate",      name: "函館市" },
  { id: "hokuto",        name: "北斗市" },
  { id: "ikeda",         name: "池田町" },
  { id: "ishikari",      name: "石狩市" },
  { id: "kamikawa",      name: "上川町" },
  { id: "kitahiroshima", name: "北広島市" },
  { id: "kitami",        name: "北見市" },
  { id: "kushiro",       name: "釧路市" },
  { id: "kutchan",       name: "倶知安町" },
  { id: "memuro",        name: "芽室町" },
  { id: "muroran",       name: "室蘭市" },
  { id: "nakagawa",      name: "中川町" },
  { id: "nayoro",        name: "名寄市" },
  { id: "nemuro",        name: "根室市" },
  { id: "noboribetsu",   name: "登別市" },
  { id: "obihiro",       name: "帯広市" },
  { id: "wakkanai",      name: "稚内市" },
];

function buildCompareBaseContext(): string {
  const sections: string[] = [];
  for (const city of CITY_META) {
    const dir = path.join(process.cwd(), "data", city.id);
    const tryRead = (file: string) => {
      try { return fs.readFileSync(path.join(dir, file), "utf-8"); } catch { return "（データなし）"; }
    };
    sections.push(
      `### ${city.name} 議員名簿\n` + tryRead("members.json"),
      `### ${city.name} 議決結果（直近）\n` + tryRead("decisions.json"),
    );

    // enriched サマリーを追加（最新3件、tags+summary のみ）
    const enrichedDir = path.join(dir, "minutes", "enriched");
    if (fs.existsSync(enrichedDir)) {
      let files: string[];
      try { files = fs.readdirSync(enrichedDir).filter((f) => f.endsWith(".json")).slice(-3); }
      catch { files = []; }
      for (const f of files) {
        try {
          const e = JSON.parse(fs.readFileSync(path.join(enrichedDir, f), "utf-8")) as {
            name?: string;
            tags?: string[];
            summary?: string;
          };
          if (!e.summary && !e.tags?.length) continue;
          sections.push(
            `### ${city.name} 議事録要約（${e.name ?? f}）\nタグ: ${(e.tags ?? []).join(", ")}\n要約: ${e.summary ?? ""}`
          );
        } catch { continue; }
      }
    }
  }
  return sections.join("\n\n");
}

// ---------------------------------------------------------------------------
// Minutes chunk index
// ---------------------------------------------------------------------------
interface MinuteChunk {
  city: string;
  cityName: string;
  councilName: string;
  year: string;
  typeLabel: string;
  scheduleName: string;
  title: string;
  text: string;
}

function loadChunksForCity(city: { id: string; name: string }): MinuteChunk[] {
  const minutesDir = path.join(process.cwd(), "data", city.id, "minutes");
  if (!fs.existsSync(minutesDir)) return [];

  const indexPath = path.join(minutesDir, "index.json");
  if (fs.existsSync(indexPath)) {
    // フルテキスト議事録がある市
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
            city: city.id,
            cityName: city.name,
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

  // フルテキストなし → enriched JSON から要約・ハイライト・タグをチャンクとして使用
  const enrichedDir = path.join(minutesDir, "enriched");
  if (!fs.existsSync(enrichedDir)) return [];

  interface EnrichedDoc {
    council_id: number;
    name: string;
    generated_at?: string;
    summary?: string;
    highlights?: string[];
    tags?: string[];
  }

  const chunks: MinuteChunk[] = [];
  let files: string[];
  try { files = fs.readdirSync(enrichedDir).filter((f) => f.endsWith(".json")); }
  catch { return []; }

  for (const file of files) {
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(enrichedDir, file), "utf-8")) as EnrichedDoc;
      const year = doc.generated_at?.slice(0, 4) ?? "";
      const summaryText = [
        doc.summary ?? "",
        ...(doc.highlights ?? []),
        (doc.tags ?? []).join("、"),
      ].filter(Boolean).join("\n");
      if (!summaryText.trim()) continue;
      chunks.push({
        city: city.id,
        cityName: city.name,
        councilName: doc.name,
        year,
        typeLabel: "議事録（AI要約）",
        scheduleName: "要約・ハイライト",
        title: doc.name,
        text: summaryText,
      });
    } catch { continue; }
  }

  return chunks;
}

function buildMinuteChunks(): MinuteChunk[] {
  return CITY_META.flatMap(loadChunksForCity);
}

// ---------------------------------------------------------------------------
// Keyword search
// ---------------------------------------------------------------------------
const STOP_WORDS = new Set([
  "は", "が", "を", "に", "で", "と", "も", "の", "へ", "から", "まで",
  "より", "など", "か", "や", "て", "で", "ば", "し", "ね", "よ", "な",
  "この", "その", "あの", "どの", "ここ", "そこ", "あそこ", "どこ",
  "こと", "もの", "ため", "よう", "ほど", "くらい", "だけ", "しか",
  "について", "において", "に関して", "に関する", "として", "による",
  "教えて", "ください", "何", "どう", "どんな", "いつ", "だれ", "誰",
  "あります", "います", "ありますか", "いますか",
  "比較", "違い", "異なる", "共通", "それぞれ", "各市", "3市", "三市",
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

function scoreChunk(chunk: MinuteChunk, keywords: string[]): number {
  if (keywords.length === 0) return 0;
  const haystack = (chunk.title + " " + chunk.text).toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    const kl = kw.toLowerCase();
    if (haystack.includes(kl)) {
      score += chunk.title.toLowerCase().includes(kl) ? 3 : 1;
      const count = (haystack.match(new RegExp(kl, "g")) ?? []).length;
      score += Math.min(count, 5);
    }
  }
  return score;
}

const MAX_SNIPPET_CHARS_NORMAL  = 800;
const MAX_SNIPPET_CHARS_COMPARE = 1200;

/** 通常モード: 全市合計でスコア上位を取得 */
function searchMinutesNormal(question: string, chunks: MinuteChunk[], maxChunks: number): string {
  return searchMinutesCore(question, chunks, maxChunks, MAX_SNIPPET_CHARS_NORMAL);
}

/** 比較モード: 市ごとに均等 chunksPerCity 件ずつ取得して結合 */
function searchMinutesCompare(
  question: string,
  chunks: MinuteChunk[],
  chunksPerCity: number,
): string {
  const cityIds = [...new Set(chunks.map((c) => c.city))];
  const perCityResults = cityIds
    .map((cityId) => {
      const pool = chunks.filter((c) => c.city === cityId);
      return searchMinutesCore(question, pool, chunksPerCity, MAX_SNIPPET_CHARS_COMPARE);
    })
    .filter(Boolean);

  return perCityResults.length > 0
    ? "### 関連議事録（市別キーワード検索結果）\n" + perCityResults.map((r) =>
        // 各市のヘッダー行を除いて本文だけ結合
        r.replace(/^### 関連議事録（キーワード検索結果）\n?/, "")
      ).join("\n")
    : "";
}

function searchMinutesCore(
  question: string,
  chunks: MinuteChunk[],
  maxChunks: number,
  snippetChars: number,
): string {
  if (chunks.length === 0) return "";

  const keywords = extractKeywords(question);
  if (keywords.length === 0) return "";

  const scored = chunks
    .map((chunk) => ({ chunk, score: scoreChunk(chunk, keywords) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxChunks);

  if (scored.length === 0) return "";

  const lines: string[] = ["### 関連議事録（キーワード検索結果）"];
  for (const { chunk } of scored) {
    const snippet =
      chunk.text.length > snippetChars
        ? chunk.text.slice(0, snippetChars) + "…"
        : chunk.text;
    lines.push(
      `\n【${chunk.cityName} ${chunk.councilName} / ${chunk.scheduleName} / ${chunk.title}】\n${snippet}`
    );
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------
const BASE_CONTEXT = buildBaseContext();
const COMPARE_BASE_CONTEXT = buildCompareBaseContext();
const MINUTE_CHUNKS = buildMinuteChunks();

const SYSTEM_PROMPT_NORMAL = `あなたは北海道の市議会情報アシスタントです。
北海道内の複数の市議会データをもとに、ユーザーの質問に日本語で正確かつ簡潔に答えてください。

【回答ルール】
- 提供データに基づいた事実のみを回答してください
- データにない情報は「データに含まれていないため確認できません」と明示してください
- 議員名・会派名・委員会名はデータの表記に従ってください
- 議事録の発言を引用する際は「【市名 会議名 / 日付 / 発言者】」の形式で出典を示してください
- できる限り具体的に、発言内容を引用しながら回答してください

【千歳市議会データ】
${BASE_CONTEXT}`;

const SYSTEM_PROMPT_COMPARE = `あなたは北海道の市議会情報アシスタントです。
以下のテーマについて千歳市・恵庭市・苫小牧市の議会での議論を比較してください。

【回答形式】
必ず以下のフォーマットで回答してください。データがない項目は「記録なし」と記載してください。

【テーマ: ○○】

■ 千歳市
- 予算・規模: （金額・規模に関する情報）
- 方針・特徴: （議会での方針や特徴的な取り組み）
- 課題・議論: （議員が指摘した課題や議論の焦点）
- 主な発言: （具体的な発言の引用）

■ 恵庭市
- 予算・規模:
- 方針・特徴:
- 課題・議論:
- 主な発言:

■ 苫小牧市
- 予算・規模:
- 方針・特徴:
- 課題・議論:
- 主な発言:

【3市の比較まとめ】
similarities: （3市に共通する点）
differences: （3市で異なる点・特色）
insights: （比較から見えてくる気づき・考察）

【回答ルール】
- 提供データに基づいた事実のみを記載してください
- 議事録の発言を引用する際は「【市名 会議名 / 日付 / 発言者】」の形式で出典を示してください
- データにない情報は「記録なし」と記載し、憶測で補わないでください
- 3市すべてのデータを公平に扱い、偏りなく比較してください

【3市の議員・議決データ】
${COMPARE_BASE_CONTEXT}`;

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const ip = getClientIP(req);
  const { allowed, remaining } = checkRateLimit(ip);
  if (!allowed) {
    return NextResponse.json(
      { error: `1日の利用上限（${MAX_REQUESTS_PER_DAY}回）に達しました。明日またお試しください。` },
      { status: 429 }
    );
  }

  let question: string;
  let compareMode: boolean;
  try {
    const body = await req.json();
    question = (body.question ?? "").trim();
    compareMode = body.compareMode === true;
    if (!question) throw new Error("empty");
    if (question.length > 500) {
      return NextResponse.json(
        { error: "質問は500文字以内にしてください。" },
        { status: 400 }
      );
    }
  } catch {
    return NextResponse.json(
      { error: "質問を入力してください。" },
      { status: 400 }
    );
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY が設定されていません。" },
      { status: 500 }
    );
  }

  // 比較モード: 市ごとに均等 10 チャンク（計30）、スニペット 1200 字
  // 通常モード: 全市合計 15 チャンク、スニペット 800 字
  const minutesContext = compareMode
    ? searchMinutesCompare(question, MINUTE_CHUNKS, 10)
    : searchMinutesNormal(question, MINUTE_CHUNKS, 15);

  const basePrompt = compareMode ? SYSTEM_PROMPT_COMPARE : SYSTEM_PROMPT_NORMAL;
  const systemPrompt = minutesContext
    ? `${basePrompt}\n\n${minutesContext}`
    : basePrompt;

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const claudeStream = anthropic.messages.stream({
    model: "claude-opus-4-6",
    max_tokens: compareMode ? 4096 : 1024,
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
