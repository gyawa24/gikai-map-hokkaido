#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const execute = promisify(execFile);
const { values } = parseArgs({ options: { manifest: { type: 'string' }, help: { type: 'boolean' } } });
if (values.help || !values.manifest) {
  console.log('node scripts/run-council-record-v2-pilot.mjs --manifest <capture-manifest.json>');
  console.log('保存済み原典からv2・画面・検索・質問候補をオフライン生成します。公開データは更新しません。');
  process.exit(values.help ? 0 : 1);
}

const startedAt = new Date().toISOString();
const reportPath = path.join(root, 'reports/council-record-v2-pilot-runs', `${startedAt.replace(/[:.]/g, '-')}-${randomUUID()}.json`);
const report = {
  schema_version: 'council-record-v2-pilot-run.v1',
  mode: 'offline_preview',
  state: 'running',
  started_at: startedAt,
  source_manifest: path.resolve(values.manifest),
  public_visible: false,
  question_comparison_requires_review: true,
  question_identity_status: 'unresolved',
  stages: [],
};

async function runStage(name, script, args) {
  const entry = { name, script, state: 'running', started_at: new Date().toISOString() };
  report.stages.push(entry);
  try {
    entry.implementation_sha256 = createHash('sha256').update(fs.readFileSync(path.join(root, script))).digest('hex');
    const { stdout } = await execute(process.execPath, [script, ...args], { cwd: root, maxBuffer: 32 * 1024 * 1024 });
    entry.result = JSON.parse(stdout);
    if (entry.result.public_visible !== false) throw new Error(`${name}: expected a non-public result`);
    entry.state = 'completed';
    return entry.result;
  } catch (error) {
    entry.state = 'failed';
    entry.error = String(error.stderr || error.message).trim().slice(0, 8000);
    throw new Error(`${name}: ${entry.error}`);
  } finally {
    entry.finished_at = new Date().toISOString();
  }
}

try {
  // --manifest限定で起動し、再検証が公式サイトへの再取得に変わらないようにする。
  const manifestBytes = fs.readFileSync(report.source_manifest);
  report.source_manifest_sha256 = createHash('sha256').update(manifestBytes).digest('hex');
  const format = JSON.parse(manifestBytes).format;
  const builders = {
    'dnp-capture-manifest/1': 'scripts/build-dnp-council-record-v2.mjs',
    'gijiroku-capture-manifest/1': 'scripts/build-gijiroku-council-record-v2.mjs',
  };
  if (!Object.hasOwn(builders, format)) throw new Error(`unsupported capture manifest: ${format}`);
  const record = await runStage('canonical_record', builders[format], ['--manifest', report.source_manifest]);
  const input = ['--record', record.record, '--manifest', record.manifest];
  await runStage('minutes_preview', 'scripts/prepare-council-record-v2-preview.mjs', input);
  await runStage('segments_preview', 'scripts/build-council-record-v2-segments-preview.mjs', input);
  if (format === 'dnp-capture-manifest/1') {
    const questions = await runStage('question_candidates', 'scripts/prepare-council-record-v2-question-candidates.mjs', input);
    report.question_comparison_requires_review = questions.baseline_status !== 'available' || questions.difference_count !== 0;
  } else {
    report.stages.push({ name: 'question_candidates', state: 'not_applicable', reason: 'document question extraction is not implemented' });
    report.question_comparison_requires_review = null;
  }
  report.state = 'completed';
} catch (error) {
  report.state = 'failed';
  report.error = error.message;
  process.exitCode = 1;
} finally {
  report.finished_at = new Date().toISOString();
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ report: reportPath, state: report.state, public_visible: false,
    question_comparison_requires_review: report.question_comparison_requires_review,
    stages: report.stages.map(({ name, state }) => ({ name, state })),
    ...(report.error ? { error: report.error } : {}),
  }, null, 2));
}
