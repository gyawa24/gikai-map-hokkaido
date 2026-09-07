#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { normalizeStructuredMinutes } from "../site/src/lib/structured-minutes/read-contract.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const COUNCIL_ID = "20251002";

const EXPECTED_QUESTIONERS = new Map([
  [
    "2025-06-18",
    [
      ["奥野妙子", "comprehensive"],
      ["岡英彦", "itemized"],
      ["高橋典子", "comprehensive"],
      ["藤城正興", "comprehensive"],
    ],
  ],
  [
    "2025-06-19",
    [
      ["佐々木聖子", "itemized"],
      ["干場芳子", "itemized"],
      ["三吉芳枝", "comprehensive"],
      ["石川麻美", "comprehensive"],
    ],
  ],
  [
    "2025-06-20",
    [
      ["猪股美香", "itemized"],
      ["岩田優太", "itemized"],
      ["野村和宏", "itemized"],
      ["長田旭輝", "itemized"],
    ],
  ],
]);

const FOOTER_MARKERS = [
  "このページに関するお問い合わせ先",
  "江別市役所本庁舎3階",
  "Tel：011-381-1051",
  "〒067-8674",
  "Copyright &#169; Ebetsu City",
];

const IWATA_TOPIC_TITLES = [
  "病床数適正化支援事業に係る２次内示の見通し",
  "さらなる経費削減や診療報酬改善の取組",
  "民間医療機関とのアライアンスの推進",
];

const SINGLE_PARENT_TOPIC_CASES = new Map([
  [
    "独り親家庭の現状についての認識",
    {
      required_terms: ["独り親家庭", "現状", "認識"],
      turn_ids: ["ebetsu-20251002-3-turn-022", "ebetsu-20251002-3-turn-026"],
    },
  ],
  [
    "独り親家庭の意見収集",
    {
      required_terms: ["独り親家庭", "意見収集"],
      turn_ids: ["ebetsu-20251002-3-turn-022", "ebetsu-20251002-3-turn-026"],
    },
  ],
  [
    "独り親家庭の交流",
    {
      required_terms: ["独り親家庭", "交流"],
      turn_ids: [
        "ebetsu-20251002-3-turn-022",
        "ebetsu-20251002-3-turn-026",
        "ebetsu-20251002-3-turn-039",
      ],
    },
  ],
  [
    "独り親家庭への情報の周知",
    {
      required_terms: ["独り親家庭", "周知"],
      turn_ids: [
        "ebetsu-20251002-3-turn-022",
        "ebetsu-20251002-3-turn-026",
        "ebetsu-20251002-3-turn-040",
      ],
    },
  ],
  [
    "独り親家庭への支援の拡充",
    {
      required_terms: ["独り親家庭", "拡充"],
      turn_ids: [
        "ebetsu-20251002-3-turn-022",
        "ebetsu-20251002-3-turn-026",
        "ebetsu-20251002-3-turn-042",
      ],
    },
  ],
]);

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function expectedDate(scheduleName, year) {
  const match = String(scheduleName).normalize("NFKC").match(/(\d{1,2})月(\d{1,2})日/u);
  assert.ok(match, `schedule date is missing: ${scheduleName}`);
  return `${year}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

function assertIncreasing(ids, orderById, label) {
  const orders = ids.map((id) => {
    const order = orderById.get(id);
    assert.ok(Number.isInteger(order), `${label} references missing turn: ${id}`);
    return order;
  });
  const sorted = [...orders].sort((left, right) => left - right);
  assert.deepEqual(orders, sorted, `${label} turn_ids must preserve source order`);
}

function assertNoPageFooter(value, label) {
  for (const marker of FOOTER_MARKERS) {
    assert.ok(!String(value ?? "").includes(marker), `${label} contains page footer marker: ${marker}`);
  }
}

function groupedQuestioners(blocks, methodMapper = (value) => value) {
  const grouped = new Map();
  for (const block of blocks) {
    const rows = grouped.get(block.meeting_date) ?? [];
    rows.push([block.questioner_name_normalized ?? block.questioner_name, methodMapper(block.question_method)]);
    grouped.set(block.meeting_date, rows);
  }
  return grouped;
}

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.join(PROJECT_ROOT, relativePath), "utf8"));
}

async function main() {
  const [minutes, turnsData, structured, siteTurnsData, siteStructured] = await Promise.all([
    readJson(`data/ebetsu/minutes/${COUNCIL_ID}.json`),
    readJson(`data/ebetsu/turns/${COUNCIL_ID}.json`),
    readJson(`data/structured-minutes/ebetsu/${COUNCIL_ID}.json`),
    readJson(`site/data/ebetsu/turns/${COUNCIL_ID}.json`),
    readJson(`site/data/structured-minutes/ebetsu/${COUNCIL_ID}.json`),
  ]);

  const sourceText = await fs.readFile(path.join(PROJECT_ROOT, "site", "data", "ebetsu", "turns", `${COUNCIL_ID}.json`), "utf8");
  validateEbetsuData({ minutes, turnsData, rawStructured: structured, siteTurnsData, siteStructured, sourceText });
}

export function validateEbetsuData({ minutes, turnsData, rawStructured, siteTurnsData, siteStructured, sourceText }) {
  assert.deepEqual(siteTurnsData, turnsData, "root/site turn data must stay synchronized");
  assert.deepEqual(siteStructured, rawStructured, "root/site structured data must stay synchronized");
  const { data: structured, validation } = normalizeStructuredMinutes(rawStructured);
  assert.ok(structured, `structured read contract failed: ${validation.errors.join("; ")}`);
  assert.deepEqual(structured.turns.map((turn) => [turn.id, turn.text_original]), rawStructured.turns.map((turn) => [turn.id, turn.text_original]));
  assert.equal(structured.read_quality.provenance_status, "unverified");
  assert.equal(structured.read_quality.freshness_status, "unverified");
  assert.equal(structured.topic_blocks.filter((topic) => topic.public_visible).length, 0, "automatic topics must stay withheld until documented review");

  const sourceScheduleById = new Map(minutes.schedules.map((schedule) => [schedule.schedule_id, schedule]));
  const expectedDateByScheduleId = new Map(
    minutes.schedules.map((schedule) => [schedule.schedule_id, expectedDate(schedule.name, minutes.year)])
  );
  const rawTurnOrder = new Map(turnsData.turns.map((turn, index) => [turn.id, index + 1]));

  assert.equal(turnsData.turns.length, 313, "unexpected extracted turn count");
  for (const turn of turnsData.turns) {
    const schedule = sourceScheduleById.get(turn.schedule_id);
    assert.ok(schedule, `turn references missing schedule: ${turn.id}`);
    assert.equal(turn.meeting_date, expectedDateByScheduleId.get(turn.schedule_id), `wrong date: ${turn.id}`);
    assert.equal(turn.source_url, schedule.minutes[0].source_url, `wrong official URL: ${turn.id}`);
    assert.ok(
      normalizeText(schedule.minutes[0].text).includes(turn.text),
      `turn text is not an exact substring of normalized source: ${turn.id}`
    );
    assertNoPageFooter(turn.text, turn.id);
  }

  const debateTurns = turnsData.turns.filter(
    (turn) => !turn.schedule_name.includes("一般質問") && turn.speaker_type === "member" && /討論/u.test(turn.text)
  );
  assert.equal(debateTurns.length, 4, "expected four final-day debate turns");
  for (const turn of debateTurns) {
    assert.notEqual(turn.turn_type, "question", `debate is incorrectly classified as a question: ${turn.id}`);
  }

  const viceMayorTurns = turnsData.turns.filter((turn) => turn.speaker_role === "副市長");
  assert.ok(viceMayorTurns.length > 0, "vice-mayor fixture is missing");
  assert.ok(
    viceMayorTurns.every((turn) => turn.speaker_type === "administration"),
    "副市長 must be classified as administration before matching 市長"
  );
  const officeDirectorTurns = turnsData.turns.filter((turn) => turn.speaker_role === "事務局長");
  assert.ok(officeDirectorTurns.length > 0, "office-director fixture is missing");
  assert.ok(
    officeDirectorTurns.every((turn) => turn.speaker_type === "secretariat"),
    "事務局長 must be classified as secretariat before matching 局長"
  );

  assert.equal(turnsData.question_blocks.length, 12, "only the 12 general-question sessions are allowed");
  for (const block of turnsData.question_blocks) {
    assert.ok(EXPECTED_QUESTIONERS.has(block.meeting_date), `non-general-question block: ${block.id}`);
    assertIncreasing(block.turn_ids, rawTurnOrder, block.id);
  }
  assert.deepEqual(
    groupedQuestioners(turnsData.question_blocks),
    EXPECTED_QUESTIONERS,
    "questioner or question-method extraction changed"
  );

  const iwataQuestionBlock = turnsData.question_blocks.find(
    (block) => block.questioner_name === "岩田優太"
  );
  assert.ok(iwataQuestionBlock, "岩田優太 question block is missing");
  const iwataTopics = turnsData.topic_blocks
    .filter((topic) => topic.question_block_id === iwataQuestionBlock.id)
    .map((topic) => topic.title);
  assert.deepEqual(
    iwataTopics,
    IWATA_TOPIC_TITLES,
    "お伺いいたします headings must produce 岩田優太's three topics"
  );

  assert.equal(structured.source_document.meeting_date, "2025-06-10");
  assert.equal(structured.source_document.source_type, "official_html");
  assert.equal(structured.source_document.fetched_at, "unknown");
  assert.notEqual(
    structured.source_document.fetched_at,
    turnsData.generated_at,
    "turn-conversion time must not be presented as source fetch time"
  );
  assert.ok(
    ["ebetsu-structured-minutes-v3-2026-08-11", "ebetsu-structured-minutes-v4-2026-09-07"].includes(structured.source_document.extractor_version),
    "unsupported structured generator version"
  );
  if (structured.source_document.extractor_version === "ebetsu-structured-minutes-v4-2026-09-07") {
    assert.equal(rawStructured.generation?.generator, structured.source_document.extractor_version);
    assert.equal(rawStructured.generation?.input_sha256, createHash("sha256").update(sourceText).digest("hex"), "generator input hash must match source turns");
    assert.equal(rawStructured.generation?.input_path, `site/data/ebetsu/turns/${COUNCIL_ID}.json`);
    assert.ok(Number.isFinite(Date.parse(rawStructured.generation?.generated_at)), "generation time is required");
    assert.ok(rawStructured.topic_blocks.every((topic) => !topic.public_visible), "v4 must persist the publication gate");
  }
  assert.equal(structured.question_blocks.length, 12);

  const structuredTurnOrder = new Map(structured.turns.map((turn) => [turn.id, turn.order_index]));
  const rawTurnsById = new Map(turnsData.turns.map((turn) => [turn.id, turn]));
  const debateTurnIds = new Set(debateTurns.map((turn) => turn.id));
  for (const turn of structured.turns) {
    const rawTurn = rawTurnsById.get(turn.id);
    assert.ok(rawTurn, `structured turn references missing extracted turn: ${turn.id}`);
    assert.equal(turn.meeting_date, rawTurn.meeting_date, `structured turn date mismatch: ${turn.id}`);
    assert.equal(turn.text_original, rawTurn.text, `structured turn text mismatch: ${turn.id}`);
    assert.equal(turn.source_position.official_url, rawTurn.source_url, `structured URL mismatch: ${turn.id}`);
    assert.equal(turn.extraction.method, "rule_based", `turn is incorrectly marked reviewed: ${turn.id}`);
    assertNoPageFooter(turn.text_original, `structured ${turn.id}`);
    if (debateTurnIds.has(turn.id)) {
      assert.notEqual(turn.turn_type, "question", `structured debate is a question: ${turn.id}`);
    }
    if (rawTurn.speaker_role === "副市長") {
      assert.equal(turn.speaker_type, "vice_mayor", `副市長 is not vice_mayor: ${turn.id}`);
    }
    if (rawTurn.speaker_role === "事務局長") {
      assert.equal(turn.speaker_type, "office_staff", `事務局長 is not office_staff: ${turn.id}`);
    }
  }

  const rawQuestionBlocksById = new Map(turnsData.question_blocks.map((block) => [block.id, block]));
  for (const block of structured.question_blocks) {
    const rawBlock = rawQuestionBlocksById.get(block.id);
    assert.ok(rawBlock, `structured question block is missing raw source: ${block.id}`);
    assertIncreasing(block.turn_ids, structuredTurnOrder, block.id);
    assert.equal(
      block.source_position.official_url,
      rawBlock.source_url,
      `question block URL mismatch: ${block.id}`
    );
    assert.equal(block.extraction.method, "rule_based", `question block is incorrectly marked reviewed: ${block.id}`);
  }
  assert.deepEqual(
    groupedQuestioners(structured.question_blocks, (value) =>
      value === "one_by_one" ? "itemized" : value
    ),
    EXPECTED_QUESTIONERS,
    "structured questioner or question-method data changed"
  );

  const rawTopicBlocksById = new Map(turnsData.topic_blocks.map((topic) => [topic.id, topic]));
  for (const topic of structured.topic_blocks) {
    const rawTopic = rawTopicBlocksById.get(topic.id);
    assert.ok(rawTopic, `structured topic is missing raw source: ${topic.id}`);
    assert.ok(
      topic.review_status === "auto" || topic.review_status === "needs_review",
      `topic has invalid automatic review state: ${topic.id}`
    );
    assert.notEqual(topic.review_status, "reviewed", `topic is incorrectly marked reviewed: ${topic.id}`);
    if (topic.review_status === "needs_review") {
      assert.equal(topic.public_visible, false, `needs-review topic must stay hidden: ${topic.id}`);
    }
    assert.equal(topic.extraction.method, "rule_based", `topic extraction method is wrong: ${topic.id}`);
    assert.equal(
      topic.source_position.official_url,
      rawTopic.source_url,
      `topic URL mismatch: ${topic.id}`
    );
    assert.ok(
      topic.flow.every((item) => item.role !== "request"),
      `re-question must not be inferred as a request: ${topic.id}`
    );
  }
  for (const snippet of structured.topic_snippets) {
    const rawTurn = rawTurnsById.get(snippet.turn_id);
    assert.ok(rawTurn, `snippet references missing raw turn: ${snippet.id}`);
    assert.equal(snippet.extraction.method, "rule_based", `snippet extraction method is wrong: ${snippet.id}`);
    assert.equal(
      snippet.source_position.official_url,
      rawTurn.source_url,
      `snippet URL mismatch: ${snippet.id}`
    );
    assertNoPageFooter(snippet.text_original, `snippet ${snippet.id}`);
  }

  const iwataStructuredTopics = structured.topic_blocks
    .filter((topic) => topic.question_block_id === iwataQuestionBlock.id)
    .map((topic) => topic.title_original);
  assert.deepEqual(iwataStructuredTopics, IWATA_TOPIC_TITLES, "structured 岩田優太 topics changed");

  const snippetsById = new Map(structured.topic_snippets.map((snippet) => [snippet.id, snippet]));
  const singleParentSnippetOwners = new Map();
  for (const [title, expected] of SINGLE_PARENT_TOPIC_CASES) {
    const matchingTopics = structured.topic_blocks.filter((topic) => topic.title_original === title);
    assert.equal(matchingTopics.length, 1, `expected one topic card: ${title}`);
    const topic = matchingTopics[0];
    assert.equal(topic.public_visible, false, `automatic single-parent topic must await documented review: ${title}`);
    const snippets = topic.topic_snippet_ids.map((id) => {
      const snippet = snippetsById.get(id);
      assert.ok(snippet, `topic references missing snippet: ${id}`);
      return snippet;
    });
    assert.deepEqual(
      snippets.map((snippet) => snippet.turn_id),
      expected.turn_ids,
      `unrelated turns were attached to topic: ${title}`
    );
    for (const snippet of snippets) {
      for (const term of expected.required_terms) {
        assert.ok(
          snippet.text_original.includes(term),
          `topic snippet lacks specific term ${term}: ${title} / ${snippet.id}`
        );
      }
      const existingOwner = singleParentSnippetOwners.get(snippet.text_original);
      assert.ok(
        !existingOwner,
        `same snippet is shared by unrelated single-parent topics: ${existingOwner} / ${title}`
      );
      singleParentSnippetOwners.set(snippet.text_original, title);
    }
  }

  // Extraction quality remains testable while publication awaits human review.
  const visibleTopicIds = new Set(
    structured.topic_blocks.filter((topic) => topic.extraction.confidence >= 0.8).map((topic) => topic.id)
  );
  const visibleSnippets = structured.topic_snippets.filter((snippet) =>
    visibleTopicIds.has(snippet.topic_block_id)
  );
  const visibleSnippetCounts = new Map();
  for (const snippet of visibleSnippets) {
    const key = `${snippet.turn_id}\u0000${snippet.text_original}`;
    visibleSnippetCounts.set(key, (visibleSnippetCounts.get(key) ?? 0) + 1);
  }
  const duplicateReferenceCount = [...visibleSnippetCounts.values()].reduce(
    (sum, count) => sum + Math.max(0, count - 1),
    0
  );
  assert.ok(visibleSnippets.length > 0, "high-confidence extraction fixtures must remain present");
  const duplicateReferenceRate = duplicateReferenceCount / visibleSnippets.length;
  assert.ok(
    duplicateReferenceRate <= 0.12,
    `candidate topic snippet duplicate rate regressed: ${duplicateReferenceRate.toFixed(3)}`
  );

  const multiDepartmentTopic = structured.topic_blocks.find(
    (topic) =>
      topic.title_original ===
      "260メガヘルツ帯デジタル防災行政無線の導入に関する市の認識と将来的な方向性"
  );
  assert.ok(multiDepartmentTopic, "multi-department answer fixture is missing");
  assert.deepEqual(
    multiDepartmentTopic.flow.map((item) => item.role),
    ["question", "answer", "answer"],
    "multiple departments' first answers must not be labeled re_answer"
  );

  const informationTopic = structured.topic_blocks.find(
    (topic) => topic.title_original === "独り親家庭への情報の周知"
  );
  assert.ok(informationTopic, "single-parent information topic is missing");
  assert.equal(
    informationTopic.flow.at(-1)?.role,
    "re_question",
    "a final re-question must not be inferred as a request"
  );

  console.log(
    `ok ebetsu/${COUNCIL_ID}: ${structured.turns.length} turns / ${structured.question_blocks.length} general questions / ${structured.topic_blocks.length} topics`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
