#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { loadGijirokuSnapshotBundle, gijirokuSourceId, gijirokuRevisionId } from './lib/gijiroku-council-record-v2.mjs';
import { buildDocumentCouncilRecordV2 } from './lib/document-council-record-v2.mjs';
import { sha256, writeImmutable } from './lib/dnp-council-record-v2.mjs';
import { validateCouncilRecordV2, COUNCIL_RECORD_V2_VALIDATOR_VERSION } from './lib/council-record-v2-validation.mjs';
import { assertMinutesV2PreviewValidation } from './lib/council-record-v2-preview.mjs';
import { projectCouncilRecordV2ToMinutes } from './lib/council-record-v2-projection.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({ options: { manifest: { type: 'string' }, help: { type: 'boolean' } } });
if (values.help || !values.manifest) {
  console.log('node scripts/build-gijiroku-council-record-v2.mjs --manifest <capture-manifest.json>');
  process.exit(values.help ? 0 : 1);
}
try {
  const bundle = loadGijirokuSnapshotBundle(path.resolve(values.manifest), root);
  const { municipality, legacyCouncil, captures } = bundle;
  const sourceArtifacts = captures.map((capture) => {
    const sourceId = gijirokuSourceId(municipality.slug, legacyCouncil.council_id, capture);
    const revisionId = gijirokuRevisionId(municipality.slug, legacyCouncil.council_id, capture);
    const document = bundle.documents.find((item) => item.mapping.fino === capture.external_ids.fino);
    return { id: sourceId, municipality_id: municipality.slug, authority: 'official', kind: 'html', record_status: 'official',
      title: document?.schedule.name || legacyCouncil.name, landing_url: document?.frame.request.url || capture.request.url,
      content_url: capture.request.url, current_revision_id: revisionId,
      external_ids: { provider: 'gijiroku_com', act: capture.act, ...capture.external_ids },
      revisions: [{ id: revisionId, observed_at: capture.observed_at, fetched_at: capture.fetched_at,
        retrieval_status: 'fetched', parse_status: 'parsed', content_sha256: capture.content_sha256,
        extracted_text_sha256: capture.content.text === null ? null : sha256(capture.content.text),
        snapshot_path: capture.snapshot_path, mime_type: capture.mime_type, http_status: capture.http_status,
        etag: capture.etag, last_modified: capture.last_modified, byte_size: capture.byte_size }] };
  });
  const documents = bundle.documents.map(({ schedule, mapping, body }) => ({ legacy_schedule_id: schedule.schedule_id,
    provider_document_id: mapping.fino, source_artifact_id: gijirokuSourceId(municipality.slug, legacyCouncil.council_id, body),
    source_revision_id: gijirokuRevisionId(municipality.slug, legacyCouncil.council_id, body), text: body.content.text,
    external_ids: { provider: 'gijiroku_com', kgno: mapping.kgno, fino: mapping.fino, unid: mapping.unid } }));
  const generatedAt = new Date().toISOString();
  const runId = `${generatedAt.replace(/[:.]/g, '-')}-${randomUUID()}`;
  const output = path.join(root, 'reports/council-record-v2', municipality.slug, String(legacyCouncil.council_id), 'runs', runId);
  const save = (name, value) => writeImmutable(path.join(output, name), `${JSON.stringify(value, null, 2)}\n`);
  save('capture-manifest.json', bundle.manifest);
  const codeFiles = ['scripts/build-gijiroku-council-record-v2.mjs', 'scripts/lib/gijiroku-council-record-v2.mjs',
    'scripts/lib/document-council-record-v2.mjs', 'scripts/capture-gijiroku-council-v2.py', 'scraper/scrape_minutes_gijiroku.py'];
  const codeHash = sha256(Buffer.concat(codeFiles.map((file) => fs.readFileSync(path.join(root, file)))));
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const record = buildDocumentCouncilRecordV2({ municipality, legacyCouncil, providerNamespace: 'gijiroku', sourceArtifacts,
    documents, generatedAt, codeRevision: `${head}:generator-sha256:${codeHash}`, pipelineRunId: `${municipality.slug}:run:document:${runId}` });
  const validation = validateCouncilRecordV2(record, { revisionContents: bundle.revisionContents });
  save('validation.json', validation);
  assertMinutesV2PreviewValidation(validation);
  const projection = projectCouncilRecordV2ToMinutes(record, { municipality, generatedAt, mode: 'preview' });
  assert.deepEqual(projection.minutes, legacyCouncil, 'Whole-document v2 does not reproduce every original field');
  record.derivation.validation = { status: 'pass', checked_at: new Date().toISOString(),
    validator_version: COUNCIL_RECORD_V2_VALIDATOR_VERSION, errors: [], warnings: [] };
  record.publication.checked_at = record.derivation.validation.checked_at;
  record.publication.gate_results = validation.gateResults;
  save('record.json', record);
  console.log(JSON.stringify({ record: path.join(output, 'record.json'), manifest: path.join(output, 'capture-manifest.json'),
    sittings: record.sittings.length, turns: 0, document_items: record.document_items.length,
    legacy_equivalence: true, public_visible: false }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
