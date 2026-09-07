import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { checkCanonicalMinutes, classifyRootOnly } from "../data-health.mjs";

test("canonical minutes evidence is root-only, while existing public candidates keep their classification", () => {
  for (const file of ["sample/council-records/index.json", "sample/council-records/1/releases/run/record.json", "sample/council-records/1/snapshots/raw.pdf"]) {
    assert.equal(classifyRootOnly(file), "canonical_minutes");
  }
  assert.equal(classifyRootOnly("sample/publications/minutes/1.json"), "root_only_public_candidate");
  assert.equal(classifyRootOnly("sample/minutes/1.json"), "root_only_public_candidate");
  assert.equal(classifyRootOnly("sample/segments/1.json"), "local_segments");
});

async function inspectRegistry(registry) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "health-canonical-"));
  try {
    if (registry !== undefined) {
      const registryPath = path.join(repoRoot, "data/sample/council-records/index.json");
      fs.mkdirSync(path.dirname(registryPath), { recursive: true });
      fs.writeFileSync(registryPath, typeof registry === "string" ? registry : JSON.stringify(registry));
    }
    const report = { errors: [] };
    await checkCanonicalMinutes(report, [{ slug: "sample" }, { slug: "unmanaged" }], repoRoot);
    return report.errors;
  } finally { fs.rmSync(repoRoot, { recursive: true, force: true }); }
}

function registry(records) {
  return { schema_version: "council-record-body-registry.v1", municipality_id: "sample", records };
}

test("health permits absent and rolled-back canonical registrations", async () => {
  assert.deepEqual(await inspectRegistry(undefined), []);
  assert.deepEqual(await inspectRegistry(registry([{ council_id: 1, state: "rolled_back" }])), []);
});

test("health reports malformed registries without aborting the report", async () => {
  for (const value of ["{invalid", registry(null), registry([{ council_id: 1, state: "typo" }])]) {
    const errors = await inspectRegistry(value);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /data\/sample\/council-records\/index.json/u);
  }
});

test("health invokes the complete release verifier for every active council", async () => {
  const records = [1, 2].map((council_id) => ({ council_id, state: "active",
    release_path: `council-records/${council_id}/releases/test-run`,
    minutes_sha256: "a".repeat(64), publication_sha256: "b".repeat(64) }));
  const errors = await inspectRegistry(registry(records));
  assert.equal(errors.length, 2);
  assert.match(errors[0], /council 1:.*storage-manifest\.json/u);
  assert.match(errors[1], /council 2:.*storage-manifest\.json/u);
});
