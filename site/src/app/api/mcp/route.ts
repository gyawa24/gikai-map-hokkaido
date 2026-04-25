// 議員向けに gikai を配布するためのリモート MCP エンドポイント。
// Claude.ai / ChatGPT のカスタムコネクタから Bearer 認証で叩かれる。
//
// 設計: stateless（serverless 適合、セッション状態はサーバ側に持たない）。
// JSON 応答（SSE ではない）。我々のツールはどれも 1 リクエストで完結する。
//
// 認証: 環境変数 MCP_API_KEYS に JSON マップで定義されたキーのみ受理。
//   例: {"小川": "gkmcp_xxxxxxxxxxxxxxxx", "○○議員": "gkmcp_yyyyyyyyyyyyyyyy"}
//
// 法的整理: HTTP 配布版は restricted index（札幌市等）を読まない。
//   読込パスを渡さないことで物理的に到達しない。
import { NextRequest } from "next/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import path from "node:path";
import { registerTools } from "@/lib/mcp/tools.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// In-memory rate limit。Vercel Function はリクエスト毎にコンテナ起き直しになるため
// 厳密な制限ではないが、暴走系の保険にはなる。
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();
const MAX_PER_MINUTE = 60;
const MINUTE_MS = 60 * 1000;

function rateLimitOk(label: string): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(label);
  if (!entry || now > entry.resetTime) {
    rateLimitStore.set(label, { count: 1, resetTime: now + MINUTE_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= MAX_PER_MINUTE;
}

type AuthResult =
  | { ok: true; label: string }
  | { ok: false; status: number; error: string };

function authenticate(req: Request): AuthResult {
  const header = req.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "missing_bearer_token" };
  }
  const token = header.slice(7).trim();
  if (!token) return { ok: false, status: 401, error: "empty_token" };

  const raw = process.env.MCP_API_KEYS;
  if (!raw) return { ok: false, status: 500, error: "MCP_API_KEYS_not_configured" };
  let keys: Record<string, string>;
  try {
    keys = JSON.parse(raw);
  } catch {
    return { ok: false, status: 500, error: "MCP_API_KEYS_invalid_json" };
  }
  for (const [label, key] of Object.entries(keys)) {
    if (typeof key === "string" && key === token) return { ok: true, label };
  }
  return { ok: false, status: 401, error: "invalid_token" };
}

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function handle(req: NextRequest): Promise<Response> {
  const auth = authenticate(req);
  if (!auth.ok) return jsonError(auth.status, auth.error);
  if (!rateLimitOk(auth.label)) return jsonError(429, "rate_limit_exceeded");

  const server = new McpServer({ name: "gikai", version: "0.2.0" });
  registerTools(server, {
    dataDir: path.join(process.cwd(), "data"),
    // restrictedIndexPath は意図的に渡さない（配布版で公開してはいけない）
  });

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
export async function GET(req: NextRequest) {
  return handle(req);
}
export async function DELETE(req: NextRequest) {
  return handle(req);
}
