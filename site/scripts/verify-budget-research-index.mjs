import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const indexPath = path.join(
  siteRoot,
  "data/data-loop-preview/budget-research-index.v1.json",
);
const expectedTotals = {
  municipalities: 5,
  facts: 426,
  comparisons: 224,
  structural_events: 6,
  private_chunks: 230,
};

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function isOfficialLandingUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !/\.(?:pdf|xlsx?|docx?)(?:$|[?#])/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function checkEvidence(evidence, owner) {
  invariant(Array.isArray(evidence) && evidence.length > 0, `${owner}: evidence is missing`);
  for (const item of evidence) {
    invariant(typeof item.document_revision_id === "string", `${owner}: revision is missing`);
    invariant(
      isOfficialLandingUrl(item.official_landing_url),
      `${owner}: official landing URL is unsafe or points directly to a file`,
    );
    invariant(item.format === "pdf" || item.format === "html", `${owner}: format is invalid`);
    if (item.format === "pdf") {
      invariant(Number.isInteger(item.physical_page) && item.physical_page > 0, `${owner}: PDF page is missing`);
    }
    invariant(typeof item.source_table === "string" && item.source_table.length > 0, `${owner}: source table is missing`);
  }
}

const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
invariant(index.schema_version === "budget-research-index.v1", "schema version mismatch");
invariant(index.access_level === "password_protected_private_preview", "access level mismatch");
invariant(index.retrieval_policy?.mode === "in_process_keyword_retrieval", "retrieval mode mismatch");
invariant(index.retrieval_policy?.external_vector_index === false, "external vector index must be disabled");
invariant(index.retrieval_policy?.index_write_performed === false, "index write must remain disabled");
invariant(index.retrieval_policy?.public_rag_gate === "blocked", "public RAG gate must remain blocked");
invariant(
  index.retrieval_policy?.cross_municipality_semantic_comparison === "blocked",
  "cross-municipality semantic comparison must remain blocked",
);

for (const [key, expected] of Object.entries(expectedTotals)) {
  invariant(index.totals?.[key] === expected, `${key}: expected ${expected}, received ${index.totals?.[key]}`);
}

const cityIds = new Set();
const factIds = new Set();
const comparisonIds = new Set();
const eventIds = new Set();
const chunkIds = new Set();

for (const city of index.municipalities) {
  invariant(!cityIds.has(city.municipality_id), `${city.municipality_id}: duplicate municipality`);
  cityIds.add(city.municipality_id);
  invariant(city.technical_validation === "passed", `${city.municipality_id}: technical validation is not passed`);
  invariant(city.release_surfaces?.private_data === "ready", `${city.municipality_id}: private data is not ready`);
  for (const [surface, state] of Object.entries(city.release_surfaces ?? {})) {
    if (surface !== "private_data") {
      invariant(state === "blocked", `${city.municipality_id}/${surface}: public surface is not blocked`);
    }
  }

  for (const fact of city.facts) {
    invariant(!factIds.has(fact.fact_id), `${fact.fact_id}: duplicate fact`);
    factIds.add(fact.fact_id);
    invariant(Number.isSafeInteger(fact.amount_jpy), `${fact.fact_id}: amount is not a safe integer`);
    invariant(Number.isSafeInteger(fact.source_precision_jpy) && fact.source_precision_jpy > 0, `${fact.fact_id}: precision is invalid`);
    invariant(fact.extraction_status === "technically_validated", `${fact.fact_id}: technical state mismatch`);
    invariant(fact.human_review_status === "pending", `${fact.fact_id}: human review must remain pending`);
    checkEvidence(fact.evidence, fact.fact_id);
  }

  for (const comparison of city.comparisons) {
    invariant(!comparisonIds.has(comparison.comparison_id), `${comparison.comparison_id}: duplicate comparison`);
    comparisonIds.add(comparison.comparison_id);
    invariant(
      Number.isSafeInteger(comparison.baseline_amount_jpy) &&
        Number.isSafeInteger(comparison.current_amount_jpy) &&
        Number.isSafeInteger(comparison.delta_amount_jpy),
      `${comparison.comparison_id}: amount is not a safe integer`,
    );
    invariant(
      comparison.current_amount_jpy - comparison.baseline_amount_jpy === comparison.delta_amount_jpy,
      `${comparison.comparison_id}: delta does not match canonical values`,
    );
    invariant(comparison.comparison_status === "pending_review", `${comparison.comparison_id}: comparison gate changed`);
    checkEvidence(comparison.baseline_evidence, `${comparison.comparison_id}/baseline`);
    checkEvidence(comparison.current_evidence, `${comparison.comparison_id}/current`);
    checkEvidence(comparison.evidence, `${comparison.comparison_id}/comparison`);
  }

  for (const event of city.structural_events) {
    invariant(!eventIds.has(event.event_id), `${event.event_id}: duplicate event`);
    eventIds.add(event.event_id);
    invariant(event.human_review_status === "pending", `${event.event_id}: human review must remain pending`);
    checkEvidence(event.evidence, event.event_id);
  }

  for (const chunk of city.chunks) {
    invariant(!chunkIds.has(chunk.chunk_id), `${chunk.chunk_id}: duplicate chunk`);
    chunkIds.add(chunk.chunk_id);
    const allowedNumericValidation =
      chunk.record_type === "budget_structural_event_chunk"
        ? ["passed", "not_applicable_structural_event"]
        : ["passed"];
    invariant(
      allowedNumericValidation.includes(chunk.numeric_validation),
      `${chunk.chunk_id}: numeric validation state is invalid`,
    );
    invariant(chunk.human_review_status === "pending", `${chunk.chunk_id}: human review must remain pending`);
    invariant(chunk.rag_gate_state === "blocked", `${chunk.chunk_id}: RAG gate must remain blocked`);
    invariant(chunk.publish_state === "blocked", `${chunk.chunk_id}: publish state must remain blocked`);
    invariant(typeof chunk.text === "string" && chunk.text.length >= 200, `${chunk.chunk_id}: text is too short`);
    for (const recordId of chunk.record_ids) {
      invariant(
        factIds.has(recordId) || comparisonIds.has(recordId) || eventIds.has(recordId),
        `${chunk.chunk_id}: unknown record ${recordId}`,
      );
    }
    checkEvidence(chunk.evidence, chunk.chunk_id);
  }
}

invariant(cityIds.size === expectedTotals.municipalities, "municipality total mismatch");
invariant(factIds.size === expectedTotals.facts, "fact total mismatch");
invariant(comparisonIds.size === expectedTotals.comparisons, "comparison total mismatch");
invariant(eventIds.size === expectedTotals.structural_events, "event total mismatch");
invariant(chunkIds.size === expectedTotals.private_chunks, "chunk total mismatch");

console.log(
  JSON.stringify(
    {
      status: "passed",
      ...expectedTotals,
      external_vector_index: false,
      index_write_performed: false,
      public_rag_gate: "blocked",
    },
    null,
    2,
  ),
);
