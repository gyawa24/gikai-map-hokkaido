import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rateLimit";
import {
  createResearchSessionToken,
  getResearchAuthConfig,
  RESEARCH_SESSION_COOKIE_NAME,
  RESEARCH_SESSION_TTL_SECONDS,
  verifyResearchPassword,
} from "@/lib/researchAuth";
import { getClientAddress } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1024;
const LOGIN_ATTEMPT_LIMIT = 5;
const LOGIN_WINDOW_SECONDS = 15 * 60;
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
};

const loginSchema = z.object({ password: z.string().min(1).max(256) }).strict();

function errorResponse(status: 400 | 401 | 413 | 429 | 503, code: string, message: string, retryAfter?: number) {
  return NextResponse.json(
    { error: { code, message } },
    {
      status,
      headers: {
        ...NO_STORE_HEADERS,
        ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}),
      },
    }
  );
}

async function readLimitedBody(request: Request): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let body = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return body;
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: NextRequest) {
  const config = getResearchAuthConfig();
  if (!config) {
    return errorResponse(503, "SERVICE_UNAVAILABLE", "限定公開の設定が完了していません。");
  }

  const rateLimit = await checkRateLimit({
    bucket: "research-login-attempt",
    key: getClientAddress(request),
    limit: LOGIN_ATTEMPT_LIMIT,
    windowSeconds: LOGIN_WINDOW_SECONDS,
  });
  if (!rateLimit.ok) {
    return errorResponse(
      429,
      "RATE_LIMITED",
      "ログイン試行回数の上限に達しました。時間をおいて再度お試しください。",
      rateLimit.retryAfterSeconds
    );
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_BODY_BYTES) {
    return errorResponse(413, "REQUEST_TOO_LARGE", "リクエスト本文が大きすぎます。");
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return errorResponse(400, "INVALID_REQUEST", "入力内容を確認してください。");
  }

  const rawBody = await readLimitedBody(request);
  if (rawBody === null) {
    return errorResponse(413, "REQUEST_TOO_LARGE", "リクエスト本文が大きすぎます。");
  }

  let value: unknown;
  try {
    value = JSON.parse(rawBody);
  } catch {
    return errorResponse(400, "INVALID_REQUEST", "入力内容を確認してください。");
  }
  const parsed = loginSchema.safeParse(value);
  if (!parsed.success || !(await verifyResearchPassword(parsed.data.password, config))) {
    return errorResponse(401, "INVALID_CREDENTIALS", "パスワードが正しくありません。");
  }

  const session = await createResearchSessionToken(config);
  const response = NextResponse.json({ authenticated: true }, { headers: NO_STORE_HEADERS });
  response.cookies.set({
    name: RESEARCH_SESSION_COOKIE_NAME,
    value: session.token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: RESEARCH_SESSION_TTL_SECONDS,
    expires: session.expiresAt,
    priority: "high",
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ authenticated: false }, { headers: NO_STORE_HEADERS });
  response.cookies.set({
    name: RESEARCH_SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
    priority: "high",
  });
  return response;
}
