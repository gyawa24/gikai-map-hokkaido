import assert from "node:assert/strict";

const baseUrl = (process.env.RESEARCH_API_BASE_URL ?? "http://127.0.0.1:8788").replace(/\/$/, "");
const apiKey = process.env.RESEARCH_API_KEY?.trim();

const cases = [
  {
    name: "学校給食の無償化",
    request: {
      query: "北海道内の学校給食の無償化について、議会での論点を整理してください。",
      mode: "research",
    },
  },
  {
    name: "不登校支援の3市比較",
    request: {
      query: "千歳市、恵庭市、苫小牧市の不登校支援を比較してください。",
      municipalities: ["chitose", "eniwa", "tomakomai"],
      mode: "comparison",
    },
    missingMunicipality: "苫小牧",
  },
  {
    name: "生成AIと自治体DX",
    request: {
      query: "北海道内の自治体における生成AI活用とDX推進の議会論点を整理してください。",
      mode: "research",
    },
  },
];

function validateResponse(testCase, body) {
  assert.equal(typeof body.requestId, "string", "requestId がありません");
  assert.equal(typeof body.disclaimer, "string", "disclaimer がありません");
  assert.match(body.disclaimer, /検索結果がないことは/);
  assert.ok(body.result && typeof body.result === "object", "result がありません");
  assert.ok(Array.isArray(body.result.evidences), "evidences が配列ではありません");
  assert.ok(body.result.evidences.length > 0, `${testCase.name}: 根拠が0件です`);
  assert.ok(body.metadata && typeof body.metadata === "object", "metadata がありません");
  assert.equal(body.metadata.evidenceCount, body.result.evidences.length);
  assert.ok(["completed", "fallback", "disabled"].includes(body.metadata.ai?.status));

  for (const evidence of body.result.evidences) {
    assert.match(String(evidence.sourceUrl), /^https:\/\//, "根拠URLが不正です");
    assert.ok(String(evidence.excerpt).trim().length > 0, "根拠抜粋が空です");
  }

  if (testCase.missingMunicipality) {
    const followUps = [
      ...(body.result.limitations ?? []),
      ...(body.result.nextResearchItems ?? []),
    ].join("\n");
    assert.match(followUps, new RegExp(testCase.missingMunicipality));
  }
}

for (const testCase of cases) {
  const headers = { "content-type": "application/json" };
  if (apiKey) headers["x-api-key"] = apiKey;

  const response = await fetch(`${baseUrl}/research`, {
    method: "POST",
    headers,
    body: JSON.stringify(testCase.request),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  assert.equal(response.status, 200, `${testCase.name}: HTTP ${response.status} ${text.slice(0, 300)}`);
  const body = JSON.parse(text);
  validateResponse(testCase, body);
  console.log(
    `OK ${testCase.name}: evidence=${body.metadata.evidenceCount}, ai=${body.metadata.ai.status}, durationMs=${body.metadata.durationMs}`,
  );
}

console.log(`All ${cases.length} research smoke cases passed: ${baseUrl}`);
