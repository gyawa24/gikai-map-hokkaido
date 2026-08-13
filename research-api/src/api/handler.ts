import type { ResearchApplication } from "../application.js";
import { QuotaExceededError } from "../application.js";
import { fromGenaiRequest, toGenaiResponse } from "../integrations/genai/mapper.js";
import { parseJsonBody, parseResearchRequest, RequestValidationError } from "./request.js";
import { hashQuestion, writeResearchLog } from "../infrastructure/research-logger.js";

export type ApiRoute = "research" | "genai";

export interface ApiRequest {
  route: ApiRoute;
  body: string;
  requestId: string;
}

export interface ApiResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store, max-age=0",
  pragma: "no-cache",
};

function response(statusCode: number, body: unknown, headers: Record<string, string> = {}): ApiResponse {
  return {
    statusCode,
    headers: { ...JSON_HEADERS, ...headers },
    body: JSON.stringify(body),
  };
}

export async function handleApiRequest(
  request: ApiRequest,
  application: ResearchApplication,
): Promise<ApiResponse> {
  const startedAt = Date.now();
  let queryHash: string | undefined;
  try {
    const parsedBody = parseJsonBody(request.body);
    const query =
      request.route === "genai"
        ? fromGenaiRequest(parsedBody)
        : parseResearchRequest(parsedBody);
    queryHash = hashQuestion(query.query);
    const researchResponse = await application.execute(query, request.requestId);
    const body =
      request.route === "genai"
        ? toGenaiResponse(researchResponse)
        : researchResponse;
    writeResearchLog({
      requestId: request.requestId,
      route: request.route,
      statusCode: 200,
      durationMs: Date.now() - startedAt,
      queryHash,
      searchResultCount: researchResponse.metadata.searchResultCount,
      evidenceCount: researchResponse.metadata.evidenceCount,
      ...(researchResponse.metadata.ai.usage
        ? {
            inputTokens: researchResponse.metadata.ai.usage.inputTokens,
            outputTokens: researchResponse.metadata.ai.usage.outputTokens,
          }
        : {}),
      ...(researchResponse.metadata.ai.estimatedCostUsd !== undefined
        ? { estimatedCostUsd: researchResponse.metadata.ai.estimatedCostUsd }
        : {}),
      aiStatus: researchResponse.metadata.ai.status,
      ...(researchResponse.metadata.ai.errorCode
        ? { errorCode: researchResponse.metadata.ai.errorCode }
        : {}),
    });
    return response(200, body);
  } catch (error) {
    if (error instanceof RequestValidationError) {
      writeResearchLog({
        requestId: request.requestId,
        route: request.route,
        statusCode: 400,
        durationMs: Date.now() - startedAt,
        ...(queryHash ? { queryHash } : {}),
        errorCode: "invalid_request",
      });
      return response(400, {
        error: { code: "INVALID_REQUEST", message: error.message },
        requestId: request.requestId,
      });
    }
    if (error instanceof QuotaExceededError) {
      writeResearchLog({
        requestId: request.requestId,
        route: request.route,
        statusCode: 429,
        durationMs: Date.now() - startedAt,
        ...(queryHash ? { queryHash } : {}),
        errorCode: "quota_exceeded",
      });
      return response(
        429,
        {
          error: {
            code: "RATE_LIMITED",
            message: "調査回数の上限に達しました。時間をおいて再度お試しください。",
          },
          requestId: request.requestId,
        },
        { "retry-after": "60" },
      );
    }

    writeResearchLog({
      requestId: request.requestId,
      route: request.route,
      statusCode: 503,
      durationMs: Date.now() - startedAt,
      ...(queryHash ? { queryHash } : {}),
      errorCode: "service_unavailable",
    });
    return response(503, {
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "議事録検索を利用できませんでした。時間をおいて再度お試しください。",
      },
      requestId: request.requestId,
    });
  }
}
