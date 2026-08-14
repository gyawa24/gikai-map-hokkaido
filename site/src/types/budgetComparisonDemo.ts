export type BudgetDemoCategory = "expense" | "revenue" | "special";

export type BudgetDemoEvidence = {
  fiscalYear: number;
  officialLandingUrl: string;
  format: "pdf" | "spreadsheet" | "html";
  physicalPage: number | null;
  printedPage: number | string | null;
  sourceTable: string;
};

export type BudgetDemoRow = {
  comparisonId: string;
  label: string;
  accountLabel: string;
  baselineFiscalYear: number;
  currentFiscalYear: number;
  baselineAmountJpy: number;
  currentAmountJpy: number;
  deltaAmountJpy: number;
  sourcePrecisionJpy: number;
  comparisonMode: string;
  comparisonStatus: string;
  restatementAdjustmentJpy: number | null;
  baselineEvidence: BudgetDemoEvidence | null;
  currentEvidence: BudgetDemoEvidence | null;
};

export type BudgetDemoRanking = {
  comparisonMode: string;
  comparableCount: number;
  unchangedCount: number;
  increases: BudgetDemoRow[];
  decreases: BudgetDemoRow[];
};

export type BudgetDemoCoverage = {
  totalScopes: number;
  normalizedScopes: number;
  followUpScopes: number;
  deferredOrSeparateScopes: number;
  pendingHumanReviewScopes: number;
  freshnessAttentionScopes: number;
  unknownExistenceScopes: number;
};

export type BudgetComparisonDemoCity = {
  municipalityId: string;
  municipalityName: string;
  technicalValidation: string;
  humanReviewStatus: string;
  reviewItems: number;
  approvedReviewItems: number;
  excludedAlternativeComparisonCount: number;
  rankings: Record<BudgetDemoCategory, BudgetDemoRanking>;
  coverage: BudgetDemoCoverage;
};
