import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const previewPath = path.join(siteRoot, "data/data-loop-preview/budget-preview.v1.json");
const expectedMunicipalities = ["asahikawa", "ebetsu", "eniwa", "sapporo", "chitose"].sort();
const requiredBlockedSurfaces = ["public_facts", "public_markdown", "public_rag", "public_ui", "raw_document_mirror", "cross_municipality_comparison"];
const allowedExistenceStates = new Set(["exists", "unknown", "not_published_confirmed", "does_not_exist_confirmed"]);
const allowedScopeDispositions = new Set(["in_scope", "deferred", "separate_source", "separate_model", "out_of_scope", "unknown_not_assessed"]);
const errors = [];

function check(condition, message) {
  if (!condition) errors.push(message);
}

function isHttpsLandingPage(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !/\.(?:pdf|xlsx?|csv|zip)(?:$|[?#])/i.test(url.pathname);
  } catch {
    return false;
  }
}

let preview;
try {
  preview = JSON.parse(fs.readFileSync(previewPath, "utf8"));
} catch (error) {
  console.error(`Data Loop preview cannot be read: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

check(preview.schema_version === "budget-data-loop-preview.v1", "Unexpected preview schema version.");
check(preview.access_level === "password_protected_test_preview", "Preview access level is not password protected.");
check(preview.totals?.public_ready === 0, "At least one public release gate is unexpectedly ready.");

const municipalityIds = preview.municipalities.map((city) => city.municipality_id).sort();
check(JSON.stringify(municipalityIds) === JSON.stringify(expectedMunicipalities), "Preview municipality set differs from the five-city PoC.");

const totals = {
  facts: 0,
  comparisons: 0,
  structural_events: 0,
  coverage_records: 0,
  private_chunks: 0,
  technical_validation_passed: 0,
  public_ready: 0,
};

for (const city of preview.municipalities) {
  const prefix = city.municipality_id;
  check(city.technical_validation === "passed", `${prefix}: technical validation is not passed.`);
  check(city.release_surfaces?.private_data === "ready", `${prefix}: private data gate is not ready.`);
  for (const surface of requiredBlockedSurfaces) {
    check(city.release_surfaces?.[surface] === "blocked", `${prefix}: ${surface} is not blocked.`);
  }
  for (const [surface, state] of Object.entries(city.release_surfaces)) {
    if (surface !== "private_data") check(state === "blocked", `${prefix}: ${surface} is unexpectedly ready.`);
  }
  check(city.counts.facts > 0, `${prefix}: no canonical facts.`);
  check(city.counts.comparisons === city.comparisons.length, `${prefix}: comparison count mismatch.`);
  check(city.counts.structural_events === city.structural_events.length, `${prefix}: structural event count mismatch.`);
  check(city.counts.coverage_records === city.coverage.length, `${prefix}: Coverage count mismatch.`);
  check(city.counts.approved_review_items === 0, `${prefix}: preview unexpectedly contains approved human review items.`);
  check(city.blockers.length > 0, `${prefix}: no release blockers are recorded.`);

  for (const comparison of city.comparisons) {
    check(comparison.comparison_status === "pending_review", `${prefix}/${comparison.comparison_id}: comparison is not pending review.`);
    check(comparison.baseline_evidence.length > 0, `${prefix}/${comparison.comparison_id}: R7 evidence is missing.`);
    check(comparison.current_evidence.length > 0, `${prefix}/${comparison.comparison_id}: R8 evidence is missing.`);
    for (const evidence of [...comparison.baseline_evidence, ...comparison.current_evidence]) {
      check(isHttpsLandingPage(evidence.official_landing_url), `${prefix}/${comparison.comparison_id}: evidence is not an official HTTPS landing page.`);
    }
  }

  for (const item of city.coverage) {
    check(allowedExistenceStates.has(item.existence_state), `${prefix}/${item.coverage_id}: invalid existence state.`);
    check(allowedScopeDispositions.has(item.scope_disposition), `${prefix}/${item.coverage_id}: invalid scope disposition.`);
    if (item.existence_state !== "exists") {
      check(item.observed_count == null, `${prefix}/${item.coverage_id}: a non-existent or unknown scope has an observed count.`);
    }
  }

  totals.facts += city.counts.facts;
  totals.comparisons += city.counts.comparisons;
  totals.structural_events += city.counts.structural_events;
  totals.coverage_records += city.counts.coverage_records;
  totals.private_chunks += city.counts.private_chunks;
  totals.technical_validation_passed += city.technical_validation === "passed" ? 1 : 0;
  totals.public_ready += Object.entries(city.release_surfaces).some(([surface, state]) => surface !== "private_data" && state === "ready") ? 1 : 0;
}

for (const [key, value] of Object.entries(totals)) {
  check(preview.totals?.[key] === value, `Preview total mismatch: ${key}.`);
}

if (errors.length) {
  console.error(JSON.stringify({ status: "failed", errors }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  status: "passed",
  municipalities: preview.municipalities.length,
  comparisons: totals.comparisons,
  coverage_records: totals.coverage_records,
  public_ready: totals.public_ready,
}, null, 2));
