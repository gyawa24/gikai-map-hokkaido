#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { sha256, writeImmutable } from './lib/dnp-council-record-v2.mjs';
import { loadCouncilRecordV2SnapshotBundle } from './lib/council-record-v2-snapshot-bundle.mjs';
import { assertCouncilRecordV2CaptureBinding } from './lib/council-record-v2-capture-binding.mjs';
import { buildCouncilRecordV2Segments } from './lib/council-record-v2-segments.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({ options: { record: { type: 'string' }, manifest: { type: 'string' }, help: { type: 'boolean' } } });
if (values.help || !values.record || !values.manifest) {
  console.log('node scripts/build-council-record-v2-segments-preview.mjs --record <record.json> --manifest <capture-manifest.json>');
  process.exit(values.help ? 0 : 1);
}

try {
  const record = JSON.parse(fs.readFileSync(path.resolve(values.record), 'utf8'));
  const bundle = loadCouncilRecordV2SnapshotBundle(path.resolve(values.manifest), root);
  assertCouncilRecordV2CaptureBinding(record, bundle);
  const membersPath = `data/${bundle.municipality.slug}/members.json`;
  let memberBytes = null;
  try { memberBytes = fs.readFileSync(path.join(root, membersPath)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const memberData = memberBytes === null ? [] : JSON.parse(memberBytes);
  const members = Array.isArray(memberData) ? memberData : [];
  const result = buildCouncilRecordV2Segments(record, { municipality: bundle.municipality, legacyMinutes: bundle.legacyCouncil,
    revisionContents: bundle.revisionContents, members, generatedAt: new Date().toISOString() });
  const provenance = { ...result.provenance,
    members_input: { path: membersPath, content_sha256: memberBytes === null ? null : sha256(memberBytes),
      status: memberBytes === null ? 'absent' : Array.isArray(memberData) ? 'loaded' : 'non_array_legacy_fallback' },
    source_manifest: path.relative(root, path.resolve(values.manifest)),
    implementation_files: Object.fromEntries(['scripts/build-segments.mjs', 'scripts/lib/council-record-v2-segments.mjs',
      'scripts/lib/council-record-v2-projection.mjs', 'scripts/lib/council-record-v2-validation.mjs',
      'scripts/lib/council-record-v2-preview.mjs', 'scripts/lib/dnp-council-record-v2.mjs',
      'scripts/lib/council-record-v2-snapshot-bundle.mjs', 'scripts/lib/gijiroku-council-record-v2.mjs',
      'scripts/lib/council-record-v2-capture-binding.mjs',
      'scripts/build-council-record-v2-segments-preview.mjs', 'schemas/council-record.v2.schema.json',
      'site/src/lib/searchNormalization.mjs'].map((file) => [file, sha256(fs.readFileSync(path.join(root, file)))])) };
  const runHash = sha256(JSON.stringify(provenance));
  // Keep one-meeting index files isolated: a subsequent trial must not replace another meeting's index.
  const directory = path.join(root, 'reports/council-record-v2-segments-preview', bundle.municipality.slug,
    String(bundle.legacyCouncil.council_id), runHash);
  const save = (name, value) => writeImmutable(path.join(directory, name), `${JSON.stringify(value, null, 2)}\n`);
  save(`segments/${bundle.legacyCouncil.council_id}.json`, result.segments);
  save('segments/_index.json', result.indexEntries);
  save('provenance.json', provenance);
  save('validation.json', result.validation);
  console.log(JSON.stringify({ directory, segment_count: result.segments.length,
    legacy_equivalence: true, public_visible: false, question_block_extraction: 'not_implemented' }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
