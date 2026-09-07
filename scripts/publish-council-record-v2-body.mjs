#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { prepareCouncilRecordV2BodyRelease, activateCouncilRecordV2BodyRelease,
  verifyCouncilRecordV2BodyRelease, rollbackCouncilRecordV2BodyRelease } from './lib/council-record-v2-body-storage.mjs';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({ options: { record: { type: 'string' }, manifest: { type: 'string' }, slug: { type: 'string' },
  council: { type: 'string' }, 'approval-ref': { type: 'string' }, 'approved-by': { type: 'string' },
  'capture-sha256': { type: 'string' }, 'capture-verified-at': { type: 'string' },
  'approved-at': { type: 'string' }, apply: { type: 'boolean' }, verify: { type: 'boolean' }, rollback: { type: 'boolean' }, help: { type: 'boolean' } } });
if (values.help) {
  console.log('Publish existing DNP body: --record <record> --manifest <manifest> --approval-ref <reference> --approved-by <actor> --approved-at <ISO time> --capture-sha256 <manifest hash> --capture-verified-at <ISO time> [--apply]\nVerify: --slug <slug> --council <id> --verify\nRollback this body: --slug <slug> --council <id> --rollback [--apply]\nWithout --apply, no files are written. Run sync-site-data --slug <slug> --build-capabilities --verify after applying.');
} else try {
  let result;
  if (values.verify || values.rollback) {
    if (!values.slug || !values.council || values.record || values.manifest || (values.verify && values.rollback)) throw new Error('Use --slug/--council with either --verify or --rollback');
    result = values.verify ? verifyCouncilRecordV2BodyRelease(repoRoot, values.slug, Number(values.council))
      : rollbackCouncilRecordV2BodyRelease(repoRoot, values.slug, Number(values.council), { apply: values.apply });
  } else {
    if (!values.record || !values.manifest || !values['approval-ref'] || !values['approved-by'] || !values['approved-at']
      || !values['capture-sha256'] || !values['capture-verified-at']) throw new Error('record, manifest, explicit capture verification hash/time and body publication approval reference/actor/time are required');
    const plan = prepareCouncilRecordV2BodyRelease({ repoRoot, recordPath: path.resolve(values.record), manifestPath: path.resolve(values.manifest),
      captureVerification: { manifest_sha256: values['capture-sha256'], checked_at: values['capture-verified-at'] },
      approval: { scope: 'body_only', approval_ref: values['approval-ref'], approved_by: values['approved-by'], approved_at: values['approved-at'] } });
    result = values.apply ? { ...activateCouncilRecordV2BodyRelease(plan), sync_required: true }
      : { status: 'planned', municipality_id: plan.slug, council_id: plan.councilId, scope: 'body_only',
        minutes_sha256: plan.entry.minutes_sha256, release_path: plan.entry.release_path, immutable_files: plan.files.size,
        body_bytes_unchanged: plan.minutesBytes.equals(plan.baselineBytes) };
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
