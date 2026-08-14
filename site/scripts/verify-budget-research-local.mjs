const baseUrl = process.env.BUDGET_RESEARCH_TEST_URL?.trim() || "http://localhost:3414";
const password = process.env.POLICY_RESEARCH_ACCESS_PASSWORD;

if (!password) {
  throw new Error("POLICY_RESEARCH_ACCESS_PASSWORD is required");
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

async function post(path, body, cookie, testClientIp = "198.51.100.10") {
  return fetch(new URL(path, baseUrl), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Real-IP": testClientIp,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
    redirect: "manual",
  });
}

const anonymous = await post("/api/research", {
  query: "市税",
  municipalities: ["chitose"],
  sourceTypes: ["budget"],
});
invariant(anonymous.status === 401, `anonymous request: expected 401, received ${anonymous.status}`);

const login = await post("/api/research/session", { password });
invariant(login.status === 200, `login: expected 200, received ${login.status}`);
const sessionCookie = login.headers.get("set-cookie")?.split(";", 1)[0];
invariant(sessionCookie, "login: session cookie is missing");

const cityQueries = [
  ["chitose", "千歳市"],
  ["eniwa", "恵庭市"],
  ["ebetsu", "江別市"],
  ["asahikawa", "旭川市"],
  ["sapporo", "札幌市"],
];

for (const [cityIndex, [municipalityId, municipalityName]] of cityQueries.entries()) {
  const response = await post(
    "/api/research",
    {
      query: "市税をR7とR8で比較し、差額と出典を表示",
      municipalities: [municipalityId],
      sourceTypes: ["budget"],
      fiscalYears: [2025, 2026],
      mode: "research",
    },
    sessionCookie,
    `198.51.100.${cityIndex + 11}`,
  );
  invariant(response.status === 200, `${municipalityId}: expected 200, received ${response.status}`);
  const body = await response.json();
  const finding = body.result?.budgetFindings?.find(
    (item) => item.kind === "comparison" && item.label === "市税",
  );
  invariant(finding, `${municipalityId}: city tax comparison is missing`);
  invariant(finding.municipalityName === municipalityName, `${municipalityId}: municipality mismatch`);
  invariant(finding.humanReviewStatus === "pending", `${municipalityId}: human review gate changed`);
  invariant(finding.comparison.comparisonStatus === "pending_review", `${municipalityId}: comparison gate changed`);
  invariant(
    finding.comparison.current.amountJpy - finding.comparison.baseline.amountJpy ===
      finding.comparison.deltaAmountJpy,
    `${municipalityId}: delta mismatch`,
  );
  invariant(
    finding.evidences.every(
      (evidence) =>
        new URL(evidence.officialLandingUrl).protocol === "https:" &&
        !/\.(?:pdf|xlsx?)(?:$|[?#])/i.test(new URL(evidence.officialLandingUrl).pathname),
    ),
    `${municipalityId}: unsafe or direct-file evidence URL`,
  );
  invariant(body.metadata?.ai?.status === "disabled", `${municipalityId}: AI must be disabled`);
  invariant(body.metadata?.budget?.indexWritePerformed === false, `${municipalityId}: index write occurred`);
  invariant(body.metadata?.budget?.publicRagGate === "blocked", `${municipalityId}: public RAG gate changed`);
}

const sapporoRestatementGuardResponse = await post(
  "/api/research",
  {
    query: "総務費をR7とR8で比較し、差額と出典を表示",
    municipalities: ["sapporo"],
    sourceTypes: ["budget"],
    fiscalYears: [2025, 2026],
  },
  sessionCookie,
  "198.51.100.19",
);
invariant(sapporoRestatementGuardResponse.status === 200, "sapporo restatement guard request failed");
const sapporoRestatementGuard = await sapporoRestatementGuardResponse.json();
const sapporoComparisonFindings = sapporoRestatementGuard.result?.budgetFindings?.filter(
  (item) => item.kind === "comparison",
) ?? [];
invariant(sapporoComparisonFindings.length > 0, "sapporo own-year comparison is missing");
invariant(
  sapporoComparisonFindings.every(
    (item) => item.comparison?.comparisonMode === "own_year_original_to_own_year_original",
  ),
  "sapporo official-restated comparison leaked into the limited search",
);
invariant(
  sapporoRestatementGuard.result?.limitations?.some((item) => /公式組替前年額/.test(item)),
  "sapporo restatement limitation is missing",
);

const zeroMatchResponse = await post(
  "/api/research",
  {
    query: "この文字列に該当する予算項目はないはずxyz987",
    municipalities: ["chitose"],
    sourceTypes: ["budget"],
  },
  sessionCookie,
  "198.51.100.20",
);
invariant(zeroMatchResponse.status === 200, "zero match request failed");
const zeroMatch = await zeroMatchResponse.json();
invariant(zeroMatch.result?.budgetFindings?.length === 0, "zero match returned a record");
invariant(/0円・資料不存在/.test(zeroMatch.result?.summary ?? ""), "zero match semantics are missing");

const invalidRequests = [
  {
    query: "市税",
    municipalities: ["chitose"],
    sourceTypes: ["budget"],
    fiscalYears: [2024],
  },
  {
    query: "市税",
    municipalities: ["chitose"],
    sourceTypes: ["budget", "plenary_minutes"],
  },
  {
    query: "市税",
    municipalities: ["chitose", "eniwa"],
    sourceTypes: ["budget"],
  },
];

for (const [index, body] of invalidRequests.entries()) {
  const response = await post(
    "/api/research",
    body,
    sessionCookie,
    `198.51.100.${index + 21}`,
  );
  invariant(response.status === 400, `guard: expected 400, received ${response.status}`);
}

console.log(
  JSON.stringify(
    {
      status: "passed",
      authentication: "passed",
      municipalities: cityQueries.length,
      sapporo_restatement_guard: "passed",
      zero_match_semantics: "passed",
      invalid_request_guards: invalidRequests.length,
      ai_status: "disabled",
      index_write_performed: false,
      public_rag_gate: "blocked",
    },
    null,
    2,
  ),
);
