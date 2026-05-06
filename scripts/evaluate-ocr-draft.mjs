#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildSegmentsForMunicipality } from "./build-segments.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function required(options, key) {
  if (!options[key]) {
    throw new Error(`--${key} is required`);
  }
  return options[key];
}

function topCounts(items, key, limit = 12) {
  const counts = new Map();
  for (const item of items) {
    const value = item[key] ?? "(none)";
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const slug = required(options, "slug");
  const draftId = required(options, "id");
  const draftPath = path.join(PROJECT_ROOT, "data", slug, "ocr_drafts", `${draftId}.json`);
  const draft = JSON.parse(await fs.readFile(draftPath, "utf8"));

  const councilIdMatch = String(draftId).match(/^(\d{8})/);
  const councilId = councilIdMatch ? Number(councilIdMatch[1]) : 99999999;
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gikai-ocr-eval-"));
  const minutesDir = path.join(tmpDir, "minutes");
  const segmentsDir = path.join(tmpDir, "segments");
  await fs.mkdir(minutesDir, { recursive: true });

  const minute = {
    council_id: councilId,
    name: draft.title,
    year: String(Math.floor(councilId / 10000)),
    japanese_year: "",
    type_label: "OCR評価 > 本会議",
    schedules: [
      {
        schedule_id: 1,
        name: draft.title,
        page_no: 1,
        minutes: [
          {
            minute_id: 1,
            title: draft.title,
            minute_type: "本会議",
            text: draft.normalized_text,
            source_url: draft.source_url,
          },
        ],
      },
    ],
  };

  await fs.writeFile(
    path.join(minutesDir, `${councilId}.json`),
    JSON.stringify(minute, null, 2) + "\n"
  );

  const result = await buildSegmentsForMunicipality(slug, {
    minutesDir,
    segmentsDir,
  });
  const index = JSON.parse(await fs.readFile(path.join(segmentsDir, "_index.json"), "utf8"));
  const questionSegments = index.filter((seg) => seg.speaker_role === "質問");
  const matchedQuestions = questionSegments.filter((seg) => seg.member_name);
  const matchedSegments = index.filter((seg) => seg.member_name);
  const suspectedFalsePositiveMemberSegments = matchedSegments.filter((seg) =>
    /記載省略|報告あり|出席議員|欠席議員|応招議員|提出議案名/.test(seg.excerpt ?? "")
  );

  const summary = {
    slug,
    draft_id: draftId,
    draft_metrics: draft.metrics,
    segments: result.totalSegments,
    member_matched_segments: matchedSegments.length,
    question_segments: questionSegments.length,
    member_matched_question_segments: matchedQuestions.length,
    suspected_false_positive_member_segments:
      suspectedFalsePositiveMemberSegments.length,
    member_match_rate:
      result.totalSegments === 0
        ? 0
        : Math.round((matchedSegments.length / result.totalSegments) * 100),
    question_member_match_rate:
      questionSegments.length === 0
        ? 0
        : Math.round((matchedQuestions.length / questionSegments.length) * 100),
    top_speakers: topCounts(index, "speaker"),
    top_members: topCounts(index.filter((seg) => seg.member_name), "member_name"),
    suspected_false_positive_examples:
      suspectedFalsePositiveMemberSegments.slice(0, 5).map((seg) => ({
        speaker: seg.speaker,
        member_name: seg.member_name,
        excerpt: seg.excerpt,
      })),
    temp_dir: tmpDir,
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
