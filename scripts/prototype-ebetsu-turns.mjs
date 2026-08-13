#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const SLUG = "ebetsu";

const ADMIN_ROLE_KEYWORDS = [
  "市長",
  "副市長",
  "教育長",
  "管理者",
  "部長",
  "局長",
  "課長",
  "次長",
  "事務長",
  "調整監",
];

const CHAIR_ROLE_KEYWORDS = ["議長", "副議長"];

const GENERIC_TOPIC_MATCH_TERMS = new Set([
  "ついて",
  "支援",
  "情報",
  "取組",
  "取り組み",
  "対応",
  "活用",
]);

function compactName(value) {
  return String(value ?? "")
    .replace(/[ \t　]/g, "")
    .replace(/君$/u, "")
    .trim();
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripPageFooter(value) {
  return normalizeText(
    String(value ?? "").replace(/\n*このページに関するお問い合わせ先[\s\S]*$/u, "")
  );
}

function normalizeRole(value) {
  return String(value ?? "").replace(/[ \t　]/g, "").trim();
}

function parseScheduleDate(year, scheduleName) {
  const normalized = String(scheduleName ?? "").normalize("NFKC");
  const match = normalized.match(/(\d{1,2})月(\d{1,2})日/u);
  if (!match) return null;
  return `${year}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

function questionMethodFromNotice(text) {
  if (/一問一答方式/u.test(text)) return "itemized";
  if (/(?:総括質問総括答弁|一括質問一括答弁)方式/u.test(text)) {
    return "comprehensive";
  }
  return "unknown";
}

function speakerType(role) {
  if (CHAIR_ROLE_KEYWORDS.some((keyword) => role.includes(keyword))) return "chair";
  if (role.includes("事務局") || role.includes("書記")) return "secretariat";
  if (ADMIN_ROLE_KEYWORDS.some((keyword) => role.includes(keyword))) {
    return "administration";
  }
  if (role.includes("議員")) return "member";
  return "other";
}

function turnType(type, scheduleName) {
  const isGeneralQuestion = String(scheduleName ?? "").includes("一般質問");
  if (type === "member") return isGeneralQuestion ? "question" : "other";
  if (type === "administration") return isGeneralQuestion ? "answer" : "other";
  if (type === "chair") return "chair";
  return "other";
}

function extractTopicHeadings(text) {
  const source = String(text ?? "").replace(/\s+/g, " ");
  const patterns = [
    /(?:まず、|次に、|それから、|続いて、)?[0-9０-９]+点目(?:に|は|として)?[、，][^。]{3,180}について(?:質問いたします|お伺いを?(?:いた|致)?します|です)[、。]/gu,
    /(?:まず、|次に、|それから、|続いて、)?[0-9０-９]+点目(?:に|は|として)?[、，][^。]{3,180}に関して(?:質問いたします|お伺いを?(?:いた|致)?します|です)[、。]/gu,
    /次の質問(?:は|として)[、，][^。]{3,180}について(?:質問いたします|お伺いを?(?:いた|致)?します|です)[、。]/gu,
    /件名[0-9０-９]+[、，][^。]{3,80}についてであります。/gu,
    /第[0-9０-９]+点目(?:として)?[、，][^。]{3,100}についてであります。/gu,
    /(?:次に|それから)[、，][0-9０-９]+点目[、，][^。]{3,100}についてであります。/gu,
    /次に、[^。]{3,100}について(?:御答弁を申し上げます|であります(?:が)?)[、。]/gu,
    /(?:まず|初めに)、[^。]{3,100}について(?:御答弁を申し上げます|であります(?:が)?)[、。]/gu,
  ];
  const headings = [];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const heading = match[0].trim();
      if (!headings.includes(heading)) headings.push(heading);
    }
  }
  return headings;
}

function normalizeTopicTitle(heading) {
  return String(heading ?? "")
    .replace(/^まず、/u, "")
    .replace(/^次に、/u, "")
    .replace(/^初めに、/u, "")
    .replace(/^それから、/u, "")
    .replace(/^続いて、/u, "")
    .replace(/^次の質問(?:は|として)[、，]/u, "")
    .replace(/^件名[0-9０-９]+[、，]/u, "")
    .replace(/^[0-9０-９]+件目(?:として|の)?[、，]/u, "")
    .replace(/^第[0-9０-９]+点目(?:として)?[、，]/u, "")
    .replace(/^[0-9０-９]+点目(?:に|は|として)?[、，]/u, "")
    .replace(/^この間大きな話題となっている、いわゆる/u, "")
    .replace(/について(?:御答弁を申し上げます|であります(?:が)?)[、。]?$/u, "")
    .replace(/について(?:質問いたします|お伺いを?(?:いた|致)?します|です)[、。]?$/u, "")
    .replace(/に関して(?:質問いたします|お伺いを?(?:いた|致)?します|です)[、。]?$/u, "")
    .replace(/(?:質問いたします|お伺いを?(?:いた|致)?します)[、。]?$/u, "")
    .replace(/。$/u, "")
    .trim();
}

function compactTopicTitle(value) {
  return normalizeTopicTitle(value)
    .normalize("NFKC")
    .replace(/[ \t\n　、，。・「」『』（）()]/g, "");
}

function canonicalTopicTitle(value) {
  return compactTopicTitle(value)
    .replace(/についての/gu, "")
    .replace(/第(?=[0-9])/gu, "");
}

function isSameTopicTitle(left, right) {
  const compactLeft = canonicalTopicTitle(left);
  const compactRight = canonicalTopicTitle(right);
  if (!compactLeft || !compactRight) return false;
  const shorter = Math.min(compactLeft.length, compactRight.length);
  const longer = Math.max(compactLeft.length, compactRight.length);
  const isSpecificEnough = shorter / longer >= 0.82;
  return (
    compactLeft === compactRight ||
    (isSpecificEnough && (compactLeft.includes(compactRight) || compactRight.includes(compactLeft)))
  );
}

function topicKeywords(title) {
  return String(title ?? "")
    .split(/[、，・のにとをがはへで\s　]+/u)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3 && !/^(次に|初めに|項目|件名)$/u.test(part));
}

function topicMatchTerms(title) {
  return String(title ?? "")
    .normalize("NFKC")
    .split(/[、，・のにとをがはへで\s　]+/u)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2 && !/^(次に|初めに|項目|件名|ついて)$/u.test(part));
}

function textMatchesTopic(text, title) {
  const compactText = compactTopicTitle(text);
  const compactTitle = compactTopicTitle(title);
  if (!compactText || !compactTitle) return false;
  if (compactText.includes(compactTitle)) return true;

  const terms = topicMatchTerms(title);
  if (terms.length === 0) return false;
  const subject = compactTopicTitle(terms[0]);
  if (!subject || !compactText.includes(subject)) return false;

  const remaining = terms.slice(1);
  if (remaining.length === 0) return false;
  const specificTerms = remaining.filter((term) => !GENERIC_TOPIC_MATCH_TERMS.has(term));
  const requiredTerms = specificTerms.length > 0 ? specificTerms : remaining;
  const matches = requiredTerms.filter((term) => compactText.includes(compactTopicTitle(term))).length;
  const requiredMatches = requiredTerms.length <= 2 ? requiredTerms.length : 2;
  return matches >= requiredMatches;
}

function turnMatchesTopic(turn, title, heading) {
  if (
    turn.topic_headings?.some(
      (candidate) => candidate === heading || isSameTopicTitle(candidate, title)
    )
  ) {
    return true;
  }
  const text = `${turn.text}\n${(turn.topic_headings ?? []).join("\n")}`;
  return textMatchesTopic(text, title);
}

function topicHeadingRanges(text) {
  const source = String(text ?? "");
  const patterns = [
    /(?:まず、|次に、|それから、|続いて、)?[0-9０-９]+点目(?:に|は|として)?[、，][^。]{3,180}について(?:質問いたします|お伺いを?(?:いた|致)?します|です)[、。]/gu,
    /(?:まず、|次に、|それから、|続いて、)?[0-9０-９]+点目(?:に|は|として)?[、，][^。]{3,180}に関して(?:質問いたします|お伺いを?(?:いた|致)?します|です)[、。]/gu,
    /(?:まず、|次に、|それから、|続いて、)?[0-9０-９]+件目(?:として|の)?[、，][^。]{3,180}について(?:質問いたします|お伺いを?(?:いた|致)?します|です)[、。]/gu,
    /次の質問(?:は|として)[、，][^。]{3,180}について(?:質問いたします|お伺いを?(?:いた|致)?します|です)[、。]/gu,
    /件名[0-9０-９]+[、，][^。]{3,80}についてであります。/gu,
    /第[0-9０-９]+点目(?:として)?[、，][^。]{3,100}についてであります。/gu,
    /(?:次に|それから)[、，][0-9０-９]+点目[、，][^。]{3,100}についてであります。/gu,
    /次に、[^。]{3,100}について(?:御答弁を申し上げます|であります(?:が)?)[、。]/gu,
    /(?:まず|初めに)、[^。]{3,100}について(?:御答弁を申し上げます|であります(?:が)?)[、。]/gu,
  ];
  const ranges = [];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const heading = match[0].replace(/\s+/g, " ").trim();
      ranges.push({
        heading,
        title: normalizeTopicTitle(heading),
        index: match.index ?? 0,
      });
    }
  }
  return ranges.sort((a, b) => a.index - b.index);
}

function sentenceStartBefore(text, index) {
  const before = text.slice(0, Math.max(0, index));
  const candidates = ["\n\n", "。", "？", "！"].map((mark) => before.lastIndexOf(mark));
  const last = Math.max(...candidates);
  return last >= 0 ? last + 1 : Math.max(0, index - 220);
}

function sentenceEndAfter(text, index) {
  const after = text.slice(index);
  const candidates = ["\n\n", "。", "？", "！"]
    .map((mark) => after.indexOf(mark))
    .filter((position) => position >= 0);
  if (candidates.length === 0) return Math.min(text.length, index + 520);
  return Math.min(text.length, index + Math.min(...candidates) + 1);
}

function headingRangeContaining(headings, index, textLength) {
  return headings.find((heading, headingIndex) => {
    const nextHeading = headings[headingIndex + 1];
    const end = nextHeading?.index ?? textLength;
    return heading.index <= index && index < end;
  });
}

function buildTopicSnippet(turn, title) {
  const text = turn.text;
  const headings = topicHeadingRanges(text);
  const titleMatch = headings.find((item) => isSameTopicTitle(item.title, title));
  const topicTerms = topicMatchTerms(title);
  const matchingTerms = topicTerms.slice(1).filter(
    (term) => !GENERIC_TOPIC_MATCH_TERMS.has(term)
  );
  const prioritizedTerms = matchingTerms.length > 0 ? matchingTerms : topicTerms;
  const keywordIndex = prioritizedTerms
    .map((keyword) => text.indexOf(keyword))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];

  if (!titleMatch && (typeof keywordIndex !== "number" || !textMatchesTopic(text, title))) return null;

  const boundaryMatch =
    typeof keywordIndex === "number" ? headingRangeContaining(headings, keywordIndex, text.length) : null;
  const matchedHeading = titleMatch ?? boundaryMatch;
  const matchIndex = matchedHeading?.index ?? keywordIndex;
  const start = matchedHeading?.index ?? sentenceStartBefore(text, matchIndex);
  const nextHeading = headings.find(
    (item) => item.index > start && !isSameTopicTitle(item.title, title)
  );
  const end =
    nextHeading?.index ??
    (matchedHeading ? text.length : sentenceEndAfter(text, Math.max(matchIndex + 1, start + 1)));
  const snippetText = normalizeText(text.slice(start, end));

  if (snippetText.length < 40) return null;

  return {
    turn_id: turn.id,
    speaker_label: turn.speaker_label,
    speaker_role: turn.speaker_role,
    turn_type: turn.turn_type,
    matched_heading: matchedHeading?.heading ?? null,
    text: snippetText,
    text_length: snippetText.length,
    source: turn.source,
  };
}

function parseRosterPairSection(text, startRe, endRe) {
  const start = text.search(startRe);
  if (start < 0) return [];
  const rest = text.slice(start);
  const end = rest.search(endRe);
  const section = end >= 0 ? rest.slice(0, end) : rest;
  const lines = section
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const people = [];

  for (let i = 0; i < lines.length - 1; i += 1) {
    const role = normalizeRole(lines[i]);
    const nameLine = lines[i + 1];
    if (!/君$/u.test(nameLine)) continue;
    const name = compactName(nameLine);
    if (!name) continue;
    people.push({
      name,
      role,
      label: role === "議員" ? `${name}議員` : `${name}${role}`,
    });
    i += 1;
  }

  return people;
}

function extractRoster(text) {
  const members = parseRosterPairSection(text, /1\s*出席議員/u, /2\s*[　\s]*欠席議員/u);
  const admins = parseRosterPairSection(
    text,
    /3\s*[　\s]*説明のため出席した者/u,
    /4\s*[　\s]*事務に従事した事務局員/u
  );
  const secretariat = parseRosterPairSection(
    text,
    /4\s*[　\s]*事務に従事した事務局員/u,
    /5\s*[　\s]*議事日程/u
  );

  const byName = new Map();
  for (const person of [...members, ...admins, ...secretariat]) {
    byName.set(person.name, person);
  }
  return { members, admins, secretariat, byName };
}

function trimToProceedings(text) {
  const markers = [
    /6\s*[　\s]*議事次第/u,
    /６\s*[　\s]*議事次第/u,
    /◎\s*開議宣告/u,
    /◎\s*開会宣告/u,
  ];
  const indexes = markers
    .map((re) => {
      const m = text.match(re);
      return m ? m.index ?? -1 : -1;
    })
    .filter((index) => index >= 0)
    .sort((a, b) => a - b);
  return indexes.length > 0 ? text.slice(indexes[0]) : text;
}

function parseSpeakerHeader(line, roster) {
  const paren = line.match(/^(.{1,30}?)（(.{1,30}?君)）$/u);
  if (paren) {
    const role = normalizeRole(paren[1]);
    const name = compactName(paren[2]);
    return {
      name,
      role,
      label: role === "議員" ? `${name}議員` : `${name}${role}`,
    };
  }

  const bareName = line.match(/^(.{2,12}?君)$/u);
  if (bareName) {
    const name = compactName(bareName[1]);
    const person = roster.byName.get(name);
    if (!person) return null;
    return person;
  }

  return null;
}

function buildTurnsForSchedule({ slug, councilId, councilName, schedule, year }) {
  const rawMinute = schedule.minutes?.[0];
  const rawText = normalizeText(rawMinute?.text ?? "");
  const roster = extractRoster(rawText);
  const proceedings = trimToProceedings(rawText);
  const meetingDate = parseScheduleDate(year, schedule.name);
  const lines = proceedings.split("\n");
  const turns = [];
  let current = null;
  let currentLines = [];
  let currentStartLine = 1;

  const flush = (endLine) => {
    if (!current) return;
    const text = stripPageFooter(currentLines.join("\n"));
    if (text.length > 0) {
      const type = speakerType(current.role);
      const ordinal = turns.length + 1;
      turns.push({
        id: `${slug}-${councilId}-${schedule.schedule_id}-turn-${String(ordinal).padStart(3, "0")}`,
        municipality: slug,
        council_id: councilId,
        council_name: councilName,
        schedule_id: schedule.schedule_id,
        schedule_name: schedule.name,
        meeting_date: meetingDate,
        year,
        source_url: rawMinute?.source_url ?? null,
        speaker_label: current.label,
        speaker_name: current.name,
        speaker_role: current.role,
        speaker_type: type,
        turn_type: turnType(type, schedule.name),
        topic_headings: extractTopicHeadings(text),
        text,
        text_length: text.length,
        source: {
          minutes_file: `data/${slug}/minutes/${councilId}.json`,
          schedule_id: schedule.schedule_id,
          raw_minute_id: rawMinute?.minute_id ?? null,
          start_line: currentStartLine,
          end_line: Math.max(currentStartLine, endLine),
        },
      });
    }
    current = null;
    currentLines = [];
  };

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    const speaker = parseSpeakerHeader(line, roster);
    if (speaker) {
      flush(index);
      current = speaker;
      currentStartLine = index + 1;
      return;
    }
    if (current) currentLines.push(rawLine);
  });
  flush(lines.length);

  return {
    schedule_id: schedule.schedule_id,
    schedule_name: schedule.name,
    meeting_date: meetingDate,
    source_url: rawMinute?.source_url ?? null,
    roster: {
      members: roster.members,
      administrations: roster.admins,
      secretariat: roster.secretariat,
    },
    turns,
  };
}

function buildQuestionBlocks(slug, councilId, scheduleResult) {
  if (!scheduleResult.schedule_name.includes("一般質問")) return [];

  const blocks = [];
  let current = null;
  const turnsById = new Map(scheduleResult.turns.map((turn) => [turn.id, turn]));

  const findQuestionMethod = (turnIndex, questionerName) => {
    for (let index = turnIndex - 1; index >= Math.max(0, turnIndex - 4); index -= 1) {
      const candidate = scheduleResult.turns[index];
      if (candidate.speaker_type !== "chair") continue;
      if (!candidate.text.includes("質問を許します")) continue;
      if (!compactName(candidate.text).includes(compactName(questionerName))) continue;
      return questionMethodFromNotice(candidate.text);
    }
    return "unknown";
  };

  const close = () => {
    if (!current) return;
    current.question_turn_count = current.question_turn_ids.length;
    current.answer_turn_count = current.answer_turn_ids.length;
    const topicHeadings = [];
    for (const id of [...current.question_turn_ids, ...current.answer_turn_ids]) {
      const turn = turnsById.get(id);
      for (const heading of turn?.topic_headings ?? []) {
        if (!topicHeadings.includes(heading)) topicHeadings.push(heading);
      }
    }
    current.topic_headings = topicHeadings;
    blocks.push(current);
    current = null;
  };

  for (const [turnIndex, turn] of scheduleResult.turns.entries()) {
    if (turn.speaker_type === "member") {
      if (!current || current.questioner_name !== turn.speaker_name) {
        close();
        current = {
          id: `${slug}-${councilId}-${scheduleResult.schedule_id}-question-${String(blocks.length + 1).padStart(3, "0")}`,
          municipality: slug,
          council_id: councilId,
          schedule_id: scheduleResult.schedule_id,
          schedule_name: scheduleResult.schedule_name,
          meeting_date: scheduleResult.meeting_date,
          source_url: scheduleResult.source_url,
          questioner_name: turn.speaker_name,
          questioner_label: turn.speaker_label,
          question_method: findQuestionMethod(turnIndex, turn.speaker_name),
          turn_ids: [],
          question_turn_ids: [],
          answer_turn_ids: [],
          answer_speaker_labels: [],
          excerpt: "",
        };
      }
      current.turn_ids.push(turn.id);
      current.question_turn_ids.push(turn.id);
      if (!current.excerpt) current.excerpt = turn.text.replace(/\s+/g, " ").slice(0, 160);
      continue;
    }

    if (turn.speaker_type === "administration" && current) {
      current.turn_ids.push(turn.id);
      current.answer_turn_ids.push(turn.id);
      if (!current.answer_speaker_labels.includes(turn.speaker_label)) {
        current.answer_speaker_labels.push(turn.speaker_label);
      }
    }
  }

  close();
  return blocks;
}

function buildTopicBlocks(slug, councilId, questionBlocks, turns) {
  const turnsById = new Map(turns.map((turn) => [turn.id, turn]));
  const blocks = [];

  for (const questionBlock of questionBlocks) {
    const blockTurns = [...questionBlock.question_turn_ids, ...questionBlock.answer_turn_ids]
      .map((id) => turnsById.get(id))
      .filter(Boolean)
      .sort((a, b) => a.source.start_line - b.source.start_line);
    const seenTitles = new Set();

    for (const heading of questionBlock.topic_headings ?? []) {
      const title = normalizeTopicTitle(heading);
      if (
        !title ||
        title.length < 4 ||
        [...seenTitles].some((seenTitle) => isSameTopicTitle(seenTitle, title))
      ) {
        continue;
      }
      seenTitles.add(title);

      const relatedTurns = blockTurns.filter((turn) => turnMatchesTopic(turn, title, heading));
      const questionTurns = relatedTurns.filter((turn) => turn.turn_type === "question");
      const answerTurns = relatedTurns.filter((turn) => turn.turn_type === "answer");
      if (questionTurns.length === 0 && answerTurns.length === 0) continue;

      const answerSpeakerLabels = [];
      for (const turn of answerTurns) {
        if (!answerSpeakerLabels.includes(turn.speaker_label)) {
          answerSpeakerLabels.push(turn.speaker_label);
        }
      }

      const firstTurn = questionTurns[0] ?? answerTurns[0] ?? relatedTurns[0];
      const topicSnippets = relatedTurns
        .map((turn, index) => {
          const snippet = buildTopicSnippet(turn, title);
          if (!snippet) return null;
          return {
            id: `${questionBlock.id}-topic-${String(blocks.length + 1).padStart(3, "0")}-snippet-${String(index + 1).padStart(2, "0")}`,
            ...snippet,
          };
        })
        .filter(Boolean);
      const firstSnippet = topicSnippets[0];
      blocks.push({
        id: `${questionBlock.id}-topic-${String(blocks.length + 1).padStart(3, "0")}`,
        municipality: slug,
        council_id: councilId,
        schedule_id: questionBlock.schedule_id,
        schedule_name: questionBlock.schedule_name,
        source_url: questionBlock.source_url,
        question_block_id: questionBlock.id,
        questioner_name: questionBlock.questioner_name,
        questioner_label: questionBlock.questioner_label,
        title,
        heading,
        keywords: topicKeywords(title),
        turn_ids: relatedTurns.map((turn) => turn.id),
        question_turn_ids: questionTurns.map((turn) => turn.id),
        answer_turn_ids: answerTurns.map((turn) => turn.id),
        answer_speaker_labels: answerSpeakerLabels,
        topic_snippets: topicSnippets,
        excerpt: (firstSnippet?.text ?? firstTurn?.text ?? "").replace(/\s+/g, " ").slice(0, 180),
        question_turn_count: questionTurns.length,
        answer_turn_count: answerTurns.length,
      });
    }
  }

  return blocks;
}

async function copyIfExists(from, to) {
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.copyFile(from, to);
}

async function main() {
  const councilId = process.argv[2] ?? "20241004";
  const minutesPath = path.join(PROJECT_ROOT, "site", "data", SLUG, "minutes", `${councilId}.json`);
  const raw = await fs.readFile(minutesPath, "utf8");
  const data = JSON.parse(raw);

  const schedules = (data.schedules ?? []).map((schedule) =>
    buildTurnsForSchedule({
      slug: SLUG,
      councilId: data.council_id,
      councilName: data.name,
      schedule,
      year: data.year,
    })
  );
  const turns = schedules.flatMap((schedule) => schedule.turns);
  const questionBlocks = schedules.flatMap((schedule) =>
    buildQuestionBlocks(SLUG, data.council_id, schedule)
  );
  const topicBlocks = buildTopicBlocks(SLUG, data.council_id, questionBlocks, turns);

  const output = {
    municipality: SLUG,
    council_id: data.council_id,
    council_name: data.name,
    year: data.year,
    japanese_year: data.japanese_year,
    type_label: data.type_label,
    generated_at: new Date().toISOString(),
    status: "prototype",
    note: "江別市の公式HTML丸ごと型議事録を、発言単位turnsと質問答弁まとまりquestion_blocksへ試験変換したデータ。",
    schedules: schedules.map(({ turns: _turns, ...schedule }) => ({
      ...schedule,
      turn_count: _turns.length,
    })),
    turns,
    question_blocks: questionBlocks,
    topic_blocks: topicBlocks,
  };

  const rootOut = path.join(PROJECT_ROOT, "data", SLUG, "turns", `${councilId}.json`);
  const siteOut = path.join(PROJECT_ROOT, "site", "data", SLUG, "turns", `${councilId}.json`);
  await fs.mkdir(path.dirname(rootOut), { recursive: true });
  await fs.writeFile(rootOut, JSON.stringify(output, null, 2) + "\n");
  await copyIfExists(rootOut, siteOut);

  console.log(
    `[${SLUG}] ${turns.length} turns / ${questionBlocks.length} question_blocks / ${topicBlocks.length} topic_blocks -> data/${SLUG}/turns/${councilId}.json`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
