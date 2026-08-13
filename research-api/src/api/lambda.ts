import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";

import { ResearchApplication } from "../application.js";
import { loadConfig } from "../config.js";
import { handleApiRequest, type ApiRoute } from "./handler.js";

const MAX_BODY_BYTES = 32 * 1024;
const application = new ResearchApplication(loadConfig());

function requestBody(event: APIGatewayProxyEvent): string {
  const raw = event.body ?? "";
  const body = event.isBase64Encoded
    ? Buffer.from(raw, "base64").toString("utf8")
    : raw;
  if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
    throw new Error("request_body_too_large");
  }
  return body;
}

function routeFor(event: APIGatewayProxyEvent): ApiRoute | null {
  const resource = event.resource || event.path;
  if (resource.endsWith("/invoke")) return "genai";
  if (resource.endsWith("/research")) return "research";
  return null;
}

export async function handler(
  event: APIGatewayProxyEvent,
  context: Context,
): Promise<APIGatewayProxyResult> {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "content-type": "application/json; charset=utf-8", allow: "POST" },
      body: JSON.stringify({ error: { code: "METHOD_NOT_ALLOWED" } }),
    };
  }
  const route = routeFor(event);
  if (!route) {
    return {
      statusCode: 404,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ error: { code: "NOT_FOUND" } }),
    };
  }

  let body: string;
  try {
    body = requestBody(event);
  } catch {
    return {
      statusCode: 413,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
      body: JSON.stringify({
        error: { code: "REQUEST_TOO_LARGE", message: "リクエスト本文が大きすぎます。" },
        requestId: event.requestContext.requestId || context.awsRequestId,
      }),
    };
  }

  return handleApiRequest(
    {
      route,
      body,
      requestId: event.requestContext.requestId || context.awsRequestId,
    },
    application,
  );
}
