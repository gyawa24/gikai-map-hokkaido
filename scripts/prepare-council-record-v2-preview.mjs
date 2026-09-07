import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadCouncilRecordV2SnapshotBundle } from "./lib/council-record-v2-snapshot-bundle.mjs";
import { assertCouncilRecordV2CaptureBinding } from "./lib/council-record-v2-capture-binding.mjs";
import { validateCouncilRecordV2 } from "./lib/council-record-v2-validation.mjs";
import { projectCouncilRecordV2ToMinutes } from "./lib/council-record-v2-projection.mjs";
import { assertMinutesV2PreviewValidation, createMinutesV2PreviewArtifact, writeMinutesV2PreviewArtifact } from "./lib/council-record-v2-preview.mjs";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const { values } = parseArgs({ options: { record: { type: "string" }, manifest: { type: "string" }, help: { type: "boolean" } } });
if (values.help || !values.record || !values.manifest) {
  console.log("node scripts/prepare-council-record-v2-preview.mjs --record <record.json> --manifest <capture-manifest.json>");
  process.exit(values.help ? 0 : 1);
}

try {
  const record = JSON.parse(fs.readFileSync(path.resolve(values.record), "utf8"));
  const bundle = loadCouncilRecordV2SnapshotBundle(path.resolve(values.manifest), repoRoot);
  assertCouncilRecordV2CaptureBinding(record, bundle);
  const validation = validateCouncilRecordV2(record, { revisionContents: bundle.revisionContents });
  assertMinutesV2PreviewValidation(validation);
  const slug = record.municipality_id;
  assert.match(slug, /^[a-z][a-z0-9_-]*$/u);
  assert.equal(bundle.municipality.slug, slug, "record municipality differs from its snapshot manifest");
  const indexCandidates = [
    path.join(repoRoot, "site", "data", slug, "minutes", "index.json"),
    path.join(repoRoot, "site", "data", slug, "index.json"),
  ];
  const indexPath = indexCandidates.find((filename) => fs.existsSync(filename));
  assert.ok(indexPath, "a published minutes index is required for this preview");
  const publicationIndex = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  assert.ok(Array.isArray(publicationIndex), "published index must be an array");
  const matchingItems = publicationIndex.filter((item) => String(item.council_id) === String(bundle.legacyCouncil.council_id));
  assert.equal(matchingItems.length, 1, "meeting must occur exactly once in the published index");
  assert.notEqual(bundle.municipality.minutes_access, "restricted", "restricted minutes cannot be previewed through the site");
  const projection = projectCouncilRecordV2ToMinutes(record, {
    municipality: bundle.municipality,
    publicationIndex,
    generatedAt: record.derivation.generated_at,
    mode: "preview",
  });
  const artifact = createMinutesV2PreviewArtifact({
    record, projection, validation,
    legacyMinutes: bundle.legacyCouncil,
    indexItem: matchingItems[0],
    preparedAt: new Date().toISOString(),
  });
  const previewRoot = path.join(repoRoot, "reports", "council-record-v2-preview");
  const output = writeMinutesV2PreviewArtifact(previewRoot, artifact);
  console.log(JSON.stringify({
    ...output,
    counts: artifact.counts,
    legacy_equivalence: true,
    public_visible: false,
    development_preview_path: `/${artifact.municipality_id}/minutes/${artifact.council_id}/preview`,
    development_preview_root: previewRoot,
  }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
