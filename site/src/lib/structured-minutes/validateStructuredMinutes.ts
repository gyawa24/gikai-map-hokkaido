import type { StructuredMinutes, TopicBlock, TopicSnippet, Turn } from "./types";

export type ValidationResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

function uniqueIds(items: { id: string }[], label: string, errors: string[]) {
  const seen = new Set<string>();
  for (const item of items) {
    if (!item.id) {
      errors.push(`${label} has an empty id`);
      continue;
    }
    if (seen.has(item.id)) errors.push(`${label} id is duplicated: ${item.id}`);
    seen.add(item.id);
  }
}

function hasQuestionAndAnswer(topic: TopicBlock): boolean {
  const roles = new Set(topic.flow.map((item) => item.role));
  return roles.has("question") && roles.has("answer");
}

function validateSnippetRange(snippet: TopicSnippet, turn: Turn, errors: string[]) {
  const actual = turn.text_original.slice(snippet.turn_char_start, snippet.turn_char_end);
  if (actual !== snippet.text_original) {
    errors.push(
      `topic_snippet ${snippet.id} is not an exact substring of turn ${snippet.turn_id}`
    );
  }
}

export function validateStructuredMinutes(data: StructuredMinutes): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!data?.source_document?.official_url) {
    errors.push("source_document.official_url is required");
  }
  if (!Array.isArray(data.turns)) errors.push("turns must be an array");
  if (!Array.isArray(data.question_blocks)) errors.push("question_blocks must be an array");
  if (!Array.isArray(data.topic_blocks)) errors.push("topic_blocks must be an array");
  if (!Array.isArray(data.topic_snippets)) errors.push("topic_snippets must be an array");

  if (errors.length > 0) return { ok: false, errors, warnings };

  uniqueIds(data.turns, "turn", errors);
  uniqueIds(data.question_blocks, "question_block", errors);
  uniqueIds(data.topic_blocks, "topic_block", errors);
  uniqueIds(data.topic_snippets, "topic_snippet", errors);

  const turnsById = new Map(data.turns.map((turn) => [turn.id, turn]));

  for (const turn of data.turns) {
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
    validateSnippetRange(snippet, turn, errors);
  }

  for (const topic of data.topic_blocks) {
    if (topic.public_visible && !hasQuestionAndAnswer(topic)) {
      errors.push(`public topic_block ${topic.id} must include question and answer in flow`);
    }
    if (topic.review_status === "needs_review" && topic.public_visible) {
      warnings.push(`topic_block ${topic.id} is public but still needs review`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
