import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../..");
const QUALITY_CASES = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, "site", "data", "search_quality_cases.json"), "utf8")
);

const EXPECTED_RECORD_IDS = new Map([
  ["eniwa-mikami-rapidus-tax", "eniwa:official:237:committee_question:committee:三上まどか"],
  ["tomakomai-shikata-ai-system", "tomakomai:official:280:committee_question:committee:志方光徳"],
  ["tomakomai-yamada-maternity-care", "tomakomai:official:277:plenary_question:s2-m195:山田隆子"],
  ["tomakomai-ono-dv-benefit", "tomakomai:official:245:plenary_question:s2-m161:大野正和"],
  ["tomakomai-kamiyama-school-lunch", "tomakomai:official:245:representative_question:s3-m46:神山哲太郎"],
]);

const REQUIRED_EVIDENCE_TERMS = new Map([
  ["eniwa-mikami-rapidus-tax", ["ラピダス", "固定資産税"]],
  ["tomakomai-shikata-ai-system", ["生成AI", "文書管理"]],
  ["tomakomai-yamada-maternity-care", ["妊産婦", "産後ケア"]],
  ["tomakomai-ono-dv-benefit", ["DV", "物価高騰"]],
  ["tomakomai-kamiyama-school-lunch", ["学校給食", "防災"]],
]);

function compactEvidenceText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}々ヶヵー]+/gu, "");
}

function loadJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function recordEvidenceText(city, record) {
  const segments = loadJson(
    path.join(REPO_ROOT, "data", city, "segments", `${record.council_id}.json`),
    []
  );
  const segmentIds = new Set(record.evidence_segment_ids ?? []);
  const segmentText = (Array.isArray(segments) ? segments : segments?.segments ?? [])
    .filter((segment) => segmentIds.has(segment.id))
    .map((segment) => segment.text ?? segment.excerpt ?? "")
    .join(" ");
  if (segmentText) return compactEvidenceText(segmentText);

  assert.ok(Number.isFinite(Number(record.schedule_id)), `${record.record_id}: schedule_id is missing`);
  const meeting = loadJson(
    path.join(REPO_ROOT, "data", city, "minutes", `${record.council_id}.json`)
  );
  assert.ok(meeting?.schedules, `${record.record_id}: raw meeting is missing`);
  const minuteIds = new Set((record.evidence_minute_ids ?? []).map(Number));
  return compactEvidenceText(
    meeting.schedules
      .filter((schedule) => Number(schedule.schedule_id) === Number(record.schedule_id))
      .flatMap((schedule) => schedule.minutes ?? [])
      .filter((minute) => minuteIds.has(Number(minute.minute_id)))
      .map((minute) => minute.text ?? minute.title ?? "")
      .join(" ")
  );
}

test("member activity keeps the five quality-case records with direct raw evidence", () => {
  const activityByCity = new Map();
  for (const testCase of QUALITY_CASES.filter((item) => EXPECTED_RECORD_IDS.has(item.id))) {
    if (!activityByCity.has(testCase.city)) {
      activityByCity.set(
        testCase.city,
        JSON.parse(
          fs.readFileSync(
            path.join(REPO_ROOT, "data", testCase.city, "members_activity.json"),
            "utf8"
          )
        )
      );
    }
    const activity = activityByCity.get(testCase.city);
    const memberName = String(testCase.expected.member_name).replace(/\s/g, "");
    const expectedRecordId = EXPECTED_RECORD_IDS.get(testCase.id);
    const record = activity[memberName]?.sessions?.find(
      (candidate) => candidate.record_id === expectedRecordId
    );
    assert.ok(record, `${testCase.id}: ${expectedRecordId} is missing`);
    assert.equal(record.council_id, testCase.expected.council_id, `${testCase.id}: council_id`);
    assert.equal(record.source_status, "official", `${testCase.id}: source_status`);
    assert.ok(record.evidence_minute_ids?.length > 0, `${testCase.id}: raw evidence is missing`);
    const evidenceText = recordEvidenceText(testCase.city, record);
    for (const expectedText of REQUIRED_EVIDENCE_TERMS.get(testCase.id) ?? []) {
      assert.ok(
        evidenceText.includes(compactEvidenceText(expectedText)),
        `${testCase.id}: raw evidence does not include ${expectedText}`
      );
    }
    assert.ok((record.canonical_topics ?? []).length <= 24, `${testCase.id}: canonical_topics is unbounded`);
    for (const topic of record.canonical_topics ?? []) {
      assert.ok(
        evidenceText.includes(compactEvidenceText(topic)),
        `${testCase.id}: canonical topic has no exact raw evidence: ${topic}`
      );
    }
  }
  assert.equal(EXPECTED_RECORD_IDS.size, 5);
  assert.equal(REQUIRED_EVIDENCE_TERMS.size, 5);
});
