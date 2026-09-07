import fs from 'node:fs';
import { loadDnpSnapshotBundle } from './dnp-council-record-v2.mjs';
import { loadGijirokuSnapshotBundle } from './gijiroku-council-record-v2.mjs';

export function loadCouncilRecordV2SnapshotBundle(manifestPath, repoRoot) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.format === 'dnp-capture-manifest/1') return loadDnpSnapshotBundle(manifestPath, repoRoot);
  if (manifest.format === 'gijiroku-capture-manifest/1') return loadGijirokuSnapshotBundle(manifestPath, repoRoot);
  throw new Error(`unsupported council-record capture manifest: ${manifest.format}`);
}
