import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCityCapabilities } from "@/lib/cityCapabilities";
import { getMunicipalities } from "@/lib/municipalities";
import { checkRateLimit } from "@/lib/rateLimit";
import {
  getResearchAuthConfig,
  RESEARCH_SESSION_COOKIE_NAME,
  verifyResearchSessionToken,
} from "@/lib/researchAuth";
import { getResearchCoverageMunicipalityIds } from "@/lib/researchCoverage";
import { getClientAddress } from "@/lib/security";
import {
  RESEARCH_MODES,
  RESEARCH_QUERY_MAX_LENGTH,
  SOURCE_TYPES,
  type ResearchRequest,
} from "@/types/research";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_REQUEST_BODY_BYTES = 16 * 1024;
const RESEARCH_POST_LIMIT = 5;
const RESEARCH_WINDOW_SECONDS = 60;
const DEFAULT_TIMEOUT_MS = 55_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 60_000;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
};

const researchRequestSchema = z
  .object({
    query: z.string().trim().min(1).max(RESEARCH_QUERY_MAX_LENGTH),
    municipalities: z
      .array(z.string().regex(/^[a-z0-9-]+$/))
      .max(180)
      .optional(),
    sourceTypes: z.array(z.enum(SOURCE_TYPES)).max(SOURCE_TYPES.length).optional(),
    fiscalYears: z.array(z.number().int().min(1900).max(2200)).max(50).optional(),
    mode: z.enum(RESEARCH_MODES).optional(),
  })
  .strict();

const cityCapabilities = getCityCapabilities();
const researchCoverageMunicipalityIds = getResearchCoverageMunicipalityIds();
const searchableMunicipalitySlugs = new Set(
  getMunicipalities()
    .filter(
      (municipality) =>
        municipality.active &&
        municipality.minutes_access !== "restricted" &&
        (researchCoverageMunicipalityIds.size > 0
          ? researchCoverageMunicipalityIds.has(municipality.slug)
          : cityCapabilities[municipality.slug]?.capabilities.minutes),
    )
    .map((municipality) => municipality.slug)
);

class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Request body is too large");
    this.name = "RequestBodyTooLargeError";
  }
}

type ErrorCode =
  | "INVALID_REQUEST"
  | "REQUEST_TOO_LARGE"
  | "RATE_LIMITED"
  | "UNAUTHORIZED"
  | "SERVICE_UNAVAILABLE"
  | "UPSTREAM_TIMEOUT";

function errorResponse(
  status: 400 | 401 | 413 | 429 | 503 | 504,
  code: ErrorCode,
  message: string,
  options?: { requestId?: string; retryAfter?: number }
) {
  const headers: Record<string, string> = { ...NO_STORE_HEADERS };
  if (options?.retryAfter) headers["Retry-After"] = String(options.retryAfter);

  return NextResponse.json(
    {
      error: { code, message },
      ...(options?.requestId ? { requestId: options.requestId } : {}),
    },
    { status, headers }
  );
}

function parseContentLength(request: Request): number | null {
  const value = request.headers.get("content-length");
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

async function readRequestBody(request: Request): Promise<string> {
  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let body = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_REQUEST_BODY_BYTES) {
        await reader.cancel();
        throw new RequestBodyTooLargeError();
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return body;
  } finally {
    reader.releaseLock();
  }
}

function normalizeRequest(value: z.infer<typeof researchRequestSchema>): ResearchRequest {
  const municipalities = value.municipalities
    ? [...new Set(value.municipalities)]
    : undefined;
  const sourceTypes = value.sourceTypes ? [...new Set(value.sourceTypes)] : undefined;
  const fiscalYears = value.fiscalYears
    ? [...new Set(value.fiscalYears)].sort((left, right) => left - right)
    : undefined;

  return {
    query: value.query,
    mode: value.mode ?? "research",
    ...(municipalities?.length ? { municipalities } : {}),
    ...(sourceTypes?.length ? { sourceTypes } : {}),
    ...(fiscalYears?.length ? { fiscalYears } : {}),
  };
}

function getUpstreamUrl(): URL | null {
  const rawUrl = process.env.POLICY_RESEARCH_API_URL?.trim();
  if (!rawUrl) return null;

  try {
    const url = new URL(rawUrl);
    const allowedProtocol =
      url.protocol === "https:" ||
      (process.env.NODE_ENV !== "production" && url.protocol === "http:");
    if (!allowedProtocol || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function getTimeoutMs(): number {
  const rawValue = process.env.POLICY_RESEARCH_TIMEOUT_MS;
  if (!rawValue || !/^\d+$/.test(rawValue)) return DEFAULT_TIMEOUT_MS;
  const parsed = Number.parseInt(rawValue, 10);
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, parsed));
}

function getRetryAfter(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, 3600) : undefined;
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const authConfig = getResearchAuthConfig();
  if (!authConfig) {
    return errorResponse(
      503,
      "SERVICE_UNAVAILABLE",
      "政策AIリサーチャーは現在利用できません。",
      { requestId }
    );
  }
  const authenticated = await verifyResearchSessionToken(
    request.cookies.get(RESEARCH_SESSION_COOKIE_NAME)?.value,
    authConfig
  );
  if (!authenticated) {
    return errorResponse(
      401,
      "UNAUTHORIZED",
      "アクセス時間が切れました。ページを再読み込みして、もう一度ログインしてください。",
      { requestId }
    );
  }

  const contentLength = parseContentLength(request);
  if (contentLength !== null && contentLength > MAX_REQUEST_BODY_BYTES) {
    return errorResponse(
      413,
      "REQUEST_TOO_LARGE",
      "リクエスト本文が大きすぎます。",
      { requestId }
    );
  }

  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return errorResponse(
      400,
      "INVALID_REQUEST",
      "Content-Type: application/json で送信してください。",
      { requestId }
    );
  }

  const rateLimit = await checkRateLimit({
    bucket: "api-research-post",
    key: getClientAddress(request),
    limit: RESEARCH_POST_LIMIT,
    windowSeconds: RESEARCH_WINDOW_SECONDS,
  });
  if (!rateLimit.ok) {
    return errorResponse(
      429,
      "RATE_LIMITED",
      "調査回数の上限に達しました。少し待ってから再度お試しください。",
      { requestId, retryAfter: rateLimit.retryAfterSeconds }
    );
  }

  let rawBody: string;
  try {
    rawBody = await readRequestBody(request);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return errorResponse(
        413,
        "REQUEST_TOO_LARGE",
        "リクエスト本文が大きすぎます。",
        { requestId }
      );
    }
    return errorResponse(400, "INVALID_REQUEST", "リクエスト本文を読み取れませんでした。", {
      requestId,
    });
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody) as unknown;
  } catch {
    return errorResponse(400, "INVALID_REQUEST", "有効なJSONを送信してください。", {
      requestId,
    });
  }

  const parsed = researchRequestSchema.safeParse(json);
  if (!parsed.success) {
    return errorResponse(
      400,
      "INVALID_REQUEST",
      `入力内容を確認してください。質問は1〜${RESEARCH_QUERY_MAX_LENGTH}文字で指定できます。`,
      { requestId }
    );
  }

  const unknownMunicipality = parsed.data.municipalities?.find(
    (slug) => !searchableMunicipalitySlugs.has(slug)
  );
  if (unknownMunicipality) {
    return errorResponse(
      400,
      "INVALID_REQUEST",
      "自治体の指定に未対応の値が含まれています。",
      { requestId }
    );
  }

  const upstreamUrl = getUpstreamUrl();
  const apiKey = process.env.POLICY_RESEARCH_API_KEY?.trim();
  if (!upstreamUrl || !apiKey) {
    return errorResponse(
      503,
      "SERVICE_UNAVAILABLE",
      "政策AIリサーチャーは現在利用できません。",
      { requestId }
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getTimeoutMs());

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "x-request-id": requestId,
      },
      body: JSON.stringify(normalizeRequest(parsed.data)),
      cache: "no-store",
      signal: controller.signal,
    });

    if (!upstreamResponse.ok) {
      if (upstreamResponse.status === 400) {
        return errorResponse(400, "INVALID_REQUEST", "入力内容を確認してください。", {
          requestId,
        });
      }
      if (upstreamResponse.status === 413) {
        return errorResponse(
          413,
          "REQUEST_TOO_LARGE",
          "リクエスト本文が大きすぎます。",
          { requestId }
        );
      }
      if (upstreamResponse.status === 429) {
        return errorResponse(
          429,
          "RATE_LIMITED",
          "調査回数の上限に達しました。少し待ってから再度お試しください。",
          { requestId, retryAfter: getRetryAfter(upstreamResponse) }
        );
      }
      if (upstreamResponse.status === 504) {
        return errorResponse(
          504,
          "UPSTREAM_TIMEOUT",
          "調査に時間がかかっています。少し待ってから再度お試しください。",
          { requestId }
        );
      }
      return errorResponse(
        503,
        "SERVICE_UNAVAILABLE",
        "政策AIリサーチャーは現在利用できません。",
        { requestId }
      );
    }

    let responseBody: unknown;
    try {
      responseBody = await upstreamResponse.json();
    } catch {
      return errorResponse(
        503,
        "SERVICE_UNAVAILABLE",
        "政策AIリサーチャーから有効な応答を受け取れませんでした。",
        { requestId }
      );
    }

    return NextResponse.json(responseBody, { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return errorResponse(
        504,
        "UPSTREAM_TIMEOUT",
        "調査に時間がかかっています。少し待ってから再度お試しください。",
        { requestId }
      );
    }
    return errorResponse(
      503,
      "SERVICE_UNAVAILABLE",
      "政策AIリサーチャーは現在利用できません。",
      { requestId }
    );
  } finally {
    clearTimeout(timeout);
  }
}
