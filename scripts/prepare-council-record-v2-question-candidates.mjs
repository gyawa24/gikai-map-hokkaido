#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadDnpSnapshotBundle } from "./lib/dnp-council-record-v2.mjs";
import { assertCouncilRecordV2CaptureBinding } from "./lib/council-record-v2-capture-binding.mjs";
import { createQuestionCandidateReport } from "./lib/council-record-v2-question-candidates.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const { values } = parseArgs({ options: { record: { type: "string" }, manifest: { type: "string" }, help: { type: "boolean" } } });
if (values.help || !values.record || !values.manifest) {
  console.log("node scripts/prepare-council-record-v2-question-candidates.mjs --record <record.json> --manifest <capture-manifest.json>");
  process.exit(values.help ? 0 : 1);
}
try {
  const record = JSON.parse(fs.readFileSync(path.resolve(values.record), "utf8"));
  const bundle = loadDnpSnapshotBundle(path.resolve(values.manifest), root);
  assertCouncilRecordV2CaptureBinding(record, bundle);
  const baselinePath = path.join(root, "data", bundle.municipality.slug, "members_activity.json");
  const baselineActivity = fs.existsSync(baselinePath) ? JSON.parse(fs.readFileSync(baselinePath, "utf8")) : null;
  const fileEvidence = (filename) => ({ path: path.relative(root, path.resolve(filename)),
    content_sha256: createHash("sha256").update(fs.readFileSync(filename)).digest("hex") });
  const inputProvenance = { record: fileEvidence(values.record), manifest: fileEvidence(values.manifest),
    baseline: fs.existsSync(baselinePath) ? fileEvidence(baselinePath) : null,
    implementation_files: ["scripts/lib/council-record-v2-question-candidates.mjs", "scripts/prepare-council-record-v2-question-candidates.mjs",
      "site/scripts/build-member-activity.mjs", "scripts/lib/council-record-v2-projection.mjs", "scripts/lib/council-record-v2-validation.mjs",
      "scripts/lib/council-record-v2-preview.mjs", "scripts/lib/dnp-council-record-v2.mjs", "scripts/lib/council-record-v2-capture-binding.mjs", "schemas/council-record.v2.schema.json"].map((filename) => fileEvidence(path.join(root, filename))) };
  const generatedAt = new Date().toISOString();
  const report = createQuestionCandidateReport({ record, bundle, baselineActivity, generatedAt, inputProvenance });
  const directory = path.join(root, "reports", "council-record-v2-question-candidates", bundle.municipality.slug,
    String(bundle.legacyCouncil.council_id), `${generatedAt.replace(/[:.]/g, "-")}-${randomUUID()}`);
  fs.mkdirSync(directory, { recursive: true });
  const artifactPath = path.join(directory, "question-candidates.json");
  fs.writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({ directory, artifactPath, candidate_count: report.candidate_count,
    baseline_status: report.comparison.baseline_status, baseline_count: report.comparison.baseline_count,
    matched_count: report.comparison.matched_count, difference_count: report.comparison.difference_count,
    unclassified_turn_count: report.unclassified_turn_count, public_visible: false }, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
