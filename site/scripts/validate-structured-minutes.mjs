#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SITE_ROOT = path.resolve(__dirname, "..");

function validateStructuredMinutes(data) {
  const errors = [];
  const warnings = [];
  if (!data?.source_document?.official_url) errors.push("source_document.official_url is required");
  if (!Array.isArray(data.turns)) errors.push("turns must be an array");
  if (!Array.isArray(data.question_blocks)) errors.push("question_blocks must be an array");
  if (!Array.isArray(data.topic_blocks)) errors.push("topic_blocks must be an array");
  if (!Array.isArray(data.topic_snippets)) errors.push("topic_snippets must be an array");
  if (errors.length > 0) return { ok: false, errors, warnings };

  const turnsById = new Map();
  for (const turn of data.turns) {
    if (turnsById.has(turn.id)) errors.push(`turn id is duplicated: ${turn.id}`);
    turnsById.set(turn.id, turn);
    if (!turn.source_position?.official_url) {
      errors.push(`turn ${turn.id} is missing source_position.official_url`);
    }
  }

  for (const snippet of data.topic_snippets) {
    if (!snippet.source_position?.official_url) {
      errors.push(`topic_snippet ${snippet.id} is missing source_position.official_url`);
    }
    const turn = turnsById.get(snippet.turn_id);
    if (!turn) {
      errors.push(`topic_snippet ${snippet.id} references missing turn ${snippet.turn_id}`);
      continue;
    }
    const actual = turn.text_original.slice(snippet.turn_char_start, snippet.turn_char_end);
    if (actual !== snippet.text_original) {
      errors.push(`topic_snippet ${snippet.id} is not an exact substring of turn ${snippet.turn_id}`);
    }
  }

  for (const topic of data.topic_blocks) {
    if (!topic.public_visible) continue;
    const roles = new Set(topic.flow.map((item) => item.role));
    if (!roles.has("question") || !roles.has("answer")) {
      errors.push(`public topic_block ${topic.id} must include question and answer in flow`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

async function collectJsonFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fp = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await collectJsonFiles(fp)));
    if (entry.isFile() && entry.name.endsWith(".json")) files.push(fp);
  }
  return files;
}

async function main() {
  const root = path.join(SITE_ROOT, "data", "structured-minutes");
  const files = await collectJsonFiles(root);
  let failed = false;
  for (const fp of files) {
    const data = JSON.parse(await fs.readFile(fp, "utf8"));
    const result = validateStructuredMinutes(data);
    const label = path.relative(SITE_ROOT, fp);
    if (result.ok) {
      console.log(`ok ${label}`);
      continue;
    }
    failed = true;
    console.error(`ng ${label}`);
    for (const error of result.errors) console.error(`  - ${error}`);
  }
  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
