// Legacy normalization preserves source text and IDs without claiming v2 provenance.
export function isStructuredMinutesRequest(municipalitySlug, id) {
  return typeof municipalitySlug === "string" && /^[a-z][a-z0-9_-]*$/u.test(municipalitySlug)
    && typeof id === "string" && /^[0-9]+$/u.test(id);
}

export function matchesStructuredMinutesRequest(data, municipalitySlug, id) {
  return isStructuredMinutesRequest(municipalitySlug, id)
    && data?.source_document?.municipality_id === municipalitySlug
    && data?.source_document?.id === `${municipalitySlug}-${id}`;
}

export function isMeetingDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function hasReview(extraction) {
  return typeof extraction?.reviewed_by === "string" && extraction.reviewed_by.trim().length > 0
    && typeof extraction.reviewed_at === "string" && /^\d{4}-\d{2}-\d{2}T/u.test(extraction.reviewed_at)
    && isMeetingDate(extraction.reviewed_at.slice(0, 10)) && Number.isFinite(Date.parse(extraction.reviewed_at));
}

function hasSourcePosition(position) {
  return (Number.isInteger(position?.document_char_start) && position.document_char_start >= 0
      && Number.isInteger(position.document_char_end) && position.document_char_end > position.document_char_start)
    || (typeof position?.dom_path === "string" && position.dom_path.trim().length > 0);
}

export function validateStructuredMinutes(data) {
  const errors = [];
  const warnings = [];
  if (!data?.source_document?.official_url) errors.push("source_document.official_url is required");
  for (const key of ["speakers", "turns", "question_blocks", "topic_blocks", "topic_snippets"]) {
    if (!Array.isArray(data?.[key]) || data[key].some((item) => !item || typeof item !== "object")) errors.push(`${key} must be an array of objects`);
  }
  if (errors.length) return { ok: false, errors, warnings };
  for (const key of ["speakers", "turns", "question_blocks", "topic_blocks", "topic_snippets"]) {
    const ids = new Set();
    for (const item of data[key]) {
      if (typeof item.id !== "string" || !item.id) errors.push(`${key} has an empty id`);
      if (ids.has(item.id)) errors.push(`${key} id is duplicated: ${item.id}`);
      ids.add(item.id);
    }
  }
  const turns = new Map(data.turns.map((turn) => [turn.id, turn]));
  const questions = new Map(data.question_blocks.map((question) => [question.id, question]));
  const topics = new Map(data.topic_blocks.map((topic) => [topic.id, topic]));
  const snippets = new Map(data.topic_snippets.map((snippet) => [snippet.id, snippet]));
  for (const turn of data.turns) {
    if (typeof turn.text_original !== "string" || !turn.source_position?.official_url) errors.push(`turn ${turn.id} is missing text_original or source URL`);
  }
  for (const question of data.question_blocks) {
    if (!Array.isArray(question.turn_ids) || question.turn_ids.some((id) => !turns.has(id))
      || !turns.has(question.start_turn_id) || !turns.has(question.end_turn_id)) errors.push(`question_block ${question.id} references missing turns`);
    if (!Array.isArray(question.agenda_titles) || !Array.isArray(question.topic_block_ids)
      || question.topic_block_ids.some((id) => !topics.has(id))) errors.push(`question_block ${question.id} has invalid topics`);
  }
  for (const snippet of data.topic_snippets) {
    const turn = turns.get(snippet.turn_id);
    if (!turn || typeof turn.text_original !== "string" || !topics.has(snippet.topic_block_id)
      || !snippet.source_position?.official_url
      || !Number.isInteger(snippet.turn_char_start) || snippet.turn_char_start < 0
      || !Number.isInteger(snippet.turn_char_end) || snippet.turn_char_end <= snippet.turn_char_start
      || snippet.turn_char_end > turn.text_original.length
      || turn.text_original.slice(snippet.turn_char_start, snippet.turn_char_end) !== snippet.text_original) {
      errors.push(`topic_snippet ${snippet.id} has invalid source, references or exact substring range`);
    }
  }
  for (const topic of data.topic_blocks) {
    if (!questions.has(topic.question_block_id) || !Array.isArray(topic.flow)
      || topic.flow.some((item) => !turns.has(item?.turn_id) || (item.snippet_id && snippets.get(item.snippet_id)?.topic_block_id !== topic.id))
      || !Array.isArray(topic.related_turn_ids) || topic.related_turn_ids.some((id) => !turns.has(id))
      || !Array.isArray(topic.topic_snippet_ids) || topic.topic_snippet_ids.some((id) => snippets.get(id)?.topic_block_id !== topic.id)) {
      errors.push(`topic_block ${topic.id} has invalid references`);
    }
    if (topic.public_visible) {
      const roles = new Set((Array.isArray(topic.flow) ? topic.flow : []).map((item) => item?.role));
      if (!roles.has("question") || !roles.has("answer")) errors.push(`public topic_block ${topic.id} must include question and answer`);
      if (topic.review_status !== "reviewed" || !hasReview(topic.extraction)) warnings.push(`topic_block ${topic.id}: publication withheld until documented review`);
    }
  }
  const invalidDates = [data.source_document, ...data.turns, ...data.question_blocks].filter((item) => !isMeetingDate(item.meeting_date)).length;
  if (invalidDates) warnings.push(`${invalidDates} meeting dates are unknown or invalid`);
  warnings.push("legacy provenance and generation freshness are unverified; this is not a validated v2 record");
  return { ok: errors.length === 0, errors, warnings };
}

export function normalizeStructuredMinutes(data) {
  const validation = validateStructuredMinutes(data);
  if (!validation.ok) return { data: null, validation };
  const date = (value) => isMeetingDate(value) ? value : "";
  const extraction = (value) => value?.method === "rule_based_with_manual_review" && !hasReview(value)
    ? { ...value, method: "rule_based" } : value;
  const topicBlocks = data.topic_blocks.map((topic) => ({
    ...topic,
    public_visible: Boolean(topic.public_visible && topic.review_status === "reviewed" && hasReview(topic.extraction)),
    review_status: topic.review_status === "reviewed" && !hasReview(topic.extraction) ? "needs_review" : topic.review_status,
    extraction: extraction(topic.extraction),
  }));
  return {
    validation,
    data: {
      ...data,
      source_document: { ...data.source_document, meeting_date: date(data.source_document.meeting_date) },
      turns: data.turns.map((turn) => ({ ...turn, meeting_date: date(turn.meeting_date), extraction: extraction(turn.extraction) })),
      question_blocks: data.question_blocks.map((question) => ({ ...question, meeting_date: date(question.meeting_date), extraction: extraction(question.extraction) })),
      topic_blocks: topicBlocks,
      topic_snippets: data.topic_snippets.map((snippet) => ({ ...snippet, extraction: extraction(snippet.extraction) })),
      read_quality: {
        contract: "legacy-v1-safe-read",
        unknown_date_count: [data.source_document, ...data.turns, ...data.question_blocks].filter((item) => !isMeetingDate(item.meeting_date)).length,
        withheld_topic_count: data.topic_blocks.filter((topic, index) => topic.public_visible && !topicBlocks[index].public_visible).length,
        missing_source_position_count: data.turns.filter((turn) => !hasSourcePosition(turn.source_position)).length,
        provenance_status: "unverified",
        freshness_status: "unverified",
      },
    },
  };
}
