export const SOURCE_TYPES = [
  "plenary_minutes",
  "committee_minutes",
  "administrative_plan",
  "budget",
  "settlement",
  "project_evaluation",
  "ordinance",
  "organization",
  "statistics",
  "open_data",
  "other",
] as const;

export const RESEARCH_MODES = ["research", "comparison", "question_prep"] as const;

export const RESEARCH_QUERY_MAX_LENGTH = 2_000;

export const RESEARCH_DISCLAIMER =
  "本結果は地方議会.comに収録された公開資料を対象としたAIによる調査支援です。検索結果がないことは、当該議会で議論がなかったことを意味しません。政策判断や正式な引用にあたっては、リンク先の自治体公式資料・議事録原文を確認してください。";

export type SourceType = (typeof SOURCE_TYPES)[number];
export type ResearchMode = (typeof RESEARCH_MODES)[number];
export type EvidenceLevel =
  | "full_text_verified"
  | "excerpt_verified"
  | "metadata_only";

export type ResearchRequest = {
  query: string;
  municipalities?: string[];
  sourceTypes?: SourceType[];
  fiscalYears?: number[];
  mode?: ResearchMode;
};

export type Evidence = {
  id: string;
  municipalityId: string;
  municipalityName: string;
  sourceType: SourceType;
  title: string;
  date?: string;
  meetingName?: string;
  committeeName?: string;
  speaker?: string;
  speakerRole?: string;
  excerpt: string;
  sourceUrl: string;
  evidenceLevel: EvidenceLevel;
};

export type BudgetFindingEvidence = {
  evidenceId: string;
  fiscalYear: number | null;
  documentRevisionId: string;
  officialLandingUrl: string;
  format: "pdf" | "html";
  physicalPage: number | null;
  printedPage: number | null;
  sourceTable: string;
};

export type BudgetAmount = {
  fiscalYear: number;
  amountJpy: number;
  sourceReportedValue: number;
  sourceUnit: "yen" | "thousand_yen" | "million_yen";
  sourcePrecisionJpy: number;
  precisionSemantics: string;
  legislativeStatus: string;
};

export type BudgetNumericFinding = {
  id: string;
  kind: "fact" | "comparison" | "structural_event";
  municipalityId: string;
  municipalityName: string;
  label: string;
  accountLabel: string | null;
  entrySide: string | null;
  factScope: string | null;
  conceptMappingStatus: string;
  fact: BudgetAmount | null;
  comparison: {
    baseline: BudgetAmount;
    current: BudgetAmount;
    deltaAmountJpy: number;
    deltaPercent: number | null;
    comparisonMode: string;
    comparisonStatus: string;
    roundingDifferenceJpy: number;
    restatementAdjustmentJpy: number | null;
  } | null;
  structuralEvent: {
    effectiveFiscalYear: number;
    eventType: string;
    presenceBefore: string;
    presenceAfter: string;
    sourceReportedCurrentAmount: number | null;
    reportedAmountSemantics: string;
  } | null;
  technicalValidation: "passed";
  humanReviewStatus: "pending";
  retrieval: {
    mode: "structured_only" | "structured_and_private_chunk";
    matchedChunkId?: string;
  };
  evidences: BudgetFindingEvidence[];
};

export type ResearchResult = {
  query: string;
  summary: string;
  keyIssues: Array<{
    title: string;
    description: string;
    evidenceIds: string[];
  }>;
  municipalityComparisons: Array<{
    municipalityId: string;
    municipalityName: string;
    summary: string;
    points: string[];
    evidenceIds: string[];
  }>;
  administrationResponsePatterns: Array<{
    pattern: string;
    description: string;
    evidenceIds: string[];
  }>;
  policyOptions: Array<{
    title: string;
    description: string;
    evidenceIds: string[];
  }>;
  nextResearchItems: string[];
  evidences: Evidence[];
  budgetFindings?: BudgetNumericFinding[];
  limitations: string[];
};

export type ResearchResponseMetadata = {
  mode: ResearchMode;
  searchedSourceTypes: SourceType[];
  unavailableSourceTypes: SourceType[];
  searchQueries: string[];
  searchResultCount: number;
  evidenceCount: number;
  ai: {
    status: "completed" | "fallback" | "disabled";
    modelId?: string;
    callCount: number;
    usage?: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };
    estimatedCostUsd?: number;
    errorCode?: string;
  };
  citationValidation: {
    valid: boolean;
    invalidEvidenceIds: string[];
    removedReferenceCount: number;
    removedSectionCount: number;
  };
  durationMs: number;
  cacheHit: boolean;
  budget?: {
    status: "password_protected_private_preview";
    datasetVersionId: string;
    structuredMatchCount: number;
    chunkMatchCount: number;
    humanReviewStatus: "pending";
    publicRagGate: "blocked";
    crossMunicipalityComparison: "blocked";
    indexWritePerformed: false;
    retrievalMode: "in_process_keyword_retrieval";
    numericSource: "canonical_facts_and_comparisons";
  };
};

export type ResearchResponse = {
  requestId: string;
  result: ResearchResult;
  disclaimer: string;
  metadata: ResearchResponseMetadata;
};

export type ResearchMunicipalityOption = {
  slug: string;
  name: string;
  region: string;
  sourceTypes: Array<"plenary_minutes" | "budget">;
};
