import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PYTHON_HELPER = fileURLToPath(new URL('../capture-gijiroku-council-v2.py', import.meta.url));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const roles = { ACT100: 'list', ACT200: 'frameset', ACT203: 'body' };

export function deriveGijirokuRevisionContent(bytes, { act }) {
  assert.ok(Object.hasOwn(roles, act), 'Unsupported gijiroku act');
  const payload = { captures: [{ role: roles[act], bytes_base64: Buffer.from(bytes).toString('base64') }] };
  const response = JSON.parse(execFileSync('python3', [PYTHON_HELPER, '--parse-stdin'], {
    input: JSON.stringify(payload), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  }));
  assert.equal(response.results.length, 1);
  return { bytes, ...response.results[0] };
}

function localPath(repoRoot, relativePath) {
  assert.equal(typeof relativePath, 'string');
  const result = path.resolve(repoRoot, relativePath);
  assert.ok(result.startsWith(`${path.resolve(repoRoot)}${path.sep}`), 'Input path escapes repository');
  assert.ok(fs.realpathSync(result).startsWith(`${fs.realpathSync(repoRoot)}${path.sep}`), 'Input symlink escapes repository');
  return result;
}

export function loadGijirokuSnapshotBundle(manifestPath, repoRoot = ROOT) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.format, 'gijiroku-capture-manifest/1');
  assert.equal(manifest.status, 'complete', 'Capture is incomplete or failed');
  const municipality = JSON.parse(fs.readFileSync(path.join(repoRoot, 'data/municipalities.json'), 'utf8'))
    .find((item) => item.slug === manifest.municipality_id);
  assert.equal(municipality?.system, 'gijiroku_com');
  assert.notEqual(municipality.minutes_access, 'restricted');
  const legacyBytes = fs.readFileSync(localPath(repoRoot, manifest.legacy_input.path));
  assert.equal(digest(legacyBytes), manifest.legacy_input.sha256, 'Legacy input changed since capture');
  const legacyCouncil = JSON.parse(legacyBytes);
  assert.equal(legacyCouncil.council_id, manifest.council_id);
  const publicIndexBytes = fs.readFileSync(localPath(repoRoot, manifest.publication_index.path));
  assert.equal(digest(publicIndexBytes), manifest.publication_index.sha256, 'Publication index changed since capture');
  const publicIndex = JSON.parse(publicIndexBytes);
  assert.equal(publicIndex.filter((item) => item.council_id === manifest.council_id).length, 1, 'Council is not in public index');
  const parserPath = localPath(repoRoot, manifest.parser.source_path);
  assert.equal(path.resolve(parserPath), path.join(path.resolve(repoRoot), 'scraper/scrape_minutes_gijiroku.py'));
  assert.equal(digest(fs.readFileSync(parserPath)), manifest.parser.source_sha256, 'Captured parser changed; revalidation must be explicit');
  const base = `https://${municipality.gijiroku_subdomain || municipality.slug}.gijiroku.com/voices/cgi/voiweb.exe`;
  const captures = manifest.captures.map((capture) => {
    const bytes = fs.readFileSync(localPath(repoRoot, capture.snapshot_path));
    assert.equal(digest(bytes), capture.content_sha256, 'Snapshot content hash mismatch');
    assert.equal(bytes.length, capture.byte_size, 'Snapshot size mismatch');
    assert.equal(capture.encoding, 'shift_jis');
    assert.equal(capture.request.method, 'GET');
    const url = new URL(capture.request.url);
    assert.equal(`${url.origin}${url.pathname}`, base, 'Unexpected provider source URL');
    const act = `ACT${url.searchParams.get('ACT')}`;
    assert.equal(roles[act], capture.role, 'URL action and capture role differ');
    assert.equal(url.searchParams.get('FYY'), String(legacyCouncil.year));
    assert.equal(url.searchParams.get('TYY'), String(legacyCouncil.year));
    assert.equal(capture.external_ids.kgno, manifest.council_id);
    assert.ok(capture.http_status >= 200 && capture.http_status < 300, 'HTTP retrieval failed');
    assert.ok(Number.isFinite(Date.parse(capture.fetched_at)) && Number.isFinite(Date.parse(capture.observed_at)), 'Capture time is missing');
    return { ...capture, bytes, act, content: deriveGijirokuRevisionContent(bytes, { act }) };
  });
  const lists = captures.filter((capture) => capture.act === 'ACT100');
  assert.equal(lists.length, 1, 'Exactly one inventory capture is required');
  const inventory = lists[0].content.meetings.filter((meeting) => meeting.kgno === manifest.council_id);
  assert.equal(inventory.length, legacyCouncil.schedules.length, 'Provider document inventory differs');
  assert.equal(manifest.schedule_sources.length, legacyCouncil.schedules.length);
  assert.equal(captures.length, 1 + legacyCouncil.schedules.length * 2);
  const usedFinos = new Set();
  const documents = legacyCouncil.schedules.map((schedule) => {
    const mappings = manifest.schedule_sources.filter((item) => item.legacy_schedule_id === schedule.schedule_id);
    assert.equal(mappings.length, 1, 'Legacy schedule mapping must be unique');
    const mapping = mappings[0];
    assert.equal(mapping.kgno, manifest.council_id);
    assert.ok(!usedFinos.has(mapping.fino), 'FINO is mapped twice'); usedFinos.add(mapping.fino);
    const matching = inventory.filter((item) => item.fino === mapping.fino);
    assert.equal(matching.length, 1, 'FINO must be present exactly once in captured inventory');
    assert.equal(matching[0].schedule_name, schedule.name, 'Source document label differs from legacy');
    assert.equal(matching[0].unid, mapping.unid);
    if (Object.hasOwn(schedule, 'source_fino')) assert.equal(schedule.source_fino, mapping.fino);
    assert.equal(mapping.list_sha256, lists[0].content_sha256);
    const frame = captures.find((c) => c.act === 'ACT200' && c.content_sha256 === mapping.frameset_sha256 && c.external_ids.fino === mapping.fino);
    const body = captures.find((c) => c.act === 'ACT203' && c.content_sha256 === mapping.body_sha256 && c.external_ids.fino === mapping.fino);
    assert.ok(frame && body, 'Mapped source capture is missing');
    assert.equal(frame.content.huid, mapping.huid);
    for (const capture of [frame, body]) {
      const query = new URL(capture.request.url).searchParams;
      assert.equal(query.get('FINO'), String(mapping.fino));
      assert.equal(capture.external_ids.unid, mapping.unid);
      if (capture.act === 'ACT200') { assert.equal(query.get('KGNO'), String(mapping.kgno)); assert.equal(query.get('UNID'), mapping.unid); }
      else { assert.equal(query.get('HUID'), mapping.huid); assert.equal(capture.external_ids.huid, mapping.huid); }
    }
    assert.equal(schedule.minutes.length, 1, 'Expected one whole document per legacy schedule');
    assert.equal(schedule.minutes[0].minute_type, '本会議');
    assert.equal(body.content.text, schedule.minutes[0].text, 'Captured original text differs from legacy');
    return { schedule, mapping, body, frame };
  });
  const revisionContents = new Map(captures.map((capture) => [gijirokuRevisionId(municipality.slug, manifest.council_id, capture), capture.content]));
  return { manifest, municipality, legacyCouncil, captures, documents, revisionContents };
}

export function gijirokuSourceId(slug, councilId, capture) {
  return `${slug}:source:gijiroku:${councilId}:${capture.act}:${capture.external_ids.fino ?? 'inventory'}`;
}

export function gijirokuRevisionId(slug, councilId, capture) {
  return `${gijirokuSourceId(slug, councilId, capture)}:revision:${capture.content_sha256}`;
}
