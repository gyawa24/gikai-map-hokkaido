import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DNP_API_BASE = 'https://ssp.kaigiroku.net/dnp/search';
export const GENERATOR_VERSION = '1.0.0';
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// Match the existing Python scraper's splitlines/rstrip/strip; do not decode entities.
export function cleanDnpText(body) {
  if (typeof body !== 'string') throw new Error('DNP minute body must be a string');
  const whitespace = '[\\u0009-\\u000d\\u001c-\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
  return body.replace(/<[^>]+>/g, '').split(/\r\n|[\n\r\v\f\u001c-\u001e\u0085\u2028\u2029]/)
    .map((line) => line.replace(new RegExp(`${whitespace}+$`, 'u'), ''))
    .filter((line, index, lines) => line !== '' || index === 0 || lines[index - 1] !== '')
    .join('\n').replace(new RegExp(`^${whitespace}+|${whitespace}+$`, 'gu'), '');
}

export function dnpRevisionContent(bytes) {
  const json = JSON.parse(Buffer.from(bytes).toString('utf8'));
  const minutes = json.tenant_minutes;
  if (!Array.isArray(minutes)) return { bytes, text: null, providerMinuteIds: [], providerMinutes: {} };
  const providerMinutes = {};
  for (const minute of minutes) {
    const id = providerId(minute.minute_id, 'minute_id');
    if (Object.hasOwn(providerMinutes, id)) throw new Error(`Duplicate provider minute_id ${id}`);
    providerMinutes[id] = cleanDnpText(minute.body);
  }
  return { bytes, text: JSON.stringify(minutes.map((minute) => providerMinutes[String(minute.minute_id)])),
    providerMinuteIds: minutes.map((minute) => String(minute.minute_id)), providerMinutes };
}

function providerId(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${label}: ${value}`);
  return String(value);
}

export function assertDnpMunicipality(municipality) {
  if (!municipality || municipality.system !== 'dnp' || !/^[a-z0-9][a-z0-9_-]*$/.test(municipality.slug)) {
    throw new Error('A registered DNP municipality is required');
  }
  providerId(municipality.tenant_id, 'tenant_id');
}

export function writeImmutable(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try { fs.writeFileSync(file, bytes, { flag: 'wx' }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (!fs.readFileSync(file).equals(Buffer.from(bytes))) throw new Error(`Immutable snapshot differs: ${file}`);
  }
}

export async function captureDnpResponse({ endpoint, payload, snapshotDir, repoRoot, fetchImpl = fetch }) {
  if (!['minutes/get_schedule', 'minutes/get_minute'].includes(endpoint)) throw new Error('Unsupported DNP endpoint');
  const url = `${DNP_API_BASE}/${endpoint}`;
  const observedAt = new Date().toISOString();
  const response = await fetchImpl(url, { method: 'POST', redirect: 'error',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; gikai-map-hokkaido/1.0)' },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(30000) });
  const bytes = Buffer.from(await response.arrayBuffer());
  const fetchedAt = new Date().toISOString();
  const hash = sha256(bytes);
  const snapshot = path.join(snapshotDir, `${hash}.json`);
  // Retain HTTP failures as evidence too; they never become a successful source revision.
  writeImmutable(snapshot, bytes);
  const capture = { endpoint, request: { method: 'POST', url, payload }, observed_at: observedAt,
    fetched_at: fetchedAt, http_status: response.status, content_sha256: hash,
    byte_size: bytes.length, mime_type: response.headers.get('content-type') || 'application/json',
    etag: response.headers.get('etag'), last_modified: response.headers.get('last-modified'),
    snapshot_path: path.relative(repoRoot, snapshot).split(path.sep).join('/') };
  if (!response.ok) {
    const error = new Error(`DNP HTTP ${response.status}: ${endpoint}`);
    error.capture = capture;
    throw error;
  }
  try { JSON.parse(bytes.toString('utf8')); }
  catch (cause) {
    const error = new Error(`Invalid JSON from DNP: ${endpoint}`, { cause });
    error.capture = capture;
    throw error;
  }
  return { ...capture, bytes };
}

export function readCapture(capture, repoRoot) {
  const base = path.resolve(repoRoot);
  const file = path.resolve(base, capture.snapshot_path);
  if (!file.startsWith(`${base}${path.sep}`)) throw new Error('Snapshot path escapes repository');
  const bytes = fs.readFileSync(file);
  if (sha256(bytes) !== capture.content_sha256 || bytes.length !== capture.byte_size) throw new Error(`Snapshot hash/size mismatch: ${capture.snapshot_path}`);
  return { ...capture, bytes };
}

export function loadDnpSnapshotBundle(manifestPath, repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.format !== 'dnp-capture-manifest/1') throw new Error('Unsupported capture manifest format');
  const legacyPath = path.resolve(repoRoot, manifest.legacy_input.path);
  if (!legacyPath.startsWith(`${path.resolve(repoRoot)}${path.sep}`)) throw new Error('Legacy path escapes repository');
  const legacyBytes = fs.readFileSync(legacyPath);
  if (sha256(legacyBytes) !== manifest.legacy_input.sha256) throw new Error('Legacy input changed since capture');
  const municipality = JSON.parse(fs.readFileSync(path.join(repoRoot, 'data/municipalities.json'), 'utf8')).find((m) => m.slug === manifest.municipality_id);
  const legacyCouncil = JSON.parse(legacyBytes);
  if (manifest.council_id !== legacyCouncil.council_id) throw new Error('Capture manifest council differs from legacy input');
  const captures = manifest.captures.map((capture) => readCapture(capture, repoRoot));
  verifyDnpLegacyParity({ municipality, legacyCouncil, captures });
  const revisionContents = new Map(captures.map((capture) => {
    const sid = capture.request.payload.schedule_id;
    const source = `${municipality.slug}:source:dnp:${legacyCouncil.council_id}:${sid === undefined ? 'schedules' : sid}`;
    return [`${source}:revision:${capture.content_sha256}`, dnpRevisionContent(capture.bytes)];
  }));
  return { manifest, municipality, legacyCouncil, captures, revisionContents };
}

export function verifyDnpLegacyParity({ municipality, legacyCouncil, captures }) {
  assertDnpMunicipality(municipality);
  const councilId = providerId(legacyCouncil.council_id, 'council_id');
  if (!Array.isArray(legacyCouncil.schedules) || legacyCouncil.schedules.length === 0) throw new Error('Legacy schedules are empty');
  for (const capture of captures) {
    if (capture.request?.url !== `${DNP_API_BASE}/${capture.endpoint}` || capture.request?.method !== 'POST'
      || capture.request.payload.tenant_id !== municipality.tenant_id || String(capture.request.payload.council_id) !== councilId
      || sha256(capture.bytes) !== capture.content_sha256 || capture.http_status < 200 || capture.http_status >= 300
      || !Number.isFinite(Date.parse(capture.fetched_at)) || !Number.isFinite(Date.parse(capture.observed_at))) {
      throw new Error('Invalid DNP capture provenance');
    }
  }
  const lists = captures.filter((item) => item.endpoint === 'minutes/get_schedule');
  if (lists.length !== 1) throw new Error('Exactly one schedule-list snapshot is required');
  const remoteSchedules = JSON.parse(lists[0].bytes).council_schedules;
  if (!Array.isArray(remoteSchedules) || remoteSchedules.length !== legacyCouncil.schedules.length) throw new Error('Schedule list differs from legacy minutes');
  const seenSchedules = new Set();
  for (const [index, schedule] of legacyCouncil.schedules.entries()) {
    const sid = providerId(schedule.schedule_id, 'schedule_id');
    if (seenSchedules.has(sid)) throw new Error(`Duplicate legacy schedule ${sid}`);
    seenSchedules.add(sid);
    const remote = remoteSchedules[index];
    if (String(remote.schedule_id) !== sid || remote.name !== schedule.name || (remote.page_no ?? null) !== (schedule.page_no ?? null)) throw new Error(`Schedule ${sid} metadata/order differs`);
    const matches = captures.filter((item) => item.endpoint === 'minutes/get_minute' && String(item.request.payload.schedule_id) === sid);
    if (matches.length !== 1) throw new Error(`Exactly one minute snapshot required for schedule ${sid}`);
    const minutes = JSON.parse(matches[0].bytes).tenant_minutes;
    if (!Array.isArray(minutes) || !Array.isArray(schedule.minutes) || minutes.length !== schedule.minutes.length) throw new Error(`Schedule ${sid} minute count differs`);
    dnpRevisionContent(matches[0].bytes);
    for (const [position, minute] of schedule.minutes.entries()) {
      const actual = minutes[position];
      if (String(actual.minute_id) !== providerId(minute.minute_id, 'minute_id') || actual.title !== minute.title
        || actual.minute_type !== minute.minute_type || cleanDnpText(actual.body) !== minute.text) {
        throw new Error(`Legacy/source mismatch at schedule ${sid}, minute ${minute.minute_id}`);
      }
    }
  }
  if (captures.length !== legacyCouncil.schedules.length + 1) throw new Error('Unexpected extra captures');
  return true;
}

export function buildDnpCouncilRecordV2({ municipality, legacyCouncil, captures, generatedAt, codeRevision, pipelineRunId }) {
  verifyDnpLegacyParity({ municipality, legacyCouncil, captures });
  const slug = municipality.slug;
  const cid = legacyCouncil.council_id;
  const meetingId = `${slug}:meeting:dnp:${cid}`;
  const extraction = () => ({ method: 'rule_based', confidence: 1, extractor_name: 'dnp-council-record-v2',
    extractor_version: GENERATOR_VERSION, pipeline_run_id: pipelineRunId, warnings: [] });
  const review = () => ({ status: 'auto', reviewed_by: null, reviewed_at: null, notes: ['人物同定・質問区分は未確認。'] });
  const revisionContents = new Map();
  const sourceArtifacts = captures.map((capture) => {
    const sid = capture.request.payload.schedule_id;
    const artifactId = sid === undefined ? `${slug}:source:dnp:${cid}:schedules` : `${slug}:source:dnp:${cid}:${sid}`;
    const revisionId = `${artifactId}:revision:${capture.content_sha256}`;
    const content = dnpRevisionContent(capture.bytes);
    revisionContents.set(revisionId, content);
    return { id: artifactId, municipality_id: slug, authority: 'official', kind: 'api_json', record_status: 'official',
      title: sid === undefined ? legacyCouncil.name : legacyCouncil.schedules.find((s) => s.schedule_id === sid).name,
      landing_url: null, content_url: capture.request.url, current_revision_id: revisionId,
      external_ids: { tenant_id: municipality.tenant_id, council_id: cid, ...(sid === undefined ? {} : { schedule_id: sid }) },
      revisions: [{ id: revisionId, observed_at: capture.observed_at, fetched_at: capture.fetched_at,
        retrieval_status: 'fetched', parse_status: 'parsed', content_sha256: capture.content_sha256,
        extracted_text_sha256: content.text === null ? null : sha256(content.text), snapshot_path: capture.snapshot_path,
        mime_type: capture.mime_type, http_status: capture.http_status, etag: capture.etag,
        last_modified: capture.last_modified, byte_size: capture.byte_size }] };
  });
  const sittings = [];
  const speakers = [];
  const turns = [];
  const documentItems = [];
  for (const [scheduleIndex, schedule] of legacyCouncil.schedules.entries()) {
    const sid = schedule.schedule_id;
    const sittingId = `${slug}:sitting:dnp:${cid}:${sid}`;
    const artifact = sourceArtifacts.find((item) => item.external_ids.schedule_id === sid);
    const dateMatch = schedule.name.match(/^(\d{2})月(\d{2})日/);
    const date = dateMatch ? `${legacyCouncil.year}-${dateMatch[1]}-${dateMatch[2]}` : null;
    if (date && (new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)) throw new Error(`Invalid sitting date ${date}`);
    const legacyPresentation = { name: schedule.name };
    for (const field of ['page_no', 'date', 'source_url']) if (Object.hasOwn(schedule, field)) legacyPresentation[field] = schedule[field];
    sittings.push({ id: sittingId, municipality_id: slug, meeting_id: meetingId, order_index: scheduleIndex + 1,
      title_original: schedule.name, date, date_status: date ? 'exact' : 'unknown',
      ...(date ? {} : { date_note: '日程名から開催日を確認できません。' }),
      source_artifact_ids: [artifact.id], external_ids: { schedule_id: sid },
      legacy_ids: { council_id: cid, schedule_id: sid }, legacy_presentation: legacyPresentation });
    for (const [minuteIndex, minute] of schedule.minutes.entries()) {
      const mid = minute.minute_id;
      const common = { municipality_id: slug, meeting_id: meetingId, sitting_id: sittingId, order_index: minuteIndex + 1,
        text_original: minute.text, source_span: { source_artifact_id: artifact.id, source_revision_id: artifact.current_revision_id,
          provider_minute_id: String(mid) }, extraction: extraction(), review: review(),
        legacy_ids: { council_id: cid, schedule_id: sid, minute_id: mid },
        legacy_presentation: { title: minute.title, minute_type: minute.minute_type,
          ...(Object.hasOwn(minute, 'source_url') ? { source_url: minute.source_url } : {}) } };
      if (minute.minute_type === '名簿' || minute.minute_type === '△議題') {
        documentItems.push({ id: `${slug}:document-item:dnp:${cid}:${sid}:minute:${mid}`, ...common,
          kind: minute.minute_type === '名簿' ? 'roster' : 'agenda', text_status: minute.text ? 'present' : 'empty_in_source',
          empty_reason: minute.text ? null : '公式APIのbodyが空です。' });
      } else {
        if (!minute.title || !minute.text) throw new Error(`Speech minute ${sid}/${mid} has empty title/text`);
        const speakerId = `${slug}:speaker:dnp:${cid}:${sid}:minute:${mid}`;
        const speakerType = minute.minute_type === '○議長' ? 'chair' : 'unknown';
        speakers.push({ id: speakerId, municipality_id: slug, name_original: minute.title, name_normalized: minute.title,
          speaker_type: speakerType, aliases: [], person_id: null, membership_id: null,
          identity_match: { status: 'unresolved', method: 'none', confidence: null, candidate_person_ids: [] } });
        turns.push({ id: `${slug}:turn:dnp:${cid}:${sid}:minute:${mid}`, ...common, speaker_id: speakerId,
          speaker_name_original: minute.title, speaker_type: speakerType,
          turn_type: minute.minute_type === '○議長' ? 'procedure' : 'unknown' });
      }
    }
  }
  const dates = sittings.map((s) => s.date).filter(Boolean).sort();
  const legacyMeeting = {};
  for (const field of ['name', 'year', 'japanese_year', 'type_label', 'source_url']) if (Object.hasOwn(legacyCouncil, field)) legacyMeeting[field] = legacyCouncil[field];
  const record = { schema_version: '2.0', record_id: `${slug}:record:dnp:${cid}`, municipality_id: slug, record_status: 'official',
    meeting: { id: meetingId, municipality_id: slug, title_original: legacyCouncil.name,
      kind: legacyCouncil.name.includes('定例会') ? 'regular' : legacyCouncil.name.includes('臨時会') ? 'extraordinary' : 'unknown',
      year: Number(legacyCouncil.year), sequence: null, start_date: dates[0] || null, end_date: dates.at(-1) || null,
      date_status: dates.length === sittings.length ? 'exact' : dates.length ? 'partial' : 'unknown',
      ...(dates.length === sittings.length ? {} : { date_note: '開催日を確認できない日程があります。' }),
      sitting_ids: sittings.map((s) => s.id), external_ids: { tenant_id: municipality.tenant_id, council_id: cid },
      legacy_ids: { council_id: cid }, legacy_presentation: legacyMeeting },
    sittings, source_artifacts: sourceArtifacts, speakers, turns, document_items: documentItems,
    question_blocks: [], topic_blocks: [], topic_snippets: [], reconciliations: [],
    derivation: { pipeline_run_id: pipelineRunId, generated_at: generatedAt, code_revision: codeRevision,
      generator: { name: 'dnp-council-record-v2', version: GENERATOR_VERSION },
      input_revision_ids: sourceArtifacts.map((s) => s.current_revision_id),
      validation: { status: 'fail', checked_at: generatedAt, validator_version: 'pending', errors: ['Validation has not run'], warnings: [] } },
    publication: { state: 'internal_preview', public_visible: false, checked_at: generatedAt, published_at: null,
      gate_results: [{ gate: 'review', status: 'fail', detail: '内部検証用。公開審査・人物同定・質問抽出は未実施。' }] } };
  return { record, revisionContents };
}
