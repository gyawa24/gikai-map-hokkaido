import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { ResearchApplication } from "../application.js";
import { loadConfig } from "../config.js";
import { handleApiRequest, type ApiRoute } from "../api/handler.js";

const MAX_BODY_BYTES = 32 * 1024;
const config = loadConfig();
const application = new ResearchApplication(config);

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function authorized(request: IncomingMessage): boolean {
  if (!config.localApiKey) return true;
  const value = request.headers["x-api-key"];
  return typeof value === "string" && secureEqual(value, config.localApiKey);
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("request_body_too_large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function send(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store, max-age=0",
  });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (request.method === "GET" && url.pathname === "/health") {
    send(response, 200, { ok: true, aiConfigured: Boolean(config.bedrockModelId) });
    return;
  }
  const route: ApiRoute | null =
    url.pathname === "/research"
      ? "research"
      : url.pathname === "/invoke"
        ? "genai"
        : null;
  if (!route) {
    send(response, 404, { error: { code: "NOT_FOUND" } });
    return;
  }
  if (request.method !== "POST") {
    response.setHeader("allow", "POST");
    send(response, 405, { error: { code: "METHOD_NOT_ALLOWED" } });
    return;
  }
  if (!authorized(request)) {
    send(response, 403, { error: { code: "FORBIDDEN" } });
    return;
  }

  let body: string;
  try {
    body = await readBody(request);
  } catch {
    send(response, 413, {
      error: { code: "REQUEST_TOO_LARGE", message: "リクエスト本文が大きすぎます。" },
    });
    return;
  }
  const requestIdHeader = request.headers["x-request-id"];
  const requestId =
    typeof requestIdHeader === "string" && /^[A-Za-z0-9-]{8,80}$/.test(requestIdHeader)
      ? requestIdHeader
      : randomUUID();
  const result = await handleApiRequest({ route, body, requestId }, application);
  response.writeHead(result.statusCode, result.headers);
  response.end(result.body);
});

server.listen(config.port, "127.0.0.1", () => {
  process.stdout.write(
    `${JSON.stringify({ event: "policy_research_local_started", port: config.port })}\n`,
  );
});
