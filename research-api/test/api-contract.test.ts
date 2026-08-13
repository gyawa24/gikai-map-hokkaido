import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import type { APIGatewayProxyEvent, Context } from "aws-lambda";

import { ResearchApplication } from "../src/application.js";
import { handleApiRequest } from "../src/api/handler.js";
import { handler as lambdaHandler } from "../src/api/lambda.js";
import type { ResearchConfig } from "../src/config.js";
import { InMemoryQuotaStore } from "../src/infrastructure/quota-store.js";
import { ResearchService } from "../src/research/core/researchService.js";
import { QueryRouter } from "../src/research/router/queryRouter.js";
import type {
  PolicySourceAdapter,
  PolicySourceDocument,
  ResearchSearchQuery,
  SourceType,
} from "../src/research/types.js";

function config(): ResearchConfig {
  return {
    awsRegion: "ap-northeast-1",
    aiEnabled: false,
    bedrockMaxOutputTokens: 1000,
    bedrockTimeoutMs: 9000,
    gikaiFetchTimeoutMs: 5000,
    maxResultsPerSearch: 20,
    maxEvidenceItems: 8,
    maxEvidenceChars: 30000,
    maxLlmCallsPerRequest: 2,
    maxDailyRequests: 50,
    maxMonthlyRequests: 500,
    researchCacheTtlSeconds: 600,
    indexCacheTtlSeconds: 900,
    gikaiSearchIndexUrl: "https://example.test/generated/search-index.json",
    gikaiCityIndexBaseUrl: "https://example.test/generated/search-indexes",
    gikaiDataRawBaseUrl: "https://example.test/data",
    gikaiPublicBaseUrl: "https://chihougikai.com",
    debugResearch: false,
    port: 8788,
  };
}

class StaticMinutesAdapter implements PolicySourceAdapter {
  readonly sourceTypes: SourceType[] = ["plenary_minutes"];

  async search(query: ResearchSearchQuery): Promise<PolicySourceDocument[]> {
    return [
      {
        id: "agenda:chitose:1:0:10",
        municipalityId: query.municipalities?.[0] ?? "chitose",
        municipalityName: "千歳市",
        sourceType: "plenary_minutes",
        title: "令和7年第1回定例会",
        meetingName: "令和7年第1回定例会",
        date: "2025-03-03",
        text: "教育支援センターによる不登校支援について議論した。",
        sourceUrl: "https://chihougikai.com/chitose/minutes/1",
        evidenceLevel: "excerpt_verified",
      },
    ];
  }
}

function application(limits = { daily: 50, monthly: 500 }): ResearchApplication {
  const appConfig = config();
  const service = new ResearchService(
    appConfig,
    new QueryRouter([new StaticMinutesAdapter()]),
    { createRequestId: () => "service-request", now: () => 100 },
  );
  return new ResearchApplication(appConfig, {
    service,
    quotaStore: new InMemoryQuotaStore(limits),
    createRequestId: () => "application-request",
    now: () => 100,
  });
}

test("REST API契約: 構造化ResearchResponseと根拠を返す", async () => {
  const result = await handleApiRequest(
    {
      route: "research",
      requestId: "request-rest-1",
      body: JSON.stringify({
        query: "千歳市の不登校支援について整理してください。",
        municipalities: ["chitose"],
        sourceTypes: ["plenary_minutes"],
        mode: "research",
      }),
    },
    application(),
  );

  assert.equal(result.statusCode, 200);
  assert.equal(result.headers["cache-control"], "no-store, max-age=0");
  const body = JSON.parse(result.body) as Record<string, unknown>;
  assert.equal(body.requestId, "request-rest-1");
  const responseResult = body.result as Record<string, unknown>;
  assert.equal(Array.isArray(responseResult.evidences), true);
  assert.match(String(body.disclaimer), /検索結果がないことは/);
});

test("源内同期API契約: inputsを受け取りMarkdown outputsを返す", async () => {
  const result = await handleApiRequest(
    {
      route: "genai",
      requestId: "request-genai-1",
      body: JSON.stringify({
        inputs: {
          question: "不登校支援について整理してください。",
          municipalities: "chitose",
          fiscal_years: "2024,2025",
          mode: "question_prep",
        },
      }),
    },
    application(),
  );

  assert.equal(result.statusCode, 200);
  const body = JSON.parse(result.body) as { outputs?: unknown };
  assert.equal(typeof body.outputs, "string");
  assert.match(String(body.outputs), /## 調査概要/);
  assert.match(String(body.outputs), /## 根拠資料/);
  assert.match(String(body.outputs), /https:\/\/chihougikai\.com\/chitose\/minutes\/1/);
  assert.match(String(body.outputs), /検索結果がないことは/);
});

test("API契約: 共通入力検証とquota超過をHTTPエラーへ変換する", async () => {
  const invalid = await handleApiRequest(
    { route: "research", requestId: "request-invalid", body: "{}" },
    application(),
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(
    (JSON.parse(invalid.body) as { error: { code: string } }).error.code,
    "INVALID_REQUEST",
  );

  const limited = application({ daily: 1, monthly: 1 });
  const request = {
    route: "research" as const,
    body: JSON.stringify({ query: "不登校支援" }),
  };
  assert.equal(
    (await handleApiRequest({ ...request, requestId: "request-first" }, limited))
      .statusCode,
    200,
  );
  const exceeded = await handleApiRequest(
    { ...request, requestId: "request-second" },
    limited,
  );
  assert.equal(exceeded.statusCode, 429);
  assert.equal(exceeded.headers["retry-after"], "60");
  assert.equal(
    (JSON.parse(exceeded.body) as { error: { code: string } }).error.code,
    "RATE_LIMITED",
  );
});

function lambdaEvent(
  overrides: Partial<APIGatewayProxyEvent>,
): APIGatewayProxyEvent {
  return {
    body: null,
    headers: {},
    httpMethod: "GET",
    isBase64Encoded: false,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    path: "/research",
    pathParameters: null,
    queryStringParameters: null,
    requestContext: { requestId: "gateway-request" },
    resource: "/research",
    stageVariables: null,
    ...overrides,
  } as APIGatewayProxyEvent;
}

const lambdaContext = {
  awsRequestId: "lambda-request",
} as Context;

test("Lambda契約: route・method・32KB上限を入口で拒否する", async () => {
  const method = await lambdaHandler(lambdaEvent({}), lambdaContext);
  assert.equal(method.statusCode, 405);

  const missing = await lambdaHandler(
    lambdaEvent({ httpMethod: "POST", path: "/missing", resource: "/missing" }),
    lambdaContext,
  );
  assert.equal(missing.statusCode, 404);

  const oversized = await lambdaHandler(
    lambdaEvent({
      body: "x".repeat(32 * 1024 + 1),
      httpMethod: "POST",
    }),
    lambdaContext,
  );
  assert.equal(oversized.statusCode, 413);
  assert.equal(
    (JSON.parse(oversized.body) as { error: { code: string } }).error.code,
    "REQUEST_TOO_LARGE",
  );
});

test("源内リクエスト形式定義は現行の同期inputs/outputs契約に一致する", async () => {
  const definition = JSON.parse(
    await fs.readFile(
      "config/genai-request-definition.json",
      "utf8",
    ),
  ) as Record<string, Record<string, unknown>>;

  assert.equal(definition.question?.type, "textarea");
  assert.equal(definition.question?.required, true);
  assert.equal(definition.question?.max_length, 2000);
  assert.equal(definition.municipalities?.type, "text");
  assert.equal(definition.fiscal_years?.type, "text");
  assert.equal(definition.mode?.type, "radio");
  assert.deepEqual(
    (definition.mode?.items as Array<{ value: string }>).map((item) => item.value),
    ["research", "comparison", "question_prep"],
  );
});
