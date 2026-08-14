import "server-only";
import {
  getDataLoopPreview,
  type PreviewComparison,
  type PreviewEvidence,
} from "@/lib/dataLoopPreview";
import type {
  BudgetComparisonDemoCity,
  BudgetDemoCategory,
  BudgetDemoEvidence,
  BudgetDemoRanking,
  BudgetDemoRow,
} from "@/types/budgetComparisonDemo";

const CATEGORIES: BudgetDemoCategory[] = ["expense", "revenue", "special"];
const OWN_YEAR_COMPARISON = "own_year_original_to_own_year_original";

function categoryFor(comparison: PreviewComparison): BudgetDemoCategory | null {
  if (comparison.entry_side === "expense") return "expense";
  if (comparison.entry_side === "revenue") return "revenue";
  if (comparison.entry_side === "both") return "special";
  return null;
}

function validOfficialUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function toEvidence(
  evidence: PreviewEvidence[],
  fiscalYear: number,
): BudgetDemoEvidence | null {
  const source =
    evidence.find(
      (item) => item.role === "authoritative" && validOfficialUrl(item.official_landing_url),
    ) ?? evidence.find((item) => validOfficialUrl(item.official_landing_url));
  if (!source) return null;
  return {
    fiscalYear,
    officialLandingUrl: source.official_landing_url,
    format: source.format,
    physicalPage: source.physical_page,
    printedPage: source.printed_page,
    sourceTable: source.source_table,
  };
}

function toRow(comparison: PreviewComparison): BudgetDemoRow {
  return {
    comparisonId: comparison.comparison_id,
    label: comparison.label,
    accountLabel: comparison.account_label,
    baselineFiscalYear: comparison.baseline_fiscal_year,
    currentFiscalYear: comparison.current_fiscal_year,
    baselineAmountJpy: comparison.baseline_amount_jpy,
    currentAmountJpy: comparison.current_amount_jpy,
    deltaAmountJpy: comparison.delta_amount_jpy,
    sourcePrecisionJpy: comparison.source_precision_jpy,
    comparisonMode: comparison.comparison_mode,
    comparisonStatus: comparison.comparison_status,
    restatementAdjustmentJpy: comparison.restatement_adjustment_jpy,
    baselineEvidence: toEvidence(
      comparison.baseline_evidence,
      comparison.baseline_fiscal_year,
    ),
    currentEvidence: toEvidence(
      comparison.current_evidence,
      comparison.current_fiscal_year,
    ),
  };
}

function rankingFor(
  comparisons: PreviewComparison[],
  comparisonMode: string,
): BudgetDemoRanking {
  const rows = comparisons.map(toRow);
  return {
    comparisonMode,
    comparableCount: rows.length,
    unchangedCount: rows.filter((row) => row.deltaAmountJpy === 0).length,
    increases: rows
      .filter((row) => row.deltaAmountJpy > 0)
      .sort(
        (left, right) =>
          right.deltaAmountJpy - left.deltaAmountJpy ||
          left.label.localeCompare(right.label, "ja") ||
          left.comparisonId.localeCompare(right.comparisonId),
      )
      .slice(0, 5),
    decreases: rows
      .filter((row) => row.deltaAmountJpy < 0)
      .sort(
        (left, right) =>
          left.deltaAmountJpy - right.deltaAmountJpy ||
          left.label.localeCompare(right.label, "ja") ||
          left.comparisonId.localeCompare(right.comparisonId),
      )
      .slice(0, 5),
  };
}

export function getBudgetComparisonDemo(): BudgetComparisonDemoCity[] {
  const preview = getDataLoopPreview();
  if (!preview || preview.access_level !== "password_protected_test_preview") return [];

  return preview.municipalities.flatMap((municipality) => {
    if (
      municipality.release_surfaces.private_data !== "ready" ||
      municipality.technical_validation !== "passed"
    ) {
      return [];
    }

    const rankings = Object.fromEntries(
      CATEGORIES.map((category) => {
        const comparisonMode = OWN_YEAR_COMPARISON;
        const comparisons = municipality.comparisons.filter(
          (comparison) =>
            categoryFor(comparison) === category &&
            comparison.comparison_mode === comparisonMode,
        );
        return [category, rankingFor(comparisons, comparisonMode)];
      }),
    ) as Record<BudgetDemoCategory, BudgetDemoRanking>;
    const selectedComparisonCount = Object.values(rankings).reduce(
      (sum, ranking) => sum + ranking.comparableCount,
      0,
    );
    const coverage = municipality.coverage;

    return [
      {
        municipalityId: municipality.municipality_id,
        municipalityName: municipality.municipality_name,
        technicalValidation: municipality.technical_validation,
        humanReviewStatus: municipality.human_review_status,
        reviewItems: municipality.counts.review_items,
        approvedReviewItems: municipality.counts.approved_review_items,
        excludedAlternativeComparisonCount:
          municipality.comparisons.length - selectedComparisonCount,
        rankings,
        coverage: {
          totalScopes: coverage.length,
          normalizedScopes: coverage.filter(
            (item) =>
              item.normalize_state === "succeeded" &&
              item.technical_validation_state === "passed",
          ).length,
          followUpScopes: coverage.filter(
            (item) =>
              item.normalize_state !== "succeeded" ||
              item.freshness_status !== "current" ||
              item.scope_disposition !== "in_scope",
          ).length,
          deferredOrSeparateScopes: coverage.filter(
            (item) => item.scope_disposition !== "in_scope",
          ).length,
          pendingHumanReviewScopes: coverage.filter(
            (item) => item.human_review_status === "pending",
          ).length,
          freshnessAttentionScopes: coverage.filter(
            (item) => item.freshness_status !== "current",
          ).length,
          unknownExistenceScopes: coverage.filter(
            (item) => item.existence_state === "unknown",
          ).length,
        },
      },
    ];
  });
}
