import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildDnpCouncilRecordV2, DNP_API_BASE } from '../lib/dnp-council-record-v2.mjs';
import { prepareCouncilRecordV2BodyRelease, activateCouncilRecordV2BodyRelease,
  verifyCouncilRecordV2BodyRelease, rollbackCouncilRecordV2BodyRelease } from '../lib/council-record-v2-body-storage.mjs';
import { syncPublishedMinutes } from '../sync-site-data.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const encode = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
function contractFixture() {
  const generatedAt = '2026-09-07T00:00:00Z';
  const municipality = { slug: 'sample-town', system: 'dnp', tenant_id: 1 };
  const schedule = { schedule_id: 2, name: '3月2日（第1号）', page_no: 1 };
  const minute = { minute_id: 4, title: '◆議員（原表記君）', minute_type: '本会議' };
  const legacyCouncil = { council_id: 10, name: '合成検証会議', year: '2026', japanese_year: '令和8年', type_label: '定例会',
    schedules: [{ ...schedule, minutes: [{ ...minute, text: '原文を保持。' }] }] };
  const captures = [
    ['minutes/get_schedule', {}, { council_schedules: [schedule] }],
    ['minutes/get_minute', { schedule_id: 2 }, { tenant_minutes: [{ ...minute, body: '原文を保持。' }] }],
  ].map(([endpoint, payload, data]) => {
    const bytes = Buffer.from(JSON.stringify(data));
    const digest = hash(bytes);
    return { endpoint, request: { method: 'POST', url: `${DNP_API_BASE}/${endpoint}`, payload: { tenant_id: 1, council_id: 10, ...payload } },
      bytes, content_sha256: digest, observed_at: generatedAt, fetched_at: generatedAt, byte_size: bytes.length,
      mime_type: 'application/json', http_status: 200, etag: null, last_modified: null, snapshot_path: `fixtures/${digest}.json` };
  });
  const { record, revisionContents } = buildDnpCouncilRecordV2({ municipality, legacyCouncil, captures, generatedAt,
    codeRevision: 'abcdef123', pipelineRunId: 'sample-town:run:test' });
  const baselineBytes = encode(legacyCouncil);
  const manifest = { format: 'dnp-capture-manifest/1', municipality_id: municipality.slug, council_id: 10,
    legacy_input: { path: 'data/sample-town/minutes/10.json', sha256: hash(baselineBytes) },
    captures: captures.map(({ bytes: _bytes, ...capture }) => capture) };
  const manifestBytes = encode(manifest);
  return { record, recordBytes: encode(record), bundle: { municipality, legacyCouncil, captures, revisionContents, manifest },
    baselineBytes, manifestBytes,
    indexBytes: encode([{ council_id: 10, file: '10.json', content_sha256: hash(JSON.stringify(legacyCouncil)) }]),
    approval: { scope: 'body_only', approved_by: 'fixture-user', approved_at: '2026-09-06T23:59:00Z', approval_ref: 'fixture:explicit-body-approval' },
    freshness: { method: 'new_capture_verified', manifest_sha256: hash(manifestBytes), checked_at: generatedAt }, generatedAt };
}

function write(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
}
function readJson(file) { return JSON.parse(fs.readFileSync(file)); }
function treeHashes(directory) {
  return Object.fromEntries(fs.readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((item) => item.isFile()).map((item) => {
      const file = path.join(item.parentPath, item.name);
      return [path.relative(directory, file), hash(fs.readFileSync(file))];
    }).sort(([a], [b]) => a.localeCompare(b)));
}
function fixture(t) {
  const input = contractFixture();
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-body-release-'));
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  const source = path.join(repoRoot, 'data/sample-town/minutes');
  const destination = path.join(repoRoot, 'site/data/sample-town/minutes');
  const index = [{ council_id: 10, file: '10.json', name: '検証会議' }, { council_id: 20, file: '20.json', name: '他の会議' }];
  for (const dir of [source, destination]) {
    write(path.join(dir, '10.json'), input.baselineBytes);
    write(path.join(dir, '20.json'), encode({ council_id: 20, schedules: [{ schedule_id: 1, minutes: [] }] }));
    write(path.join(dir, 'index.json'), encode(index));
  }
  write(path.join(repoRoot, 'data/municipalities.json'), encode([input.bundle.municipality]));
  for (const capture of input.bundle.captures) write(path.join(repoRoot, capture.snapshot_path), capture.bytes);
  const recordPath = path.join(repoRoot, 'reports/record.json');
  const manifestPath = path.join(repoRoot, 'reports/manifest.json');
  write(recordPath, input.recordBytes); write(manifestPath, input.manifestBytes);
  const args = { repoRoot, recordPath, manifestPath, approval: input.approval, generatedAt: input.generatedAt,
    captureVerification: { manifest_sha256: hash(input.manifestBytes), checked_at: input.generatedAt } };
  return { repoRoot, source, destination, args, input, index };
}
function active(t) {
  const f = fixture(t);
  f.plan = prepareCouncilRecordV2BodyRelease(f.args);
  assert.equal(activateCouncilRecordV2BodyRelease(f.plan).status, 'verified');
  f.release = path.join(f.repoRoot, 'data/sample-town', f.plan.entry.release_path);
  return f;
}

test('dry preparation writes nothing; activation, copy and rollback preserve original IDs/text/bytes', async (t) => {
  const f = fixture(t);
  const before = treeHashes(f.repoRoot);
  const plan = prepareCouncilRecordV2BodyRelease(f.args);
  assert.deepEqual(treeHashes(f.repoRoot), before);
  assert.equal(activateCouncilRecordV2BodyRelease(plan).status, 'verified');
  assert.equal(verifyCouncilRecordV2BodyRelease(f.repoRoot, 'sample-town', 10).status, 'verified');
  assert.deepEqual(fs.readFileSync(path.join(f.source, '10.json')), f.input.baselineBytes);
  const record = readJson(path.join(f.repoRoot, 'data/sample-town', plan.entry.release_path, 'record.json'));
  assert.equal(record.publication.public_visible, false);
  assert.deepEqual(record.question_blocks, []);
  assert.ok(record.speakers.every((s) => s.person_id === null));
  await syncPublishedMinutes(f.source, f.destination);
  assert.deepEqual(fs.readFileSync(path.join(f.destination, '10.json')), f.input.baselineBytes);
  assert.deepEqual(readJson(path.join(f.destination, '10.json')), f.input.bundle.legacyCouncil);
  const beforeRollback = treeHashes(f.repoRoot);
  assert.equal(rollbackCouncilRecordV2BodyRelease(f.repoRoot, 'sample-town', 10).status, 'rollback_planned');
  assert.deepEqual(treeHashes(f.repoRoot), beforeRollback);
  assert.equal(rollbackCouncilRecordV2BodyRelease(f.repoRoot, 'sample-town', 10, { apply: true }).status, 'rolled_back');
  await syncPublishedMinutes(f.source, f.destination);
  assert.deepEqual(fs.readFileSync(path.join(f.destination, '10.json')), f.input.baselineBytes);
  assert.deepEqual(readJson(path.join(f.source, 'index.json')), f.index);
});

test('verification and rollback preserve later updates to another meeting in the index', (t) => {
  const f = active(t);
  const indexPath = path.join(f.source, 'index.json');
  const next = readJson(indexPath);
  next[1].name = '他の会議の新しい名称';
  next.push({ council_id: 30, file: '30.json', name: '後から追加' });
  write(indexPath, encode(next));
  assert.equal(verifyCouncilRecordV2BodyRelease(f.repoRoot, 'sample-town', 10).status, 'verified');
  rollbackCouncilRecordV2BodyRelease(f.repoRoot, 'sample-town', 10, { apply: true });
  const restored = readJson(indexPath);
  assert.deepEqual(restored[0], f.index[0]);
  assert.deepEqual(restored.slice(1), next.slice(1));
});

for (const kind of ['snapshot', 'record', 'publication', 'index', 'body']) {
  test(`${kind} tampering stops release verification and sync before public destination changes`, async (t) => {
    const f = active(t);
    let target;
    if (kind === 'snapshot') target = path.join(f.repoRoot, readJson(path.join(f.release, 'capture-manifest.json')).captures[0].snapshot_path);
    else if (kind === 'index') target = path.join(f.source, 'index.json');
    else if (kind === 'body') target = path.join(f.source, '10.json');
    else target = path.join(f.release, `${kind}.json`);
    if (kind === 'index') {
      const index = readJson(target); index[0].content_sha256 = '0'.repeat(64); write(target, encode(index));
    } else write(target, Buffer.from('{}'));
    const before = treeHashes(f.destination);
    assert.throws(() => verifyCouncilRecordV2BodyRelease(f.repoRoot, 'sample-town', 10));
    await assert.rejects(syncPublishedMinutes(f.source, f.destination));
    assert.deepEqual(treeHashes(f.destination), before);
  });
}

test('a damaged live body can be recovered from the independently verified stored baseline', async (t) => {
  const f = active(t);
  write(path.join(f.source, '10.json'), Buffer.from('broken live body'));
  assert.throws(() => verifyCouncilRecordV2BodyRelease(f.repoRoot, 'sample-town', 10));
  assert.equal(rollbackCouncilRecordV2BodyRelease(f.repoRoot, 'sample-town', 10, { apply: true }).status, 'rolled_back');
  assert.deepEqual(fs.readFileSync(path.join(f.source, '10.json')), f.input.baselineBytes);
  await syncPublishedMinutes(f.source, f.destination);
  assert.deepEqual(fs.readFileSync(path.join(f.destination, '10.json')), f.input.baselineBytes);
});

test('a modified stored baseline cannot be used for recovery', (t) => {
  const f = active(t);
  write(path.join(f.release, 'baseline.json'), Buffer.from('{}'));
  const before = treeHashes(f.source);
  assert.throws(() => rollbackCouncilRecordV2BodyRelease(f.repoRoot, 'sample-town', 10, { apply: true }));
  assert.deepEqual(treeHashes(f.source), before);
});

test('preparation requires a capture-bound recent verification declaration', (t) => {
  const f = fixture(t);
  const before = treeHashes(f.repoRoot);
  for (const args of [
    { ...f.args, captureVerification: undefined },
    { ...f.args, captureVerification: { ...f.args.captureVerification, manifest_sha256: '0'.repeat(64) } },
    { ...f.args, generatedAt: '2026-09-10T00:00:00Z', captureVerification: {
      ...f.args.captureVerification, checked_at: '2026-09-10T00:00:00Z' } },
  ]) assert.throws(() => prepareCouncilRecordV2BodyRelease(args));
  assert.deepEqual(treeHashes(f.repoRoot), before);
});

test('an active canonical meeting must be explicitly rolled back before preparing a replacement', async (t) => {
  const f = active(t);
  await syncPublishedMinutes(f.source, f.destination);
  const before = treeHashes(f.repoRoot);
  assert.throws(() => prepareCouncilRecordV2BodyRelease({ ...f.args, generatedAt: '2026-09-07T00:01:00Z' }));
  assert.deepEqual(treeHashes(f.repoRoot), before);
});

for (const kind of ['missing', 'duplicate']) {
  test(`rollback restores exactly one managed index entry when its live entry is ${kind}`, (t) => {
    const f = active(t);
    const indexPath = path.join(f.source, 'index.json');
    const index = readJson(indexPath);
    const other = { ...index[1], name: '復旧対象外の更新を保持' };
    write(indexPath, encode(kind === 'missing' ? [other] : [index[0], other, { ...index[0] }]));
    rollbackCouncilRecordV2BodyRelease(f.repoRoot, 'sample-town', 10, { apply: true });
    const restored = readJson(indexPath);
    assert.deepEqual(restored.filter((item) => item.council_id === 10), [f.index[0]]);
    assert.deepEqual(restored.filter((item) => item.council_id !== 10), [other]);
  });
}
