import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(siteRoot, "..");
const reportsRoot = path.join(repoRoot, "reports/data-loop-v1");
const previewPath = path.join(siteRoot, "data/data-loop-preview/budget-preview.v1.json");
const outputPath = path.join(siteRoot, "data/data-loop-preview/budget-research-index.v1.json");
const cities = ["chitose", "eniwa", "ebetsu", "asahikawa", "sapporo"];

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

function readJsonLines(file) {
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function labelOfFact(fact) {
  return fact.classification_path.at(-1)?.source_label ?? fact.account.source_label;
}

function compactEvidence(evidence) {
  return evidence.map((item) => ({
    document_revision_id: item.document_revision_id,
    official_landing_url: item.official_landing_url,
    format: item.format,
    physical_page: item.format === "pdf" ? item.locator?.physical_page ?? item.physical_page ?? null : null,
    printed_page: item.format === "pdf" ? item.locator?.printed_page ?? item.printed_page ?? null : null,
    source_table: item.source_table,
  }));
}

function compactFact(fact) {
  return {
    fact_id: fact.fact_id,
    fact_version_id: fact.fact_version_id,
    fiscal_year: fact.fiscal_year,
    document_stage: fact.document_stage,
    legislative_status: fact.legislative_status,
    value_basis: fact.value_basis,
    entity_id: fact.entity_id,
    concept_mapping_status: fact.concept_mapping_status,
    account_label: fact.account.source_label,
    account_type: fact.account.normalized_type,
    entry_side: fact.entry_side,
    fact_scope: fact.fact_scope,
    label: labelOfFact(fact),
    classification_labels: fact.classification_path.map((item) => item.source_label),
    department: fact.department,
    project: fact.project,
    amount_jpy: fact.amount.value_jpy,
    source_reported_value: fact.amount.source_reported_value,
    source_unit: fact.amount.source_unit,
    source_precision_jpy: fact.amount.source_precision_jpy,
    precision_semantics: fact.amount.precision_semantics,
    extraction_status: fact.extraction.status,
    confidence: fact.extraction.confidence,
    human_review_status: fact.review.status,
    evidence: compactEvidence(fact.evidence),
  };
}

function compactComparison(comparison, factById) {
  const baseline = factById.get(comparison.baseline_fact_id);
  const current = factById.get(comparison.current_fact_id);
  if (!baseline || !current) throw new Error(`Broken comparison reference: ${comparison.comparison_id}`);
  return {
    comparison_id: comparison.comparison_id,
    comparison_version_id: comparison.comparison_version_id,
    entity_id: comparison.entity_id,
    concept_mapping_status: comparison.concept_mapping_status,
    label: labelOfFact(current),
    account_label: current.account.source_label,
    account_type: current.account.normalized_type,
    entry_side: current.entry_side,
    fact_scope: current.fact_scope,
    baseline_fact_id: baseline.fact_id,
    current_fact_id: current.fact_id,
    baseline_fiscal_year: baseline.fiscal_year,
    current_fiscal_year: current.fiscal_year,
    baseline_amount_jpy: comparison.baseline_amount_jpy,
    current_amount_jpy: comparison.current_amount_jpy,
    delta_amount_jpy: comparison.delta_amount_jpy,
    delta_percent: comparison.delta_percent,
    source_precision_jpy: comparison.source_precision_jpy,
    comparison_mode: comparison.comparison_mode,
    comparison_status: comparison.comparison_status,
    rounding_difference_jpy: comparison.rounding_difference_jpy,
    restatement_adjustment_jpy: comparison.restatement_adjustment_jpy ?? null,
    baseline_legislative_status: baseline.legislative_status,
    current_legislative_status: current.legislative_status,
    baseline_evidence: compactEvidence(baseline.evidence),
    current_evidence: compactEvidence(current.evidence),
    evidence: compactEvidence(comparison.evidence),
  };
}

function compactEvent(event) {
  return {
    event_id: event.event_id,
    event_version_id: event.event_version_id,
    effective_fiscal_year: event.effective_fiscal_year,
    document_stage: event.document_stage,
    event_type: event.event_type,
    label: event.subject.source_label ?? event.subject.entity_id ?? event.event_type,
    account_type: event.subject.normalized_type ?? null,
    presence_before: event.presence_before,
    presence_after: event.presence_after,
    source_reported_current_amount: event.source_reported_current_amount ?? null,
    reported_amount_semantics: event.reported_amount_semantics,
    human_review_status: event.review.status,
    confidence: event.confidence,
    evidence: compactEvidence(event.evidence),
  };
}

function compactChunk(chunk) {
  return {
    chunk_id: chunk.id,
    chunk_version_id: chunk.chunk_version_id,
    record_type: chunk.record_type,
    record_ids: chunk.record_ids,
    fiscal_years: chunk.metadata.fiscal_years ?? [],
    document_type: chunk.metadata.document_type,
    account_type: chunk.metadata.account_type ?? null,
    entry_side: chunk.metadata.entry_side ?? null,
    entity_id: chunk.metadata.entity_id ?? null,
    numeric_validation: chunk.metadata.numeric_validation,
    human_review_status: chunk.metadata.human_review,
    rag_gate_state: chunk.metadata.rag_gate_state,
    publish_state: chunk.metadata.publish_state,
    text: chunk.text,
    evidence: compactEvidence(chunk.evidence),
  };
}

const preview = readJson(previewPath);
if (preview.schema_version !== "budget-data-loop-preview.v1") {
  throw new Error("Budget preview must be generated first.");
}

const municipalities = cities.map((slug) => {
  const previewCity = preview.municipalities.find((item) => item.municipality_id === slug);
  if (!previewCity) throw new Error(`Preview city is missing: ${slug}`);
  if (previewCity.technical_validation !== "passed" || previewCity.release_surfaces.private_data !== "ready") {
    throw new Error(`Private technical gate is not ready: ${slug}`);
  }
  for (const [surface, state] of Object.entries(previewCity.release_surfaces)) {
    if (surface !== "private_data" && state !== "blocked") {
      throw new Error(`Public surface unexpectedly ready: ${slug}/${surface}`);
    }
  }

  const adapterDir = path.join(reportsRoot, `${slug}-adapter-v1`);
  const canonical = readJson(path.join(adapterDir, "budget-canonical.v1.json"));
  const chunks = readJsonLines(path.join(adapterDir, "chunks/budget-r7-r8.jsonl"));
  const factById = new Map(canonical.facts.map((fact) => [fact.fact_id, fact]));
  const compactFacts = canonical.facts.map(compactFact);
  const compactComparisons = canonical.comparisons.map((comparison) => compactComparison(comparison, factById));
  const compactEvents = canonical.structural_events.map(compactEvent);
  const compactChunks = chunks.map(compactChunk);

  if (compactFacts.length !== previewCity.counts.facts) throw new Error(`${slug}: fact count mismatch`);
  if (compactComparisons.length !== previewCity.counts.comparisons) throw new Error(`${slug}: comparison count mismatch`);
  if (compactEvents.length !== previewCity.counts.structural_events) throw new Error(`${slug}: event count mismatch`);
  if (compactChunks.length !== previewCity.counts.private_chunks) throw new Error(`${slug}: chunk count mismatch`);
  if (compactFacts.some((fact) => fact.extraction_status !== "technically_validated")) {
    throw new Error(`${slug}: a fact is not technically validated`);
  }
  if (compactFacts.some((fact) => fact.human_review_status !== "pending")) {
    throw new Error(`${slug}: human review state changed unexpectedly`);
  }
  if (compactChunks.some((chunk) => chunk.rag_gate_state !== "blocked" || chunk.publish_state !== "blocked")) {
    throw new Error(`${slug}: a private source chunk is not blocked from public RAG`);
  }

  return {
    municipality_id: slug,
    municipality_name: previewCity.municipality_name,
    dataset_version_id: canonical.dataset_version_id,
    technical_validation: previewCity.technical_validation,
    human_review_status: previewCity.human_review_status,
    release_surfaces: previewCity.release_surfaces,
    blockers: previewCity.blockers,
    coverage: previewCity.coverage,
    facts: compactFacts,
    comparisons: compactComparisons,
    structural_events: compactEvents,
    chunks: compactChunks,
  };
});

const index = {
  schema_version: "budget-research-index.v1",
  generated_at: preview.generated_at,
  access_level: "password_protected_private_preview",
  retrieval_policy: {
    mode: "in_process_keyword_retrieval",
    external_vector_index: false,
    index_write_performed: false,
    public_rag_gate: "blocked",
    cross_municipality_semantic_comparison: "blocked",
    numeric_source_of_truth: "canonical_facts_and_comparisons",
  },
  disclaimer: "限定テスト用。数値・参照関係は技術検証済みだが、人手承認・再利用条件・共通concept mappingは未完了。推測補完および自治体間の意味比較を行わない。",
  totals: {
    municipalities: municipalities.length,
    facts: municipalities.reduce((sum, city) => sum + city.facts.length, 0),
    comparisons: municipalities.reduce((sum, city) => sum + city.comparisons.length, 0),
    structural_events: municipalities.reduce((sum, city) => sum + city.structural_events.length, 0),
    private_chunks: municipalities.reduce((sum, city) => sum + city.chunks.length, 0),
  },
  municipalities,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(index)}\n`);
console.log(JSON.stringify({
  status: "generated",
  output: path.relative(siteRoot, outputPath),
  ...index.totals,
  index_write_performed: false,
}, null, 2));
