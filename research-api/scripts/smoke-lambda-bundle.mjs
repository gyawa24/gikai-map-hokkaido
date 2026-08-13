import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const bundlePath = path.resolve(".aws-sam/build/ResearchFunction/lambda.js");
const searchIndexPath = path.resolve("../site/public/generated/search-index.json");
const dataPath = path.resolve("../site/data");
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "gikai-research-lambda-"));
const copiedBundle = path.join(directory, "lambda.js");

const invocation = String.raw`
const mod = require("./lambda.js");
const event = {
  body: JSON.stringify({
    query: "北海道内の学校給食無償化について整理してください。",
    mode: "research",
  }),
  headers: {},
  httpMethod: "POST",
  isBase64Encoded: false,
  path: "/research",
  resource: "/research",
  requestContext: { requestId: "bundle-smoke-request" },
};
mod.handler(event, { awsRequestId: "bundle-smoke-context" }).then((response) => {
  const body = JSON.parse(response.body);
  console.log("BUNDLE_SMOKE=" + JSON.stringify({
    statusCode: response.statusCode,
    evidenceCount: body.metadata?.evidenceCount,
    aiStatus: body.metadata?.ai?.status,
    disclaimer: Boolean(body.disclaimer),
  }));
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
`;

try {
  await fs.copyFile(bundlePath, copiedBundle);
  const result = spawnSync(process.execPath, ["-e", invocation], {
    cwd: directory,
    encoding: "utf8",
    env: {
      ...process.env,
      AWS_REGION: "ap-northeast-1",
      AI_ENABLED: "false",
      BEDROCK_MODEL_ID: "",
      USAGE_TABLE_NAME: "",
      GIKAI_SEARCH_INDEX_PATH: searchIndexPath,
      GIKAI_DATA_PATH: dataPath,
      GIKAI_FETCH_TIMEOUT_MS: "5000",
    },
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  assert.equal(result.status, 0, "SAM bundleのNode実行に失敗しました");
  const marker = result.stdout
    .split("\n")
    .find((line) => line.startsWith("BUNDLE_SMOKE="));
  assert.ok(marker, "bundle smoke結果がありません");
  const output = JSON.parse(marker.slice("BUNDLE_SMOKE=".length));
  assert.equal(output.statusCode, 200);
  assert.ok(output.evidenceCount > 0, "bundle smokeの根拠が0件です");
  assert.equal(output.aiStatus, "disabled");
  assert.equal(output.disclaimer, true);
  console.log("SAM bundle smoke passed.");
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}
