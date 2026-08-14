import "server-only";
import indexData from "../../data/data-loop-preview/budget-research-index.v1.json";
import {
  RESEARCH_DISCLAIMER,
  type BudgetAmount,
  type BudgetFindingEvidence,
  type BudgetNumericFinding,
  type ResearchRequest,
  type ResearchResponse,
} from "@/types/research";

type RawEvidence = {
  document_revision_id: string;
  official_landing_url: string;
  format: "pdf" | "html";
  physical_page: number | null;
  printed_page: number | null;
  source_table: string;
};

type IndexedFact = {
  fact_id: string;
  fiscal_year: number;
  legislative_status: string;
  concept_mapping_status: string;
  account_label: string;
  entry_side: string;
  fact_scope: string;
  label: string;
  classification_labels: string[];
  amount_jpy: number;
  source_reported_value: number;
  source_unit: BudgetAmount["sourceUnit"];
  source_precision_jpy: number;
  precision_semantics: string;
  evidence: RawEvidence[];
};

type IndexedComparison = {
  comparison_id: string;
  concept_mapping_status: string;
  label: string;
  account_label: string;
  entry_side: string;
  fact_scope: string;
  baseline_fact_id: string;
  current_fact_id: string;
  baseline_fiscal_year: number;
  current_fiscal_year: number;
  baseline_amount_jpy: number;
  current_amount_jpy: number;
  delta_amount_jpy: number;
  delta_percent: number | null;
  source_precision_jpy: number;
  comparison_mode: string;
  comparison_status: string;
  rounding_difference_jpy: number;
  restatement_adjustment_jpy: number | null;
  baseline_legislative_status: string;
  current_legislative_status: string;
  baseline_evidence: RawEvidence[];
  current_evidence: RawEvidence[];
  evidence: RawEvidence[];
};

type IndexedEvent = {
  event_id: string;
  effective_fiscal_year: number;
  event_type: string;
  label: string;
  account_type: string | null;
  presence_before: string;
  presence_after: string;
  source_reported_current_amount: number | null;
  reported_amount_semantics: string;
  human_review_status: "pending";
  evidence: RawEvidence[];
};

type IndexedChunk = {
  chunk_id: string;
  record_ids: string[];
  text: string;
};

type IndexedMunicipality = {
  municipality_id: string;
  municipality_name: string;
  dataset_version_id: string;
  facts: IndexedFact[];
  comparisons: IndexedComparison[];
  structural_events: IndexedEvent[];
  chunks: IndexedChunk[];
};

type BudgetIndex = {
  schema_version: "budget-research-index.v1";
  access_level: "password_protected_private_preview";
  retrieval_policy: {
    mode: "in_process_keyword_retrieval";
    index_write_performed: false;
    public_rag_gate: "blocked";
    cross_municipality_semantic_comparison: "blocked";
    numeric_source_of_truth: "canonical_facts_and_comparisons";
  };
  municipalities: IndexedMunicipality[];
};

const budgetIndex = indexData as unknown as BudgetIndex;
const COMPARISON_WORDS = /比較|前年|前年度|増減|差額|伸び|変化|r7.*r8|令和7.*令和8/i;
const EVENT_WORDS = /廃止|新設|創設|組替|組み替|皆減|構造|移管/i;

function invariantIndex() {
  if (
    budgetIndex.schema_version !== "budget-research-index.v1" ||
    budgetIndex.access_level !== "password_protected_private_preview" ||
    budgetIndex.retrieval_policy.index_write_performed !== false ||
    budgetIndex.retrieval_policy.public_rag_gate !== "blocked" ||
    budgetIndex.retrieval_policy.cross_municipality_semantic_comparison !== "blocked"
  ) {
    throw new Error("Budget private preview gate is invalid");
  }
}

invariantIndex();

function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ja")
    .replace(/[\s、。・,./／:：()（）「」『』\[\]【】!?！？〜~]/g, "");
}

function fiscalYearsFromQuery(query: string): number[] {
  const normalized = query.normalize("NFKC").toLocaleLowerCase("ja");
  const years: number[] = [];
  if (/令和\s*7|r\s*7|2025/.test(normalized)) years.push(2025);
  if (/令和\s*8|r\s*8|2026/.test(normalized)) years.push(2026);
  return years;
}

function recordScore(query: string, labels: Array<string | null | undefined>): number {
  const normalizedQuery = normalizeText(query);
  let score = 0;
  for (const label of labels) {
    if (!label) continue;
    const normalizedLabel = normalizeText(label);
    if (normalizedLabel.length < 2) continue;
    if (normalizedQuery.includes(normalizedLabel)) {
      score = Math.max(score, normalizedLabel.length * 10);
    }
  }
  return score;
}

function sourceUnitFromPrecision(precision: number): BudgetAmount["sourceUnit"] {
  if (precision === 1_000_000) return "million_yen";
  if (precision === 1_000) return "thousand_yen";
  return "yen";
}

function toEvidence(
  evidence: RawEvidence[],
  fiscalYear: number | null,
  prefix: string,
): BudgetFindingEvidence[] {
  const seen = new Set<string>();
  return evidence.flatMap((item, index) => {
    const key = [
      item.document_revision_id,
      item.physical_page,
      item.printed_page,
      item.source_table,
      fiscalYear,
    ].join(":");
    if (seen.has(key)) return [];
    seen.add(key);
    return [{
      evidenceId: `${prefix}:evidence:${index + 1}`,
      fiscalYear,
      documentRevisionId: item.document_revision_id,
      officialLandingUrl: item.official_landing_url,
      format: item.format,
      physicalPage: item.physical_page,
      printedPage: item.printed_page,
      sourceTable: item.source_table,
    }];
  });
}

function factAmount(fact: IndexedFact): BudgetAmount {
  return {
    fiscalYear: fact.fiscal_year,
    amountJpy: fact.amount_jpy,
    sourceReportedValue: fact.source_reported_value,
    sourceUnit: fact.source_unit,
    sourcePrecisionJpy: fact.source_precision_jpy,
    precisionSemantics: fact.precision_semantics,
    legislativeStatus: fact.legislative_status,
  };
}

function comparisonAmount(
  fiscalYear: number,
  amountJpy: number,
  sourcePrecisionJpy: number,
  legislativeStatus: string,
): BudgetAmount {
  return {
    fiscalYear,
    amountJpy,
    sourceReportedValue: amountJpy / sourcePrecisionJpy,
    sourceUnit: sourceUnitFromPrecision(sourcePrecisionJpy),
    sourcePrecisionJpy,
    precisionSemantics: "exact_to_source_unit",
    legislativeStatus,
  };
}

function matchedChunk(city: IndexedMunicipality, recordId: string, query: string) {
  const normalizedQuery = normalizeText(query);
  return city.chunks
    .filter((chunk) => chunk.record_ids.includes(recordId))
    .map((chunk) => ({
      chunk,
      score: normalizeText(chunk.text).includes(normalizedQuery) ? 2 : 1,
    }))
    .sort((left, right) => right.score - left.score)[0]?.chunk;
}

function withRetrieval(
  city: IndexedMunicipality,
  recordId: string,
  query: string,
): BudgetNumericFinding["retrieval"] {
  const chunk = matchedChunk(city, recordId, query);
  return chunk
    ? { mode: "structured_and_private_chunk", matchedChunkId: chunk.chunk_id }
    : { mode: "structured_only" };
}

function factFinding(
  city: IndexedMunicipality,
  fact: IndexedFact,
  query: string,
): BudgetNumericFinding {
  return {
    id: fact.fact_id,
    kind: "fact",
    municipalityId: city.municipality_id,
    municipalityName: city.municipality_name,
    label: fact.label,
    accountLabel: fact.account_label,
    entrySide: fact.entry_side,
    factScope: fact.fact_scope,
    conceptMappingStatus: fact.concept_mapping_status,
    fact: factAmount(fact),
    comparison: null,
    structuralEvent: null,
    technicalValidation: "passed",
    humanReviewStatus: "pending",
    retrieval: withRetrieval(city, fact.fact_id, query),
    evidences: toEvidence(fact.evidence, fact.fiscal_year, fact.fact_id),
  };
}

function comparisonFinding(
  city: IndexedMunicipality,
  comparison: IndexedComparison,
  query: string,
): BudgetNumericFinding {
  return {
    id: comparison.comparison_id,
    kind: "comparison",
    municipalityId: city.municipality_id,
    municipalityName: city.municipality_name,
    label: comparison.label,
    accountLabel: comparison.account_label,
    entrySide: comparison.entry_side,
    factScope: comparison.fact_scope,
    conceptMappingStatus: comparison.concept_mapping_status,
    fact: null,
    comparison: {
      baseline: comparisonAmount(
        comparison.baseline_fiscal_year,
        comparison.baseline_amount_jpy,
        comparison.source_precision_jpy,
        comparison.baseline_legislative_status,
      ),
      current: comparisonAmount(
        comparison.current_fiscal_year,
        comparison.current_amount_jpy,
        comparison.source_precision_jpy,
        comparison.current_legislative_status,
      ),
      deltaAmountJpy: comparison.delta_amount_jpy,
      deltaPercent: comparison.delta_percent,
      comparisonMode: comparison.comparison_mode,
      comparisonStatus: comparison.comparison_status,
      roundingDifferenceJpy: comparison.rounding_difference_jpy,
      restatementAdjustmentJpy: comparison.restatement_adjustment_jpy,
    },
    structuralEvent: null,
    technicalValidation: "passed",
    humanReviewStatus: "pending",
    retrieval: withRetrieval(city, comparison.comparison_id, query),
    evidences: [
      ...toEvidence(
        comparison.baseline_evidence,
        comparison.baseline_fiscal_year,
        `${comparison.comparison_id}:baseline`,
      ),
      ...toEvidence(
        comparison.current_evidence,
        comparison.current_fiscal_year,
        `${comparison.comparison_id}:current`,
      ),
    ],
  };
}

function eventFinding(
  city: IndexedMunicipality,
  event: IndexedEvent,
  query: string,
): BudgetNumericFinding {
  return {
    id: event.event_id,
    kind: "structural_event",
    municipalityId: city.municipality_id,
    municipalityName: city.municipality_name,
    label: event.label,
    accountLabel: null,
    entrySide: null,
    factScope: null,
    conceptMappingStatus: "unmapped",
    fact: null,
    comparison: null,
    structuralEvent: {
      effectiveFiscalYear: event.effective_fiscal_year,
      eventType: event.event_type,
      presenceBefore: event.presence_before,
      presenceAfter: event.presence_after,
      sourceReportedCurrentAmount: event.source_reported_current_amount,
      reportedAmountSemantics: event.reported_amount_semantics,
    },
    technicalValidation: "passed",
    humanReviewStatus: "pending",
    retrieval: withRetrieval(city, event.event_id, query),
    evidences: toEvidence(event.evidence, event.effective_fiscal_year, event.event_id),
  };
}

export function getBudgetResearchMunicipalityIds(): Set<string> {
  return new Set(budgetIndex.municipalities.map((city) => city.municipality_id));
}

export function searchBudgetResearch(
  request: ResearchRequest,
  requestId: string,
  startedAt: number,
): ResearchResponse {
  const municipalityId = request.municipalities?.[0];
  const city = budgetIndex.municipalities.find(
    (municipality) => municipality.municipality_id === municipalityId,
  );
  if (!city) throw new Error("Budget municipality is not available");

  const queryFiscalYears = fiscalYearsFromQuery(request.query);
  const fiscalYears = request.fiscalYears?.length
    ? request.fiscalYears
    : queryFiscalYears.length
      ? queryFiscalYears
      : [2025, 2026];
  const comparisonRequested = COMPARISON_WORDS.test(request.query);
  const eventRequested = EVENT_WORDS.test(request.query);

  const factMatches = city.facts
    .map((fact) => ({
      fact,
      score: recordScore(request.query, [
        fact.label,
        fact.account_label,
        ...fact.classification_labels,
      ]),
    }))
    .filter(({ fact, score }) => score > 0 && fiscalYears.includes(fact.fiscal_year))
    .sort((left, right) => right.score - left.score || right.fact.fiscal_year - left.fact.fiscal_year);

  const comparisonMatches = city.comparisons
    .map((comparison) => ({
      comparison,
      score: recordScore(request.query, [comparison.label, comparison.account_label]),
    }))
    .filter(
      ({ comparison, score }) =>
        comparisonRequested &&
        score > 0 &&
        comparison.comparison_mode === "own_year_original_to_own_year_original" &&
        fiscalYears.includes(comparison.baseline_fiscal_year) &&
        fiscalYears.includes(comparison.current_fiscal_year),
    )
    .sort((left, right) => right.score - left.score);

  const eventMatches = city.structural_events
    .map((event) => ({
      event,
      score: recordScore(request.query, [event.label, event.event_type]),
    }))
    .filter(
      ({ event, score }) =>
        (eventRequested || score > 0) &&
        fiscalYears.includes(event.effective_fiscal_year),
    )
    .sort((left, right) => right.score - left.score);

  const findings = comparisonMatches.length
    ? [
        ...comparisonMatches.map(({ comparison }) =>
          comparisonFinding(city, comparison, request.query),
        ),
        ...eventMatches.map(({ event }) => eventFinding(city, event, request.query)),
      ].slice(0, 20)
    : [
        ...factMatches.map(({ fact }) => factFinding(city, fact, request.query)),
        ...eventMatches.map(({ event }) => eventFinding(city, event, request.query)),
      ].slice(0, 20);

  const chunkMatchCount = findings.filter(
    (finding) => finding.retrieval.mode === "structured_and_private_chunk",
  ).length;
  const matchDescription = findings.length
    ? `${city.municipality_name}のR7・R8予算データから${findings.length}件を抽出しました。金額はcanonicalな構造化データを正本とし、出典ページへ戻れる形で表示します。`
    : `${city.municipality_name}の現在の限定テスト範囲では、質問に一致する構造化行を特定できませんでした。これは0円・資料不存在・自治体に該当予算がないことを意味しません。`;

  return {
    requestId,
    result: {
      query: request.query,
      summary: matchDescription,
      keyIssues: [],
      municipalityComparisons: [],
      administrationResponsePatterns: [],
      policyOptions: [],
      nextResearchItems: findings.length
        ? ["公式資料の該当ページで数値と項目名を確認してください。"]
        : ["項目名を予算書の表記に近づけるか、別の年度を指定してください。"],
      evidences: [],
      budgetFindings: findings,
      limitations: [
        "パスワード保護された限定テストです。数値・参照関係は技術検証済みですが、人による全数承認は完了していません。",
        "札幌市の公式組替前年額による比較は、丸め差と出典位置の確認が完了するまで検索結果から分離しています。",
        "private chunkは画面内の候補照合だけに使い、外部vector indexへの書き込みやBedrockによる数値生成は行っていません。",
        "自治体共通concept mappingが未完了のため、自治体間の意味上の比較は停止しています。",
        "未一致・未評価・未取得・資料不存在・0円を同じ状態として扱いません。",
      ],
    },
    disclaimer: RESEARCH_DISCLAIMER,
    metadata: {
      mode: request.mode ?? "research",
      searchedSourceTypes: ["budget"],
      unavailableSourceTypes: [],
      searchQueries: [request.query],
      searchResultCount: findings.length,
      evidenceCount: findings.reduce((sum, finding) => sum + finding.evidences.length, 0),
      ai: { status: "disabled", callCount: 0 },
      citationValidation: {
        valid: true,
        invalidEvidenceIds: [],
        removedReferenceCount: 0,
        removedSectionCount: 0,
      },
      durationMs: Date.now() - startedAt,
      cacheHit: false,
      budget: {
        status: "password_protected_private_preview",
        datasetVersionId: city.dataset_version_id,
        structuredMatchCount: findings.length,
        chunkMatchCount,
        humanReviewStatus: "pending",
        publicRagGate: "blocked",
        crossMunicipalityComparison: "blocked",
        indexWritePerformed: false,
        retrievalMode: "in_process_keyword_retrieval",
        numericSource: "canonical_facts_and_comparisons",
      },
    },
  };
}
