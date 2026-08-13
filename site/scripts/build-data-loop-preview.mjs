import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(siteRoot, "..");
const reportsRoot = path.join(repoRoot, "reports/data-loop-v1");
const outputDir = path.join(siteRoot, "data/data-loop-preview");
const outputPath = path.join(outputDir, "budget-preview.v1.json");
const cities = ["chitose", "eniwa", "ebetsu", "asahikawa", "sapporo"];
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

function labelOfFact(fact) {
  return fact.classification_path.at(-1)?.source_label ?? fact.account.source_label;
}

function compactEvidence(evidence) {
  return evidence.map((item) => ({
    role: item.role,
    document_revision_id: item.document_revision_id,
    official_landing_url: item.official_landing_url,
    format: item.format,
    physical_page: item.format === "pdf" ? item.locator.physical_page ?? null : null,
    printed_page: item.format === "pdf" ? item.locator.printed_page ?? null : null,
    source_table: item.source_table,
  }));
}

const ledger = read(path.join(reportsRoot, "five-city-human-review-ledger.v1.json"));
const readiness = read(path.join(reportsRoot, "five-city-private-readiness.json"));
const releaseSnapshot = read(path.join(reportsRoot, "five-city-release-readiness-snapshot.json"));

const municipalities = cities.map((slug) => {
  const adapterDir = path.join(reportsRoot, `${slug}-adapter-v1`);
  const canonical = read(path.join(adapterDir, "budget-canonical.v1.json"));
  const coverageCollection = read(path.join(adapterDir, "data-coverage.v1.json"));
  const validation = read(path.join(adapterDir, "validation.json"));
  const coverage = coverageCollection.records ?? coverageCollection;
  const ledgerCity = ledger.municipalities.find((item) => item.municipality_id === slug);
  const readinessCity = readiness.municipalities.find((item) => item.slug === slug);
  const releaseCity = releaseSnapshot.municipalities.find((item) => item.municipality_id === slug);
  if (!ledgerCity || !readinessCity || !releaseCity) throw new Error(`Missing five-city record: ${slug}`);
  if (validation.status !== "passed" || readinessCity.technical_validation !== "passed") {
    throw new Error(`Technical validation has not passed: ${slug}`);
  }
  if (Object.entries(ledgerCity.release_surfaces).some(([surface, state]) => surface !== "private_data" && state !== "blocked")) {
    throw new Error(`Public surface unexpectedly ready: ${slug}`);
  }

  const factById = new Map(canonical.facts.map((fact) => [fact.fact_id, fact]));
  const comparisons = canonical.comparisons.map((comparison) => {
    const baseline = factById.get(comparison.baseline_fact_id);
    const current = factById.get(comparison.current_fact_id);
    if (!baseline || !current) throw new Error(`Broken comparison reference: ${comparison.comparison_id}`);
    return {
      comparison_id: comparison.comparison_id,
      label: labelOfFact(current),
      account_label: current.account.source_label,
      entry_side: current.entry_side,
      baseline_fiscal_year: baseline.fiscal_year,
      current_fiscal_year: current.fiscal_year,
      baseline_amount_jpy: comparison.baseline_amount_jpy,
      current_amount_jpy: comparison.current_amount_jpy,
      delta_amount_jpy: comparison.delta_amount_jpy,
      source_precision_jpy: comparison.source_precision_jpy,
      comparison_mode: comparison.comparison_mode,
      comparison_status: comparison.comparison_status,
      restatement_adjustment_jpy: comparison.restatement_adjustment_jpy ?? null,
      baseline_evidence: compactEvidence(baseline.evidence),
      current_evidence: compactEvidence(current.evidence),
      evidence: compactEvidence(comparison.evidence),
    };
  });
  const structuralEvents = canonical.structural_events.map((event) => ({
    event_id: event.event_id,
    fiscal_year: event.effective_fiscal_year,
    event_type: event.event_type,
    label: event.subject.source_label ?? event.subject.entity_id ?? event.event_type,
    presence_before: event.presence_before,
    presence_after: event.presence_after,
    reported_amount_semantics: event.reported_amount_semantics,
    review_status: event.review.status,
    evidence: compactEvidence(event.evidence),
  }));
  const coverageRecords = coverage.map((item) => ({
    coverage_id: item.coverage_id,
    fiscal_year: item.fiscal_year,
    scope: item.scope,
    existence_state: item.existence_state,
    scope_disposition: item.scope_disposition,
    discover_state: item.stages.discover,
    fetch_state: item.stages.fetch,
    parse_state: item.stages.parse,
    normalize_state: item.stages.normalize,
    technical_validation_state: item.stages.technical_validation,
    completeness_assessment: item.completeness.assessment,
    observed_count: item.completeness.observed_count,
    expected_count: item.completeness.expected_count,
    freshness_status: item.freshness.status,
    next_check_at: item.freshness.next_check_at,
    human_review_status: item.human_review.status,
  }));
  const sourceLinks = [...new Map(canonical.facts.flatMap((fact) => fact.evidence).map((item) => [
    `${item.document_revision_id}:${item.official_landing_url}`,
    {
      document_revision_id: item.document_revision_id,
      official_landing_url: item.official_landing_url,
      source_file_url_state: item.source_file_url_state,
    },
  ])).values()];

  return {
    municipality_id: slug,
    municipality_name: canonical.municipality.name,
    dataset_version_id: canonical.dataset_version_id,
    generated_at: canonical.generated_at,
    technical_validation: validation.status,
    human_review_status: ledgerCity.status,
    counts: {
      facts: canonical.facts.length,
      comparisons: canonical.comparisons.length,
      structural_events: canonical.structural_events.length,
      coverage_records: coverage.length,
      private_chunks: readinessCity.private_chunks,
      review_items: ledgerCity.counts.review_items,
      approved_review_items: ledgerCity.counts.approved_items,
    },
    release_surfaces: ledgerCity.release_surfaces,
    blockers: ledgerCity.blockers,
    existing_public_asset_state: {
      site_budget_source_status: releaseCity.site_budget_source_status,
      public_webp_images: releaseCity.public_webp_images,
      public_asset_gate_conflict: releaseCity.public_asset_gate_conflict,
      severity: releaseCity.severity,
    },
    source_links: sourceLinks,
    comparisons,
    structural_events: structuralEvents,
    coverage: coverageRecords,
  };
});

const preview = {
  schema_version: "budget-data-loop-preview.v1",
  generated_at: ledger.generated_at,
  access_level: "password_protected_test_preview",
  disclaimer: "技術検証用。人手承認・再利用条件・公開gateは未完了であり、一般公開データとして利用しない。",
  totals: readiness.totals,
  municipalities,
};

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(preview, null, 2)}\n`);
console.log(JSON.stringify({ status: "generated", output: path.relative(siteRoot, outputPath), municipalities: municipalities.length, comparisons: municipalities.reduce((sum, city) => sum + city.comparisons.length, 0) }, null, 2));
