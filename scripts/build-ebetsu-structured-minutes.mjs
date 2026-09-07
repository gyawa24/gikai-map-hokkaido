#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { normalizeStructuredMinutes } from "../site/src/lib/structured-minutes/read-contract.mjs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const EXTRACTOR_VERSION = "ebetsu-structured-minutes-v4-2026-09-07";
const GENERIC_TOPIC_MATCH_TERMS = new Set([
  "ついて",
  "支援",
  "情報",
  "取組",
  "取り組み",
  "対応",
  "活用",
]);

function normalizeName(value) {
  return String(value ?? "").replace(/[ \t　]/g, "").trim();
}

function stableId(value) {
  return normalizeName(value)
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function speakerType(turn) {
  if (turn.speaker_type === "member") return "council_member";
  if (turn.speaker_type === "chair") return "chair";
  if (turn.speaker_type === "secretariat") return "office_staff";
  if (turn.speaker_type === "administration") {
    if (turn.speaker_role?.includes("副市長")) return "vice_mayor";
    if (turn.speaker_role?.includes("市長")) return "mayor";
    if (turn.speaker_role?.includes("教育長")) return "education_board";
    return "executive";
  }
  return "unknown";
}

function turnType(turn) {
  if (turn.turn_type === "question") return "question";
  if (turn.turn_type === "answer") return "answer";
  if (turn.turn_type === "chair") return "procedure";
  return "other";
}

function extraction(confidence = 0.82, warnings = []) {
  return {
    method: "rule_based",
    confidence,
    extractor_version: EXTRACTOR_VERSION,
    warnings,
  };
}

function questionMethod(value) {
  if (value === "itemized") return "one_by_one";
  if (value === "comprehensive") return "comprehensive";
  return "unknown";
}

function sourcePosition(url, localAnchor, searchHint, extra = {}) {
  return {
    official_url: url,
    local_anchor: localAnchor,
    search_hint: searchHint,
    ...extra,
  };
}

function roleForSnippet(snippet, counts) {
  if (snippet.turn_type === "answer") {
    counts.answer += 1;
    return counts.question > 1 ? "re_answer" : "answer";
  }
  if (snippet.turn_type === "question") {
    counts.question += 1;
    return counts.answer > 0 && counts.question > 1 ? "re_question" : "question";
  }
  return "context";
}

function flowRole(snippetRole) {
  if (snippetRole === "context") return "other";
  return snippetRole;
}

function normalizeTopicTitle(value) {
  return String(value ?? "")
    .replace(/^次に、/u, "")
    .replace(/^初めに、/u, "")
    .replace(/^それから、/u, "")
    .replace(/^件名[0-9０-９]+[、，]/u, "")
    .replace(/^第[0-9０-９]+点目(?:として)?[、，]/u, "")
    .replace(/^[0-9０-９]+点目(?:として)?[、，]/u, "")
    .replace(/について(?:御答弁を申し上げます|であります(?:が)?)[、。]?$/u, "")
    .replace(/。$/u, "")
    .trim();
}

function compactTopicText(value) {
  return normalizeTopicTitle(value)
    .normalize("NFKC")
    .replace(/[ \t\n　、，。・「」『』（）()]/g, "");
}

function topicMatchTerms(title) {
  return String(title ?? "")
    .normalize("NFKC")
    .split(/[、，・のにとをがはへで\s　]+/u)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2 && !/^(次に|初めに|項目|件名|ついて)$/u.test(part));
}

function textMatchesTopic(text, title) {
  const compactText = compactTopicText(text);
  const compactTitle = compactTopicText(title);
  if (!compactText || !compactTitle) return false;
  if (compactText.includes(compactTitle)) return true;

  const terms = topicMatchTerms(title);
  if (terms.length === 0) return false;
  const subject = compactTopicText(terms[0]);
  if (!subject || !compactText.includes(subject)) return false;

  const remaining = terms.slice(1);
  if (remaining.length === 0) return false;
  const specificTerms = remaining.filter((term) => !GENERIC_TOPIC_MATCH_TERMS.has(term));
  const requiredTerms = specificTerms.length > 0 ? specificTerms : remaining;
  const matches = requiredTerms.filter((term) => compactText.includes(compactTopicText(term))).length;
  const requiredMatches = requiredTerms.length <= 2 ? requiredTerms.length : 2;
  return matches >= requiredMatches;
}

function snippetMatchesTopic(snippet, title) {
  return textMatchesTopic(`${snippet.matched_heading ?? ""}\n${snippet.text ?? ""}`, title);
}

function policyTagsFor(title) {
  const tags = [];
  if (/病院|医療|診療|病床/u.test(title)) tags.push("医療");
  if (/駅|再開発|土地|施設|公園|ファーム/u.test(title)) tags.push("まちづくり");
  if (/教育|学校|子供|子ども/u.test(title)) tags.push("教育・子育て");
  if (/観光|スポーツ|ファイターズ/u.test(title)) tags.push("観光・スポーツ");
  return [...new Set(tags)];
}

async function writeJson(fp, data) {
  await fs.mkdir(path.dirname(fp), { recursive: true });
  await fs.writeFile(fp, JSON.stringify(data, null, 2) + "\n");
}

async function main() {
  const councilId = process.argv[2] ?? "20241004";
  const sourcePath = path.join(PROJECT_ROOT, "site", "data", "ebetsu", "turns", `${councilId}.json`);
  const inputText = await fs.readFile(sourcePath, "utf8");
  const raw = JSON.parse(inputText);
  const sourceDocumentId = `ebetsu-${councilId}`;
  const officialUrl = raw.schedules?.find((schedule) => schedule.source_url)?.source_url ?? "";
  const speakerMap = new Map();
  const turnMap = new Map();

  const speakers = [];
  for (const turn of raw.turns) {
    const speakerId = `ebetsu-speaker-${stableId(`${turn.speaker_name}-${turn.speaker_role}`)}`;
    if (!speakerMap.has(`${turn.speaker_name}-${turn.speaker_role}`)) {
      speakerMap.set(`${turn.speaker_name}-${turn.speaker_role}`, speakerId);
      speakers.push({
        id: speakerId,
        municipality_id: "ebetsu",
        name_original: turn.speaker_name,
        name_normalized: normalizeName(turn.speaker_name),
        role_original: turn.speaker_role,
        speaker_type: speakerType(turn),
        aliases: [turn.speaker_label],
      });
    }
  }

  const turns = raw.turns.map((turn, index) => {
    const speakerId = speakerMap.get(`${turn.speaker_name}-${turn.speaker_role}`);
    const converted = {
      id: turn.id,
      source_document_id: sourceDocumentId,
      municipality_id: "ebetsu",
      meeting_date: turn.meeting_date,
      order_index: index + 1,
      speaker_id: speakerId,
      speaker_name_original: turn.speaker_label,
      speaker_name_normalized: normalizeName(turn.speaker_name),
      speaker_role_original: turn.speaker_role,
      speaker_type: speakerType(turn),
      turn_type: turnType(turn),
      agenda_title: turn.topic_headings?.[0] ? normalizeTopicTitle(turn.topic_headings[0]) : undefined,
      text_original: turn.text,
      text_normalized: turn.text.replace(/\s+/g, " ").trim(),
      source_position: sourcePosition(
        turn.source_url ?? officialUrl,
        turn.id,
        `${turn.speaker_label} ${turn.text.replace(/\s+/g, " ").slice(0, 60)}`,
        {
          heading_path: [turn.schedule_name],
        }
      ),
      extraction: extraction(0.86),
    };
    turnMap.set(turn.id, converted);
    return converted;
  });

  const topicBlocksByQuestionId = new Map();
  for (const topic of raw.topic_blocks ?? []) {
    if (!topicBlocksByQuestionId.has(topic.question_block_id)) {
      topicBlocksByQuestionId.set(topic.question_block_id, []);
    }
    topicBlocksByQuestionId.get(topic.question_block_id).push(topic.id);
  }

  const questionBlocks = raw.question_blocks.map((block, index) => {
    const turnIds = (block.turn_ids ?? [...block.question_turn_ids, ...block.answer_turn_ids])
      .filter((id, pos, ids) => ids.indexOf(id) === pos)
      .sort((left, right) => {
        const leftOrder = turnMap.get(left)?.order_index ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = turnMap.get(right)?.order_index ?? Number.MAX_SAFE_INTEGER;
        return leftOrder - rightOrder;
      });
    const sourceUrl = block.source_url ?? officialUrl;
    return {
      id: block.id,
      source_document_id: sourceDocumentId,
      municipality_id: "ebetsu",
      meeting_date: block.meeting_date,
      order_index: index + 1,
      questioner_speaker_id: speakerMap.get(`${block.questioner_name}-議員`),
      questioner_name_original: block.questioner_label,
      questioner_name_normalized: normalizeName(block.questioner_name),
      question_method: questionMethod(block.question_method),
      title_original: `${block.questioner_label}の一般質問`,
      agenda_titles: (block.topic_headings ?? []).map(normalizeTopicTitle).filter(Boolean),
      turn_ids: turnIds,
      topic_block_ids: topicBlocksByQuestionId.get(block.id) ?? [],
      start_turn_id: turnIds[0],
      end_turn_id: turnIds[turnIds.length - 1],
      source_position: sourcePosition(sourceUrl, block.id, block.questioner_label),
      extraction: extraction(0.78),
    };
  });

  const topicSnippets = [];
  const topicBlocks = [];

  for (const [index, topic] of (raw.topic_blocks ?? []).entries()) {
    const sourceUrl = topic.source_url ?? officialUrl;
    const rawSnippets = topic.topic_snippets ?? [];
    const roleCounts = { question: 0, answer: 0 };
    const snippetIds = [];
    let semanticMismatchCount = 0;

    for (const rawSnippet of rawSnippets) {
      const turn = turnMap.get(rawSnippet.turn_id);
      if (!turn) continue;
      const start = turn.text_original.indexOf(rawSnippet.text);
      if (start < 0) continue;
      if (!snippetMatchesTopic(rawSnippet, topic.title)) {
        semanticMismatchCount += 1;
        continue;
      }
      const snippetRole = roleForSnippet(rawSnippet, roleCounts);
      const snippet = {
        id: rawSnippet.id,
        topic_block_id: topic.id,
        turn_id: rawSnippet.turn_id,
        order_index: snippetIds.length + 1,
        snippet_role: snippetRole,
        text_original: rawSnippet.text,
        turn_char_start: start,
        turn_char_end: start + rawSnippet.text.length,
        source_position: sourcePosition(
          sourceUrl,
          rawSnippet.id,
          `${rawSnippet.speaker_label} ${rawSnippet.text.replace(/\s+/g, " ").slice(0, 60)}`,
          {
            turn_char_start: start,
            turn_char_end: start + rawSnippet.text.length,
          }
        ),
        extraction: extraction(rawSnippet.matched_heading ? 0.88 : 0.72, rawSnippet.matched_heading ? [] : ["keyword_range"]),
      };
      topicSnippets.push(snippet);
      snippetIds.push(snippet.id);
    }

    const snippetsForTopic = topicSnippets.filter((snippet) => snippet.topic_block_id === topic.id);
    const flow = snippetsForTopic.map((snippet) => {
      const turn = turnMap.get(snippet.turn_id);
      return {
        role: flowRole(snippet.snippet_role),
        turn_id: snippet.turn_id,
        snippet_id: snippet.id,
        speaker_id: turn?.speaker_id,
        speaker_name_original: turn?.speaker_name_original ?? "",
        label: snippet.snippet_role,
      };
    });
    const relatedTurnIds = [...new Set(snippetsForTopic.map((snippet) => snippet.turn_id))];
    const respondentSpeakerIds = [
      ...new Set(
        snippetsForTopic
          .filter((snippet) => snippet.snippet_role === "answer" || snippet.snippet_role === "re_answer")
          .map((snippet) => turnMap.get(snippet.turn_id)?.speaker_id)
          .filter(Boolean)
      ),
    ];
    const publicVisible =
      snippetsForTopic.length > 0 &&
      flow.some((item) => item.role === "question") &&
      flow.some((item) => item.role === "answer");
    const extractionWarnings = [];
    if (semanticMismatchCount > 0) {
      extractionWarnings.push(`topic_term_mismatch:${semanticMismatchCount}`);
    }
    if (!publicVisible) extractionWarnings.push("missing_question_or_answer");

    topicBlocks.push({
      id: topic.id,
      question_block_id: topic.question_block_id,
      source_document_id: sourceDocumentId,
      order_index: index + 1,
      title_original: topic.title,
      title_normalized: normalizeTopicTitle(topic.title),
      policy_area_tags: policyTagsFor(topic.title),
      topic_tags: topic.keywords ?? [],
      questioner_speaker_id: speakerMap.get(`${topic.questioner_name}-議員`),
      respondent_speaker_ids: respondentSpeakerIds,
      related_turn_ids: relatedTurnIds,
      topic_snippet_ids: snippetIds,
      flow,
      source_position: sourcePosition(sourceUrl, topic.id, topic.title),
      review_status: !publicVisible && semanticMismatchCount > 0 ? "needs_review" : "auto",
      public_visible: false,
      extraction: extraction(publicVisible ? 0.82 : 0.5, extractionWarnings),
    });
  }

  const output = {
    generation: {
      generated_at: new Date().toISOString(),
      generator: EXTRACTOR_VERSION,
      input_path: path.relative(PROJECT_ROOT, sourcePath),
      input_sha256: createHash("sha256").update(inputText).digest("hex"),
    },
    source_document: {
      id: sourceDocumentId,
      municipality_id: "ebetsu",
      municipality_name: "江別市",
      official_url: officialUrl,
      title: raw.council_name,
      meeting_date: raw.schedules?.find((schedule) => schedule.meeting_date)?.meeting_date ?? "",
      fetched_at: "unknown",
      source_type: "official_html",
      extractor_version: EXTRACTOR_VERSION,
    },
    speakers,
    turns,
    question_blocks: questionBlocks,
    topic_blocks: topicBlocks,
    topic_snippets: topicSnippets,
  };

  const rootOut = path.join(PROJECT_ROOT, "data", "structured-minutes", "ebetsu", `${councilId}.json`);
  const siteOut = path.join(PROJECT_ROOT, "site", "data", "structured-minutes", "ebetsu", `${councilId}.json`);
  const normalized = normalizeStructuredMinutes(output);
  if (!normalized.data) throw new Error(normalized.validation.errors.join("; "));
  const { read_quality: _quality, ...publishedOutput } = normalized.data;
  await writeJson(rootOut, publishedOutput);
  await writeJson(siteOut, publishedOutput);
  console.log(
    `[ebetsu] structured ${turns.length} turns / ${questionBlocks.length} question_blocks / ${topicBlocks.length} topic_blocks / ${topicSnippets.length} snippets`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
