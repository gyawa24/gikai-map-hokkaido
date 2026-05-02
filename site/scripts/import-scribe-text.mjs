#!/usr/bin/env node
/**
 * Scribe が書き出した文字起こしテキストを取り込んでセッションJSONを更新する
 *
 * 使い方:
 *   node site/scripts/import-scribe-text.mjs \
 *     --city hokkaido \
 *     --id 4840-08-20250306 \
 *     --transcript /path/to/scribe.txt
 *
 * メモ:
 *   - 休憩や区切りを分けたい場合は、文字起こしテキストに "---" か "[休憩]" を入れる
 *   - テスト時は --preview-only で tmp_audio/*.preview.json に書き出せる
 */

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const passThrough = [];
for (let i = 0; i < args.length; i++) {
  passThrough.push(args[i]);
}

const summarizeScript = path.join(__dirname, "summarize-session.mjs");
const result = spawnSync(process.execPath, [summarizeScript, ...passThrough], {
  stdio: "inherit",
});

process.exit(result.status ?? 1);
