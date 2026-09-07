import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const PREVIEW_ARTIFACT_VERSION = "council-record-v2-preview.v1";
export const PREVIEW_POINTER_VERSION = "council-record-v2-preview-pointer.v1";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function assertMinutesV2PreviewValidation(validation) {
  assert.equal(validation.ok, true, "v2 validation failed; no preview will be written");
  assert.deepEqual(validation.errors, [], "v2 validation errors remain");
  assert.deepEqual(validation.warnings, [], "v2 validation evidence is incomplete; no preview will be written");
  assert.ok(Array.isArray(validation.gateResults), "v2 validation gates are missing");
  assert.ok(validation.gateResults.every((result) => ["pass", "not_applicable"].includes(result.status)), "a v2 validation gate failed");
  for (const gate of ["schema", "graph", "provenance", "content", "freshness"]) {
    const results = validation.gateResults.filter((result) => result.gate === gate);
    assert.equal(results.length, 1, `${gate} must be checked exactly once`);
    assert.equal(results[0].status, "pass", `${gate} must pass before preview`);
  }
}

export function createMinutesV2PreviewArtifact({ record, projection, legacyMinutes, indexItem, validation, preparedAt }) {
  assertMinutesV2PreviewValidation(validation);
  assert.equal(projection.publication.public_visible, false, "the preview must remain non-public");
  assert.match(record.municipality_id, /^[a-z][a-z0-9_-]*$/u);
  assert.match(String(legacyMinutes.council_id), /^\d+$/u);
  assert.equal(String(indexItem.council_id), String(legacyMinutes.council_id), "published index belongs to another meeting");
  assert.deepEqual(projection.minutes, legacyMinutes, "v2 projection differs from the original minutes (including IDs, order and text)");
  return {
    schema_version: PREVIEW_ARTIFACT_VERSION,
    record_id: record.record_id,
    municipality_id: record.municipality_id,
    council_id: String(legacyMinutes.council_id),
    prepared_at: preparedAt,
    publication: { state: "internal_preview", public_visible: false },
    validation: {
      ok: true,
      warning_count: 0,
      legacy_equivalence: true,
      publication_ready: validation.publicationReady === true,
      gate_results: validation.gateResults,
    },
    counts: {
      sittings: record.sittings.length,
      turns: record.turns.length,
      document_items: record.document_items.length,
      original_records: legacyMinutes.schedules.reduce((total, sitting) => total + sitting.minutes.length, 0),
    },
    index_item: indexItem,
    minutes: projection.minutes,
    provenance: projection.provenance,
  };
}

export function writeMinutesV2PreviewArtifact(previewRoot, artifact) {
  assert.match(artifact.municipality_id, /^[a-z][a-z0-9_-]*$/u);
  assert.match(artifact.council_id, /^\d+$/u);
  const directory = path.join(previewRoot, artifact.municipality_id, artifact.council_id);
  fs.mkdirSync(directory, { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`);
  const digest = sha256(bytes);
  const artifactFile = `${digest}.json`;
  const artifactPath = path.join(directory, artifactFile);
  try {
    fs.writeFileSync(artifactPath, bytes, { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    assert.equal(sha256(fs.readFileSync(artifactPath)), digest, "an existing preview artifact was changed");
  }
  const pointer = {
    schema_version: PREVIEW_POINTER_VERSION,
    artifact_file: artifactFile,
    artifact_sha256: digest,
  };
  const temporary = path.join(directory, `.current-${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(pointer, null, 2)}\n`, { flag: "wx" });
    fs.renameSync(temporary, path.join(directory, "current.json"));
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return { directory, artifactPath, artifactSha256: digest };
}
