#!/usr/bin/env node

import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { normalizeStructuredMinutes } from "../site/src/lib/structured-minutes/read-contract.mjs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const EXTRACTOR_VERSION = "pdf-style-structured-minutes-v2-2026-09-07";

function compact(value) {
  return String(value ?? "").replace(/[ \t　]/g, "").trim();
}

function normalizeText(value) {
  return String(value ?? "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function parseScheduleDate(year, scheduleName) {
  const normalizedYear = String(year ?? "").normalize("NFKC").trim();
  if (!/^\d{4}$/u.test(normalizedYear)) return "";

  const normalizedName = String(scheduleName ?? "").normalize("NFKC");
  const numericYear = Number(normalizedYear);
  const japaneseMatch = normalizedName.match(/(\d{1,2})月\s*(\d{1,2})日/u);
  const eraMatch = normalizedName.match(/(?:^|[^A-Z0-9])([RH])(\d{1,2})[./-](\d{1,2})[./-](\d{1,2})(?!\d)/iu);
  const gregorianMatch = normalizedName.match(/(?:^|\D)(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?!\d)/u);

  let month;
  let day;
  if (japaneseMatch) {
    month = Number(japaneseMatch[1]);
    day = Number(japaneseMatch[2]);
  } else if (eraMatch) {
    const eraYear = Number(eraMatch[2]);
    const gregorianYear = eraMatch[1].toUpperCase() === "R" ? 2018 + eraYear : 1988 + eraYear;
    if (gregorianYear !== numericYear) return "";
    month = Number(eraMatch[3]);
    day = Number(eraMatch[4]);
  } else if (gregorianMatch) {
    if (Number(gregorianMatch[1]) !== numericYear) return "";
    month = Number(gregorianMatch[2]);
    day = Number(gregorianMatch[3]);
  } else {
    return "";
  }

  const date = new Date(Date.UTC(numericYear, month - 1, day));
  if (
    date.getUTCFullYear() !== numericYear ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return "";
  }

  return `${normalizedYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function stableId(value) {
  return compact(value)
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function normalizeSpeakerName(value) {
  return compact(value).replace(/(?:君|議員)$/u, "");
}

function readMunicipalityName(slug) {
  const fp = path.join(PROJECT_ROOT, "site", "data", "municipalities.json");
  try {
    const items = JSON.parse(fsSync.readFileSync(fp, "utf8"));
    return items.find((item) => item.slug === slug)?.name ?? slug;
  } catch {
    return slug;
  }
}

function officialUrlFallback(slug, councilId) {
  const fp = path.join(PROJECT_ROOT, "site", "data", "municipalities.json");
  try {
    const items = JSON.parse(fsSync.readFileSync(fp, "utf8"));
    const item = items.find((entry) => entry.slug === slug);
    if (item?.gijiroku_subdomain) {
      return `https://${item.gijiroku_subdomain}.gijiroku.com/voices/`;
    }
  } catch {}
  return `/${slug}/minutes/${councilId}`;
}

function speakerType(role) {
  const normalized = compact(role);
  if (normalized.includes("議長")) return "chair";
  if (normalized.includes("副議長")) return "chair";
  if (normalized.includes("委員長")) return "committee_chair";
  if (normalized.includes("議員")) return "council_member";
  if (/^[0-9０-９]+番$/u.test(normalized)) return "council_member";
  if (normalized.includes("副町長") || normalized.includes("副市長") || normalized.includes("副村長")) {
    return "vice_mayor";
  }
  if (normalized.includes("町長") || normalized.includes("市長") || normalized.includes("村長")) {
    return "mayor";
  }
  if (normalized.includes("教育長")) return "education_board";
  if (/(部長|課長|局長|主幹|係長|参与|所長|園長|次長|管理者|委員|会長)/u.test(normalized)) {
    return "executive";
  }
  return "unknown";
}

function turnTypeFromSpeaker(type) {
  if (type === "council_member" || type === "committee_chair") return "question";
  if (type === "chair") return "procedure";
  if (type === "unknown") return "unknown";
  return "answer";
}

function extraction(confidence = 0.72, warnings = []) {
  return {
    method: "rule_based",
    confidence,
    extractor_version: EXTRACTOR_VERSION,
    warnings,
  };
}

function sourcePosition(url, localAnchor, searchHint, extra = {}) {
  return {
    official_url: url,
    local_anchor: localAnchor,
    search_hint: searchHint,
    ...extra,
  };
}

function parseSpeakerHeader(line) {
  const value = String(line).trim();
  const parenMatch = value.match(/^[○〇◎◆]\s*([^（\n]{1,30})（([^）]{1,30})(?:君)?）\s*(.*)$/u);
  if (parenMatch) {
    const roleOriginal = parenMatch[1].trim();
    const role = compact(roleOriginal);
    if (/^(出席議員|欠席議員|説明員|事務従事者|本日の会議に付した事件)$/u.test(role)) return null;
    const name = normalizeSpeakerName(parenMatch[2]);
    const type = speakerType(role);
    const suffix =
      type === "council_member" || type === "committee_chair"
        ? "議員"
        : role.replace(/[0-9０-９]+番/u, "議員");
    return {
      name,
      roleOriginal,
      role,
      speakerType: type,
      displayName: `${name}${suffix}`,
      rest: parenMatch[3] ?? "",
    };
  }

  const simpleMatch = value.match(/^[○〇◎◆]\s*([^　\s。]{1,30})(?:君)?[　\s]*(.*)$/u);
  if (!simpleMatch) return null;
  const label = normalizeSpeakerName(simpleMatch[1]);
  const rest = simpleMatch[2] ?? "";
  if (!rest.trim()) return null;
  if (/^[…・\.．\d０-９－—―‐-]+$/u.test(compact(rest))) return null;
  if (/^(異議なし|議長|はい|なし|発言|説明員|出席議員|欠席議員|事務従事者|議事日程)$/u.test(label)) return null;

  const titleMatch = label.match(
    /^(.*?)(副議長|議長|委員長|副市長|副町長|副村長|市長|町長|村長|教育長|事務局長|部長|課長|局長|主幹|係長|参与|所長|園長|次長|管理者|会長|議員|委員)$/u
  );
  const roleOriginal = titleMatch?.[2] ?? "議員";
  const role = compact(roleOriginal);
  const name = titleMatch?.[1] ? compact(titleMatch[1]) : label;
  const type = speakerType(role);
  const suffix =
    type === "council_member" || type === "committee_chair"
      ? "議員"
      : role.replace(/[0-9０-９]+番/u, "議員");
  return {
    name,
    roleOriginal,
    role,
    speakerType: type,
    displayName: `${name}${suffix}`,
    rest,
  };
}

function parseTurns({ slug, councilId, year, schedule, minute, sourceDocumentId, officialUrl }) {
  const text = normalizeText(minute.text ?? "");
  const lines = text.split("\n");
  const turns = [];
  const meetingDate = parseScheduleDate(year, schedule.name);
  let current = null;
  let currentLines = [];
  let currentStartLine = 1;

  const flush = (lineNumber) => {
    if (!current) return;
    const body = normalizeText(currentLines.join("\n"));
    if (body) {
      const order = turns.length + 1;
      const id = `${slug}-${councilId}-${schedule.schedule_id}-turn-${String(order).padStart(3, "0")}`;
      turns.push({
        id,
        source_document_id: sourceDocumentId,
        municipality_id: slug,
        meeting_date: meetingDate,
        order_index: order,
        speaker_name_original: current.displayName,
        speaker_name_normalized: current.name,
        speaker_role_original: current.roleOriginal,
        speaker_type: current.speakerType,
        turn_type: turnTypeFromSpeaker(current.speakerType),
        text_original: body,
        text_normalized: body.replace(/\s+/g, " ").trim(),
        source_position: sourcePosition(
          minute.source_url ?? officialUrl,
          id,
          `${current.displayName} ${body.replace(/\s+/g, " ").slice(0, 60)}`,
          {
            heading_path: [schedule.name],
          }
        ),
        extraction: extraction(current.speakerType === "unknown" ? 0.45 : 0.76),
        _sourceLine: currentStartLine,
        _endLine: Math.max(currentStartLine, lineNumber),
      });
    }
    current = null;
    currentLines = [];
  };

  for (const [index, rawLine] of lines.entries()) {
    const parsed = parseSpeakerHeader(rawLine.trim());
    if (parsed) {
      flush(index);
      current = parsed;
      currentStartLine = index + 1;
      if (parsed.rest.trim()) currentLines.push(parsed.rest);
      continue;
    }
    if (current) currentLines.push(rawLine);
  }
  flush(lines.length);

  return turns.map((turn, index) => ({ ...turn, order_index: index + 1 }));
}

function titleFromQuestion(text, fallback) {
  const source = text.replace(/\s+/g, " ");
  const patterns = [
    /質問事項[0-9０-９]+番目[、，]\s*([^。]{4,90})/u,
    /件名[0-9０-９]+[、，]\s*([^。]{4,90})/u,
    /第[0-9０-９]+点目(?:として)?[、，]\s*([^。]{4,90})/u,
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match?.[1]) {
      const title = match[1].replace(/について(?:伺います|お尋ねします)?$/u, "").trim();
      return title.length > 44 ? fallback : title;
    }
  }
  return fallback;
}

function policyTagsFor(title) {
  const tags = [];
  if (/病院|医療|診療|保健|介護/u.test(title)) tags.push("医療・福祉");
  if (/教育|学校|子ども|子供|給食/u.test(title)) tags.push("教育・子育て");
  if (/道路|駅|交通|施設|公園|住宅|まち/u.test(title)) tags.push("まちづくり");
  if (/農業|漁業|商工|観光|ふるさと納税/u.test(title)) tags.push("産業・観光");
  if (/防災|災害|避難/u.test(title)) tags.push("防災");
  return [...new Set(tags)];
}

function snippetText(turn) {
  const max = turn.turn_type === "answer" ? 1800 : 1400;
  if (turn.text_original.length <= max) return turn.text_original;
  const cut = turn.text_original.slice(0, max);
  const end = Math.max(cut.lastIndexOf("。"), cut.lastIndexOf("\n\n"));
  return end > 400 ? turn.text_original.slice(0, end + 1) : cut;
}

function buildBlocks({ slug, councilId, sourceDocumentId, turns, officialUrl }) {
  const questionBlocks = [];
  const topicBlocks = [];
  const topicSnippets = [];
  let current = null;

  const close = () => {
    if (!current) return;
    const hasQuestion = current.turns.some((turn) => turn.turn_type === "question");
    const hasAnswer = current.turns.some((turn) => turn.turn_type === "answer" || turn.turn_type === "re_answer");
    if (hasQuestion && hasAnswer) {
      const order = questionBlocks.length + 1;
      const questionTurn = current.turns.find((turn) => turn.turn_type === "question") ?? current.turns[0];
      const title = titleFromQuestion(questionTurn.text_original, `${questionTurn.speaker_name_original}の質問`);
      const questionBlockId = `${slug}-${councilId}-question-${String(order).padStart(3, "0")}`;
      const topicBlockId = `${questionBlockId}-topic-001`;
      const blockTurnIds = current.turns.map((turn) => turn.id);

      questionBlocks.push({
        id: questionBlockId,
        source_document_id: sourceDocumentId,
        municipality_id: slug,
        meeting_date: questionTurn.meeting_date,
        order_index: order,
        questioner_name_original: questionTurn.speaker_name_original,
        questioner_name_normalized: questionTurn.speaker_name_normalized,
        question_method: "unknown",
        title_original: `${questionTurn.speaker_name_original}の質問`,
        agenda_titles: [title],
        turn_ids: blockTurnIds,
        topic_block_ids: [topicBlockId],
        start_turn_id: blockTurnIds[0],
        end_turn_id: blockTurnIds[blockTurnIds.length - 1],
        source_position: sourcePosition(officialUrl, questionBlockId, questionTurn.speaker_name_original),
        extraction: extraction(0.68, ["pdf_style_grouping"]),
      });

      const roleCounts = { question: 0, answer: 0 };
      const snippetIds = [];
      const flow = [];
      for (const [snippetIndex, turn] of current.turns.entries()) {
        if (!["question", "answer"].includes(turn.turn_type)) continue;
        const text = snippetText(turn);
        const start = turn.text_original.indexOf(text);
        if (start < 0) continue;
        const isQuestion = turn.turn_type === "question";
        let snippetRole;
        if (isQuestion) {
          roleCounts.question += 1;
          snippetRole = roleCounts.answer > 0 && roleCounts.question > 1 ? "re_question" : "question";
        } else {
          roleCounts.answer += 1;
          snippetRole = roleCounts.answer > 1 ? "re_answer" : "answer";
        }
        if (isQuestion && snippetIndex === current.turns.length - 1 && roleCounts.answer > 0) {
          snippetRole = "request";
        }
        const snippetId = `${topicBlockId}-snippet-${String(snippetIds.length + 1).padStart(2, "0")}`;
        const snippet = {
          id: snippetId,
          topic_block_id: topicBlockId,
          turn_id: turn.id,
          order_index: snippetIds.length + 1,
          snippet_role: snippetRole,
          text_original: text,
          turn_char_start: start,
          turn_char_end: start + text.length,
          source_position: sourcePosition(
            turn.source_position.official_url || officialUrl,
            snippetId,
            `${turn.speaker_name_original} ${text.replace(/\s+/g, " ").slice(0, 60)}`,
            {
              turn_char_start: start,
              turn_char_end: start + text.length,
            }
          ),
          extraction: extraction(text.length === turn.text_original.length ? 0.7 : 0.6, text.length === turn.text_original.length ? [] : ["trimmed_snippet"]),
        };
        topicSnippets.push(snippet);
        snippetIds.push(snippetId);
        flow.push({
          role: snippetRole === "request" ? "request" : snippetRole,
          turn_id: turn.id,
          snippet_id: snippetId,
          speaker_name_original: turn.speaker_name_original,
          label: snippetRole,
        });
      }

      topicBlocks.push({
        id: topicBlockId,
        question_block_id: questionBlockId,
        source_document_id: sourceDocumentId,
        order_index: topicBlocks.length + 1,
        title_original: title,
        title_normalized: title,
        policy_area_tags: policyTagsFor(title),
        topic_tags: [],
        respondent_speaker_ids: [],
        related_turn_ids: blockTurnIds,
        topic_snippet_ids: snippetIds,
        flow,
        source_position: sourcePosition(officialUrl, topicBlockId, title),
        review_status: "needs_review",
        public_visible: false,
        extraction: extraction(0.58, ["pdf_style_mvp_needs_review"]),
      });
    }
    current = null;
  };

  for (const turn of turns) {
    if (turn.turn_type === "question" && turn.text_original.length > 40) {
      close();
      current = { turns: [turn] };
      continue;
    }
    if (!current) continue;
    if (turn.turn_type === "procedure") continue;
    if (turn.turn_type === "answer") {
      current.turns.push(turn);
    }
  }
  close();

  return { questionBlocks, topicBlocks, topicSnippets };
}

async function writeJson(fp, data) {
  await fs.mkdir(path.dirname(fp), { recursive: true });
  await fs.writeFile(fp, JSON.stringify(data, null, 2) + "\n");
}

async function main() {
  const [slug, councilId] = process.argv.slice(2);
  if (!slug || !councilId) {
    console.error("Usage: node scripts/build-pdf-style-structured-minutes.mjs <slug> <councilId>");
    process.exit(1);
  }

  const sourcePath = path.join(PROJECT_ROOT, "site", "data", slug, "minutes", `${councilId}.json`);
  const inputText = await fs.readFile(sourcePath, "utf8");
  const raw = JSON.parse(inputText);
  const municipalityName = readMunicipalityName(slug);
  const sourceDocumentId = `${slug}-${councilId}`;
  const schedules = raw.schedules ?? [];
  const officialUrl =
    schedules.flatMap((schedule) => schedule.minutes ?? []).find((minute) => minute.source_url)?.source_url ??
    officialUrlFallback(slug, councilId);
  const turns = [];
  const speakersByKey = new Map();

  for (const schedule of schedules) {
    for (const minute of schedule.minutes ?? []) {
      const parsedTurns = parseTurns({
        slug,
        councilId,
        year: raw.year,
        schedule,
        minute,
        sourceDocumentId,
        officialUrl,
      });
      turns.push(...parsedTurns.map((turn) => ({ ...turn, order_index: turns.length + turn.order_index })));
    }
  }

  for (const turn of turns) {
    const key = `${turn.speaker_name_normalized}-${turn.speaker_role_original}`;
    if (!speakersByKey.has(key)) {
      speakersByKey.set(key, {
        id: `${slug}-speaker-${stableId(key)}`,
        municipality_id: slug,
        name_original: turn.speaker_name_normalized,
        name_normalized: turn.speaker_name_normalized,
        role_original: turn.speaker_role_original,
        speaker_type: turn.speaker_type,
        aliases: [turn.speaker_name_original],
      });
    }
    turn.speaker_id = speakersByKey.get(key).id;
    delete turn._sourceLine;
    delete turn._endLine;
  }

  const { questionBlocks, topicBlocks, topicSnippets } = buildBlocks({
    slug,
    councilId,
    sourceDocumentId,
    turns,
    officialUrl,
  });

  const output = {
    generation: {
      generated_at: new Date().toISOString(),
      generator: EXTRACTOR_VERSION,
      input_path: path.relative(PROJECT_ROOT, sourcePath),
      input_sha256: createHash("sha256").update(inputText).digest("hex"),
    },
    source_document: {
      id: sourceDocumentId,
      municipality_id: slug,
      municipality_name: municipalityName,
      official_url: officialUrl,
      title: raw.name,
      meeting_date:
        schedules.map((schedule) => parseScheduleDate(raw.year, schedule.name)).find(Boolean) ?? "",
      fetched_at: "unknown",
      source_type: officialUrl.endsWith(".pdf") ? "official_pdf" : "official_html",
      extractor_version: EXTRACTOR_VERSION,
    },
    speakers: [...speakersByKey.values()],
    turns,
    question_blocks: questionBlocks,
    topic_blocks: topicBlocks,
    topic_snippets: topicSnippets,
  };

  const rootOut = path.join(PROJECT_ROOT, "data", "structured-minutes", slug, `${councilId}.json`);
  const siteOut = path.join(PROJECT_ROOT, "site", "data", "structured-minutes", slug, `${councilId}.json`);
  const normalized = normalizeStructuredMinutes(output);
  if (!normalized.data) throw new Error(normalized.validation.errors.join("; "));
  const { read_quality: _quality, ...publishedOutput } = normalized.data;
  await writeJson(rootOut, publishedOutput);
  await writeJson(siteOut, publishedOutput);
  console.log(
    `[${slug}] structured ${turns.length} turns / ${questionBlocks.length} question_blocks / ${topicBlocks.length} topic_blocks / ${topicSnippets.length} snippets`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
