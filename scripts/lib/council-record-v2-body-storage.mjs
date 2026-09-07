import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadDnpSnapshotBundle, sha256, writeImmutable } from './dnp-council-record-v2.mjs';
import { projectCouncilRecordV2ToMinutes } from './council-record-v2-projection.mjs';
import { createCouncilRecordV2BodyPublication, verifyCouncilRecordV2BodyPublication } from './council-record-v2-body-publication.mjs';

const CODE_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const IMPLEMENTATION_FILES = [
  'scripts/lib/council-record-v2-body-storage.mjs',
  'scripts/lib/council-record-v2-body-publication.mjs',
  'scripts/lib/council-record-v2-validation.mjs',
  'scripts/lib/council-record-v2-capture-binding.mjs',
  'scripts/lib/council-record-v2-preview.mjs',
  'scripts/lib/council-record-v2-projection.mjs',
  'scripts/lib/dnp-council-record-v2.mjs',
  'schemas/council-record.v2.schema.json',
  'site/package-lock.json',
];
const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const read = (file) => fs.readFileSync(file);
const readJson = (file) => JSON.parse(read(file));
const implementationHashes = () => Object.fromEntries(IMPLEMENTATION_FILES.map((file) => [file, sha256(read(path.join(CODE_ROOT, file)))]));

function identifiers(slug, councilId) {
  assert.match(slug, /^[a-z][a-z0-9_-]*$/u);
  assert.ok(Number.isSafeInteger(Number(councilId)) && Number(councilId) > 0, 'invalid council id');
}

function confined(base, relative) {
  assert.equal(typeof relative, 'string');
  assert.ok(!path.isAbsolute(relative) && !relative.split(/[\\/]/u).includes('..'), 'unsafe stored path');
  const file = path.resolve(base, relative);
  assert.ok(file.startsWith(`${path.resolve(base)}${path.sep}`), 'stored path escapes its root');
  let existing = file;
  while (!fs.existsSync(existing)) existing = path.dirname(existing);
  const real = fs.realpathSync(existing);
  const realBase = fs.realpathSync(base);
  assert.ok(real === realBase || real.startsWith(`${realBase}${path.sep}`), 'stored path follows a symlink outside its root');
  return file;
}

function readRegistry(repoRoot, slug) {
  const file = path.join(repoRoot, 'data', slug, 'council-records/index.json');
  if (!fs.existsSync(file)) return { schema_version: 'council-record-body-registry.v1', municipality_id: slug, records: [] };
  const registry = readJson(file);
  assert.equal(registry.schema_version, 'council-record-body-registry.v1');
  assert.equal(registry.municipality_id, slug);
  assert.ok(Array.isArray(registry.records));
  const ids = new Set();
  for (const entry of registry.records) {
    identifiers(slug, entry.council_id);
    assert.ok(!ids.has(String(entry.council_id)), 'duplicate managed meeting');
    ids.add(String(entry.council_id));
    assert.ok(['active', 'rolled_back'].includes(entry.state));
    assert.match(entry.minutes_sha256, /^[a-f0-9]{64}$/u);
    assert.match(entry.publication_sha256, /^[a-f0-9]{64}$/u);
    assert.ok(entry.release_path.startsWith(`council-records/${entry.council_id}/releases/`));
    confined(path.join(repoRoot, 'data', slug), entry.release_path);
  }
  return registry;
}

function replaceAtomically(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file) && read(file).equals(bytes)) return;
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(temp, bytes, { flag: 'wx' }); fs.renameSync(temp, file); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}

function exactIndexEntry(index, councilId) {
  assert.ok(Array.isArray(index), 'minutes index must be an array');
  const entries = index.filter((entry) => String(entry.council_id) === String(councilId));
  assert.equal(entries.length, 1, 'meeting must be published exactly once');
  return entries[0];
}

export function prepareCouncilRecordV2BodyRelease({ repoRoot, recordPath, manifestPath, approval, captureVerification, generatedAt = new Date().toISOString() }) {
  const originalRecordBytes = read(recordPath);
  const originalManifestBytes = read(manifestPath);
  const originalRecord = JSON.parse(originalRecordBytes);
  const originalBundle = loadDnpSnapshotBundle(manifestPath, repoRoot);
  const slug = originalRecord.municipality_id;
  const councilId = originalRecord.meeting.legacy_ids.council_id;
  identifiers(slug, councilId);
  assert.notEqual(readRegistry(repoRoot, slug).records.find((item) => String(item.council_id) === String(councilId))?.state,
    'active', 'meeting already has an active body release; verify or roll back before replacing it');
  assert.equal(captureVerification?.manifest_sha256, sha256(originalManifestBytes), 'explicit capture verification must identify the original manifest');
  const checkedTime = Date.parse(captureVerification.checked_at);
  const observedTimes = originalBundle.captures.map((capture) => Date.parse(capture.observed_at));
  assert.ok(Number.isFinite(checkedTime) && checkedTime <= Date.parse(generatedAt), 'invalid capture verification time');
  assert.ok(Date.parse(generatedAt) - checkedTime <= 24 * 60 * 60 * 1000, 'capture verification is older than 24 hours; recapture before publication');
  assert.ok(originalBundle.captures.every((capture) => Date.parse(capture.fetched_at) <= checkedTime), 'verification predates capture');
  assert.ok(checkedTime - Math.min(...observedTimes) <= 24 * 60 * 60 * 1000, 'capture is older than 24 hours; recapture official sources before publication');
  const cityRoot = path.join(repoRoot, 'data', slug);
  const baselineBytes = read(confined(repoRoot, originalBundle.manifest.legacy_input.path));
  const baselinePath = path.join(cityRoot, 'minutes', `${councilId}.json`);
  assert.ok(read(baselinePath).equals(baselineBytes), 'capture baseline differs from the current source projection');
  const sourceIndexPath = path.join(cityRoot, 'minutes/index.json');
  const sourceIndexBytes = read(sourceIndexPath);
  const siteIndexBytes = read(path.join(repoRoot, 'site/data', slug, 'minutes/index.json'));
  const oldIndexItem = exactIndexEntry(JSON.parse(sourceIndexBytes), councilId);
  assert.deepEqual(exactIndexEntry(JSON.parse(siteIndexBytes), councilId), oldIndexItem, 'source and published meeting entry differ');
  assert.ok(read(path.join(repoRoot, 'site/data', slug, 'minutes', `${councilId}.json`)).equals(baselineBytes), 'source and published body differ');
  const projected = projectCouncilRecordV2ToMinutes(originalRecord, { municipality: originalBundle.municipality, generatedAt });
  const publicationPath = `publications/minutes/${councilId}.json`;
  const nextIndex = JSON.parse(sourceIndexBytes);
  Object.assign(exactIndexEntry(nextIndex, councilId), {
    content_sha256: sha256(JSON.stringify(projected.minutes)),
    body_source: { format: 'council-record.v2', publication_path: publicationPath },
  });
  const indexBytes = jsonBytes(nextIndex);
  const runId = `${generatedAt.replace(/[:.]/gu, '-')}-${sha256(originalManifestBytes).slice(0, 12)}`;
  const releaseRelative = `council-records/${councilId}/releases/${runId}`;
  const releaseRoot = confined(cityRoot, releaseRelative);
  const record = structuredClone(originalRecord);
  const manifest = structuredClone(originalBundle.manifest);
  const files = new Map();
  const relativeToRepo = (file) => path.relative(repoRoot, file).split(path.sep).join('/');
  manifest.legacy_input.path = relativeToRepo(path.join(releaseRoot, 'baseline.json'));
  for (const capture of manifest.captures) {
    const oldPath = capture.snapshot_path;
    const destination = path.join(cityRoot, 'council-records', String(councilId), 'snapshots', `${capture.content_sha256}.json`);
    const bytes = read(confined(repoRoot, oldPath));
    assert.equal(sha256(bytes), capture.content_sha256);
    capture.snapshot_path = relativeToRepo(destination);
    files.set(destination, bytes);
    for (const source of record.source_artifacts) for (const revision of source.revisions) {
      if (revision.snapshot_path === oldPath) revision.snapshot_path = capture.snapshot_path;
    }
  }
  const recordBytes = jsonBytes(record);
  const manifestBytes = jsonBytes(manifest);
  const bundle = { ...originalBundle, manifest, captures: manifest.captures.map((capture, i) => ({ ...capture, bytes: originalBundle.captures[i].bytes })) };
  const freshness = { method: 'new_capture_verified', manifest_sha256: sha256(manifestBytes), checked_at: captureVerification.checked_at };
  const result = createCouncilRecordV2BodyPublication({ record, bundle, recordBytes, manifestBytes, baselineBytes, indexBytes, approval, freshness, generatedAt });
  const publicationBytes = jsonBytes(result.publication);
  const oldPointer = path.join(cityRoot, publicationPath);
  const storage = {
    schema_version: 'council-record-body-storage.v1', municipality_id: slug, council_id: councilId,
    stored_at: generatedAt, implementation_hashes: implementationHashes(),
    original_record_sha256: sha256(originalRecordBytes), original_manifest_sha256: sha256(originalManifestBytes),
    capture_verification: captureVerification,
    previous_pointer_present: fs.existsSync(oldPointer),
    files: {},
  };
  const releaseFiles = { 'record.json': recordBytes, 'capture-manifest.json': manifestBytes, 'baseline.json': baselineBytes,
    'published-index.json': indexBytes, 'previous-index.json': sourceIndexBytes,
    'minutes.json': result.minutesBytes, 'publication.json': publicationBytes,
    'capture-origin.json': originalManifestBytes, 'record-origin.json': originalRecordBytes,
    'previous-pointer.json': fs.existsSync(oldPointer) ? read(oldPointer) : jsonBytes(null) };
  for (const [name, bytes] of Object.entries(releaseFiles)) {
    storage.files[name] = sha256(bytes); files.set(path.join(releaseRoot, name), bytes);
  }
  files.set(path.join(releaseRoot, 'storage-manifest.json'), jsonBytes(storage));
  const entry = { council_id: councilId, state: 'active', release_path: releaseRelative,
    minutes_sha256: sha256(result.minutesBytes), publication_sha256: sha256(publicationBytes) };
  const pointer = { schema_version: 'minutes-body-source.v1', municipality_id: slug, council_id: councilId,
    scope: 'body_only', canonical_record_path: `data/${slug}/${releaseRelative}/record.json`,
    publication_path: `data/${slug}/${releaseRelative}/publication.json`,
    storage_manifest_path: `data/${slug}/${releaseRelative}/storage-manifest.json`,
    record_sha256: sha256(recordBytes), manifest_sha256: sha256(manifestBytes),
    publication_sha256: entry.publication_sha256, minutes_sha256: entry.minutes_sha256,
    content_sha256: sha256(JSON.stringify(result.minutes)), generated_at: generatedAt };
  return { repoRoot, slug, councilId, files, entry, pointer, baselinePath, sourceIndexPath, sourceIndexBytes,
    baselineBytes, indexBytes, publicationPath, oldPointerBytes: fs.existsSync(oldPointer) ? read(oldPointer) : null,
    minutesBytes: result.minutesBytes, record };
}

export function activateCouncilRecordV2BodyRelease(plan) {
  const { repoRoot, slug, councilId } = plan;
  const registry = readRegistry(repoRoot, slug);
  assert.ok(read(plan.baselinePath).equals(plan.baselineBytes), 'body changed after release preparation');
  assert.ok(read(plan.sourceIndexPath).equals(plan.sourceIndexBytes), 'index changed after release preparation');
  for (const [file, bytes] of plan.files) writeImmutable(file, bytes);
  const cityRoot = path.join(repoRoot, 'data', slug);
  const pointerPath = path.join(cityRoot, plan.publicationPath);
  const oldEntry = registry.records.find((entry) => String(entry.council_id) === String(councilId));
  assert.notEqual(oldEntry?.state, 'active', 'another active release appeared after preparation');
  const nextRegistry = { ...registry, records: [...registry.records.filter((entry) => String(entry.council_id) !== String(councilId)), plan.entry] };
  try {
    replaceAtomically(plan.baselinePath, plan.minutesBytes);
    replaceAtomically(plan.sourceIndexPath, plan.indexBytes);
    replaceAtomically(pointerPath, jsonBytes(plan.pointer));
    replaceAtomically(path.join(cityRoot, 'council-records/index.json'), jsonBytes(nextRegistry));
    return verifyCouncilRecordV2BodyRelease(repoRoot, slug, councilId);
  } catch (error) {
    replaceAtomically(plan.baselinePath, plan.baselineBytes);
    replaceAtomically(plan.sourceIndexPath, plan.sourceIndexBytes);
    if (plan.oldPointerBytes) replaceAtomically(pointerPath, plan.oldPointerBytes);
    else if (fs.existsSync(pointerPath)) fs.unlinkSync(pointerPath);
    replaceAtomically(path.join(cityRoot, 'council-records/index.json'), jsonBytes(registry));
    throw error;
  }
}

export function verifyCouncilRecordV2BodyRelease(repoRoot, slug, councilId) {
  identifiers(slug, councilId);
  const registry = readRegistry(repoRoot, slug);
  const entry = registry.records.find((item) => String(item.council_id) === String(councilId));
  assert.equal(entry?.state, 'active', 'meeting is not an active canonical body publication');
  const cityRoot = path.join(repoRoot, 'data', slug);
  const releaseRoot = confined(cityRoot, entry.release_path);
  const storage = readJson(path.join(releaseRoot, 'storage-manifest.json'));
  assert.equal(storage.schema_version, 'council-record-body-storage.v1');
  assert.equal(storage.municipality_id, slug); assert.equal(String(storage.council_id), String(councilId));
  assert.deepEqual(storage.implementation_hashes, implementationHashes(), 'body publication implementation changed; revalidation required');
  const requiredFiles = ['record.json', 'capture-manifest.json', 'baseline.json', 'published-index.json', 'previous-index.json',
    'minutes.json', 'publication.json', 'capture-origin.json', 'record-origin.json', 'previous-pointer.json'];
  assert.deepEqual(Object.keys(storage.files).sort(), requiredFiles.sort(), 'stored release file inventory differs');
  for (const [name, digest] of Object.entries(storage.files)) assert.equal(sha256(read(confined(releaseRoot, name))), digest, `stored ${name} changed`);
  assert.equal(storage.original_record_sha256, storage.files['record-origin.json']);
  assert.equal(storage.original_manifest_sha256, storage.files['capture-origin.json']);
  assert.equal(storage.capture_verification?.manifest_sha256, storage.original_manifest_sha256);
  const recordBytes = read(path.join(releaseRoot, 'record.json'));
  const manifestBytes = read(path.join(releaseRoot, 'capture-manifest.json'));
  const record = JSON.parse(recordBytes);
  const storedManifest = JSON.parse(manifestBytes);
  assert.equal(storedManifest.legacy_input.path, `data/${slug}/${entry.release_path}/baseline.json`);
  for (const capture of storedManifest.captures) {
    assert.equal(capture.snapshot_path, `data/${slug}/council-records/${councilId}/snapshots/${capture.content_sha256}.json`);
    confined(repoRoot, capture.snapshot_path);
  }
  const bundle = loadDnpSnapshotBundle(path.join(releaseRoot, 'capture-manifest.json'), repoRoot);
  const baselineBytes = read(path.join(releaseRoot, 'baseline.json'));
  const indexBytes = read(path.join(releaseRoot, 'published-index.json'));
  const minutesBytes = read(path.join(releaseRoot, 'minutes.json'));
  const publicationBytes = read(path.join(releaseRoot, 'publication.json'));
  const publication = JSON.parse(publicationBytes);
  assert.equal(storage.capture_verification.checked_at, publication.freshness.checked_at);
  verifyCouncilRecordV2BodyPublication({ record, bundle, recordBytes, manifestBytes, baselineBytes, indexBytes,
    approval: publication.approval, freshness: publication.freshness, generatedAt: publication.generated_at, publication, minutesBytes });
  assert.equal(sha256(minutesBytes), entry.minutes_sha256);
  assert.equal(sha256(publicationBytes), entry.publication_sha256);
  assert.ok(read(path.join(cityRoot, 'minutes', `${councilId}.json`)).equals(minutesBytes), 'managed projection changed');
  const frozenItem = exactIndexEntry(JSON.parse(indexBytes), councilId);
  assert.deepEqual(exactIndexEntry(readJson(path.join(cityRoot, 'minutes/index.json')), councilId), frozenItem, 'managed publication index changed');
  const pointer = readJson(path.join(cityRoot, 'publications/minutes', `${councilId}.json`));
  assert.equal(pointer.schema_version, 'minutes-body-source.v1');
  assert.equal(pointer.municipality_id, slug); assert.equal(String(pointer.council_id), String(councilId));
  assert.equal(pointer.scope, 'body_only');
  assert.equal(pointer.canonical_record_path, `data/${slug}/${entry.release_path}/record.json`);
  assert.equal(pointer.publication_path, `data/${slug}/${entry.release_path}/publication.json`);
  assert.equal(pointer.storage_manifest_path, `data/${slug}/${entry.release_path}/storage-manifest.json`);
  assert.equal(pointer.record_sha256, sha256(recordBytes)); assert.equal(pointer.manifest_sha256, sha256(manifestBytes));
  assert.equal(pointer.minutes_sha256, entry.minutes_sha256); assert.equal(pointer.publication_sha256, entry.publication_sha256);
  assert.equal(pointer.content_sha256, frozenItem.content_sha256); assert.equal(pointer.generated_at, publication.generated_at);
  return { status: 'verified', municipality_id: slug, council_id: Number(councilId), scope: 'body_only',
    minutes_sha256: entry.minutes_sha256, release_path: entry.release_path, original_records: record.turns.length + record.document_items.length };
}

export function rollbackCouncilRecordV2BodyRelease(repoRoot, slug, councilId, { apply = false, rolledBackAt = new Date().toISOString() } = {}) {
  identifiers(slug, councilId);
  const registry = readRegistry(repoRoot, slug);
  const entry = registry.records.find((item) => String(item.council_id) === String(councilId));
  assert.equal(entry?.state, 'active', 'only an active release can be rolled back');
  const cityRoot = path.join(repoRoot, 'data', slug);
  const releaseRoot = confined(cityRoot, entry.release_path);
  const storage = readJson(path.join(releaseRoot, 'storage-manifest.json'));
  assert.equal(storage.schema_version, 'council-record-body-storage.v1');
  assert.equal(storage.municipality_id, slug); assert.equal(String(storage.council_id), String(councilId));
  for (const name of ['baseline.json', 'previous-index.json', 'previous-pointer.json', 'publication.json']) {
    assert.match(storage.files?.[name] ?? '', /^[a-f0-9]{64}$/u);
    assert.equal(sha256(read(confined(releaseRoot, name))), storage.files[name], `rollback archive ${name} changed`);
  }
  assert.equal(storage.files['publication.json'], entry.publication_sha256);
  const baselineBytes = read(path.join(releaseRoot, 'baseline.json'));
  const publication = readJson(path.join(releaseRoot, 'publication.json'));
  assert.equal(sha256(baselineBytes), publication.inputs.baseline_sha256);
  assert.equal(String(JSON.parse(baselineBytes).council_id), String(councilId));
  const oldItem = exactIndexEntry(readJson(path.join(releaseRoot, 'previous-index.json')), councilId);
  const indexPath = path.join(cityRoot, 'minutes/index.json');
  const oldIndexBytes = read(indexPath);
  const currentIndex = JSON.parse(oldIndexBytes);
  assert.ok(Array.isArray(currentIndex), 'current index must remain an array to preserve other meetings');
  const position = currentIndex.findIndex((item) => String(item.council_id) === String(councilId));
  const nextIndex = currentIndex.filter((item) => String(item.council_id) !== String(councilId));
  nextIndex.splice(position < 0 ? 0 : Math.min(position, nextIndex.length), 0, oldItem);
  const pointerPath = path.join(cityRoot, 'publications/minutes', `${councilId}.json`);
  const bodyPath = path.join(cityRoot, 'minutes', `${councilId}.json`);
  const registryPath = path.join(cityRoot, 'council-records/index.json');
  if (apply) {
    const previous = new Map([bodyPath, indexPath, pointerPath, registryPath].map((file) => [file, fs.existsSync(file) ? read(file) : null]));
    try {
      replaceAtomically(bodyPath, baselineBytes);
      replaceAtomically(indexPath, jsonBytes(nextIndex));
      if (storage.previous_pointer_present) replaceAtomically(pointerPath, read(path.join(releaseRoot, 'previous-pointer.json')));
      else replaceAtomically(pointerPath, jsonBytes({ schema_version: 'minutes-body-source.v1', municipality_id: slug,
        council_id: Number(councilId), scope: 'legacy_body', state: 'rolled_back', minutes_sha256: sha256(baselineBytes), rolled_back_at: rolledBackAt }));
      entry.state = 'rolled_back'; entry.rolled_back_at = rolledBackAt;
      replaceAtomically(registryPath, jsonBytes(registry));
    } catch (error) {
      for (const [file, bytes] of previous) {
        if (bytes) replaceAtomically(file, bytes);
        else if (fs.existsSync(file)) fs.unlinkSync(file);
      }
      throw error;
    }
  }
  return { status: apply ? 'rolled_back' : 'rollback_planned', municipality_id: slug, council_id: Number(councilId),
    minutes_sha256: sha256(baselineBytes), sync_required: apply };
}
