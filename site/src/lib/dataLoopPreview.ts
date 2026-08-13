import "server-only";
import previewData from "../../data/data-loop-preview/budget-preview.v1.json";

export type PreviewEvidence = {
  role: "authoritative" | "secondary";
  document_revision_id: string;
  official_landing_url: string;
  format: "pdf" | "spreadsheet" | "html";
  physical_page: number | null;
  printed_page: number | string | null;
  source_table: string;
};

export type PreviewComparison = {
  comparison_id: string;
  label: string;
  account_label: string;
  entry_side: string;
  baseline_fiscal_year: number;
  current_fiscal_year: number;
  baseline_amount_jpy: number;
  current_amount_jpy: number;
  delta_amount_jpy: number;
  source_precision_jpy: number;
  comparison_mode: string;
  comparison_status: string;
  restatement_adjustment_jpy: number | null;
  baseline_evidence: PreviewEvidence[];
  current_evidence: PreviewEvidence[];
  evidence: PreviewEvidence[];
};

export type PreviewStructuralEvent = {
  event_id: string;
  fiscal_year: number;
  event_type: string;
  label: string;
  presence_before: string;
  presence_after: string;
  reported_amount_semantics: string;
  review_status: string;
  evidence: PreviewEvidence[];
};

export type PreviewCoverage = {
  coverage_id: string;
  fiscal_year: number;
  scope: Record<string, unknown>;
  existence_state: string;
  scope_disposition: string;
  discover_state: string;
  fetch_state: string;
  parse_state: string;
  normalize_state: string;
  technical_validation_state: string;
  completeness_assessment: string;
  observed_count: number | null;
  expected_count: number | null;
  freshness_status: string;
  next_check_at: string | null;
  human_review_status: string;
};

export type DataLoopPreviewMunicipality = {
  municipality_id: string;
  municipality_name: string;
  dataset_version_id: string;
  generated_at: string;
  technical_validation: string;
  human_review_status: string;
  counts: {
    facts: number;
    comparisons: number;
    structural_events: number;
    coverage_records: number;
    private_chunks: number;
    review_items: number;
    approved_review_items: number;
  };
  release_surfaces: Record<string, "ready" | "blocked">;
  blockers: string[];
  existing_public_asset_state: {
    site_budget_source_status: string;
    public_webp_images: number;
    public_asset_gate_conflict: boolean;
    severity: string;
  };
  source_links: Array<{
    document_revision_id: string;
    official_landing_url: string;
    source_file_url_state: string;
  }>;
  comparisons: PreviewComparison[];
  structural_events: PreviewStructuralEvent[];
  coverage: PreviewCoverage[];
};

export type DataLoopPreview = {
  schema_version: "budget-data-loop-preview.v1";
  generated_at: string;
  access_level: "password_protected_test_preview";
  disclaimer: string;
  totals: {
    facts: number;
    comparisons: number;
    structural_events: number;
    coverage_records: number;
    private_chunks: number;
    technical_validation_passed: number;
    public_ready: number;
  };
  municipalities: DataLoopPreviewMunicipality[];
};

export function getDataLoopPreview(): DataLoopPreview | null {
  const value = previewData as DataLoopPreview;
  return value.schema_version === "budget-data-loop-preview.v1" ? value : null;
}
