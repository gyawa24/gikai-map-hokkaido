#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { assertDnpMunicipality, buildDnpCouncilRecordV2, captureDnpResponse, loadDnpSnapshotBundle,
  sha256, writeImmutable } from './lib/dnp-council-record-v2.mjs';
import { assertMinutesV2PreviewValidation } from './lib/council-record-v2-preview.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!['--slug', '--council', '--manifest'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Usage: --slug <slug> --council <id> OR --manifest <capture-manifest.json>');
  options[args[i].slice(2)] = args[i + 1];
}
if (options.manifest && (options.slug || options.council)) throw new Error('Use --manifest independently');

async function main() {
  const runName = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
  let municipality, legacyCouncil, captures, manifest;
  if (options.manifest) {
    ({ municipality, legacyCouncil, captures, manifest } = loadDnpSnapshotBundle(path.resolve(options.manifest), root));
  } else {
    municipality = JSON.parse(fs.readFileSync(path.join(root, 'data/municipalities.json'), 'utf8')).find((m) => m.slug === options.slug);
    assertDnpMunicipality(municipality);
    if (!/^\d+$/.test(options.council || '')) throw new Error('--council must be an integer');
    const inputPath = `data/${municipality.slug}/minutes/${options.council}.json`;
    const inputBytes = fs.readFileSync(path.join(root, inputPath));
    legacyCouncil = JSON.parse(inputBytes);
    manifest = { format: 'dnp-capture-manifest/1', municipality_id: municipality.slug,
      council_id: legacyCouncil.council_id, legacy_input: { path: inputPath, sha256: sha256(inputBytes) }, captures: [] };
    captures = [];
  }
  const outputBase = path.join(root, 'reports/council-record-v2', municipality.slug, String(legacyCouncil.council_id));
  const runDir = path.join(outputBase, 'runs', runName);
  const save = (name, value) => writeImmutable(path.join(runDir, name), `${JSON.stringify(value, null, 2)}\n`);
  if (!options.manifest) {
    const payload = { tenant_id: municipality.tenant_id, council_id: legacyCouncil.council_id };
    const requests = [{ endpoint: 'minutes/get_schedule', payload }, ...legacyCouncil.schedules.map((s) => ({
      endpoint: 'minutes/get_minute', payload: { ...payload, schedule_id: s.schedule_id } }))];
    try {
      for (const [index, request] of requests.entries()) {
        if (index) await setTimeout(1500);
        const capture = await captureDnpResponse({ ...request, snapshotDir: path.join(outputBase, 'snapshots'), repoRoot: root });
        captures.push(capture);
        console.log(`Captured ${request.endpoint}${request.payload.schedule_id === undefined ? '' : ` schedule ${request.payload.schedule_id}`}: ${capture.content_sha256}`);
      }
    } catch (error) {
      save('capture-failure.json', { message: error.message, completed_captures: captures.map(({ bytes, ...capture }) => capture),
        failed_capture: error.capture || null, failed_at: new Date().toISOString() });
      throw error;
    }
    manifest.captures = captures.map(({ bytes, ...capture }) => capture);
  }
  save('capture-manifest.json', manifest);
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const generatorHash = sha256(Buffer.concat(['scripts/build-dnp-council-record-v2.mjs', 'scripts/lib/dnp-council-record-v2.mjs']
    .map((file) => fs.readFileSync(path.join(root, file)))));
  const generatedAt = new Date().toISOString();
  const { record, revisionContents } = buildDnpCouncilRecordV2({ municipality, legacyCouncil, captures, generatedAt,
    codeRevision: `${head}:generator-sha256:${generatorHash}`, pipelineRunId: `${municipality.slug}:run:dnp:${runName}` });
  const { validateCouncilRecordV2, COUNCIL_RECORD_V2_VALIDATOR_VERSION } = await import('./lib/council-record-v2-validation.mjs');
  const result = validateCouncilRecordV2(record, { revisionContents });
  record.derivation.validation = { status: result.ok && result.warnings.length === 0 ? 'pass' : 'fail', checked_at: new Date().toISOString(),
    validator_version: COUNCIL_RECORD_V2_VALIDATOR_VERSION, errors: result.errors.map((e) => `${e.gate}:${e.path}: ${e.message}`),
    warnings: result.warnings.map((e) => `${e.gate}:${e.path}: ${e.message}`) };
  record.publication.checked_at = record.derivation.validation.checked_at;
  record.publication.gate_results = result.gateResults;
  save('validation.json', result);
  assertMinutesV2PreviewValidation(result);
  save('record.json', record);
  console.log(JSON.stringify({ record: path.join(runDir, 'record.json'), manifest: path.join(runDir, 'capture-manifest.json'),
    sittings: record.sittings.length, turns: record.turns.length, document_items: record.document_items.length,
    public_visible: record.publication.public_visible }, null, 2));
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
