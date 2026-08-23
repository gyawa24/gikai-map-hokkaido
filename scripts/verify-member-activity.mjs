#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const cityArgIndex = process.argv.indexOf("--city");
const city = cityArgIndex >= 0 ? process.argv[cityArgIndex + 1] : "chitose";
if (!city) throw new Error("--city requires a value");

const dataDir = path.join(ROOT, "data", city);
const siteDataDir = path.join(ROOT, "site", "data", city);

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function normalizeName(raw) {
  return String(raw ?? "")
    .replace(/[　\s]/g, "")
    .replace(/^[0-9０-９]+番/, "")
    .replace(/[［[]([^］\]]+)[］\]]/g, "$1")
    .replace(/^.*?[（(]([^）)]+)[）)]$/, "$1")
    .replace(/(?:総務文教|厚生環境|産業建設|議会運営)(?:常任)?委員長$/, "")
    .replace(/(?:補正予算|予算|決算)(?:特別)?委員長$/, "")
    .replace(/(委員|議員|議長|副議長)$/, "")
    .replace(/(君|氏|殿)$/, "")
    .trim();
}

const members = readJson(path.join(dataDir, "members.json"), []);
const memberNames = members.map((member) => normalizeName(member.name));

function seatNumber(raw) {
  const normalized = String(raw ?? "").replace(/[０-９]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xfee0)
  );
  return Number(normalized.match(/^(\d+)番/)?.[1] ?? 0) || null;
}

function resolveMember(raw, { useSeat = false } = {}) {
  const normalized = normalizeName(raw);
  if (!normalized) return null;
  if (memberNames.includes(normalized)) return normalized;

  if (useSeat) {
    const member = members.find((item) => Number(item.seat_number) === seatNumber(raw));
    const bySeat = normalizeName(member?.name);
    if (bySeat && bySeat.startsWith(normalized)) return bySeat;
  }

  const contained = memberNames.filter(
    (name) => name.includes(normalized) || normalized.includes(name)
  );
  if (contained.length === 1) return contained[0];
  const prefixed = memberNames.filter((name) => name.startsWith(normalized));
  return prefixed.length === 1 ? prefixed[0] : null;
}

function rawText(minute) {
  return String(minute?.text ?? minute?.title ?? "");
}

function isChair(minute) {
  return minute?.minute_type === "○議長" || String(minute?.title ?? "").endsWith("議長");
}

function personalMarker(minute) {
  if (minute?.minute_type !== "△議題") return null;
  const match = rawText(minute)
    .replace(/[　\s]/g, "")
    .match(/^△?(.+?)議員の(一般質問|代表質問)/u);
  if (!match) return null;
  return {
    memberName: resolveMember(match[1]),
    kind: match[2] === "代表質問" ? "representative_question" : "general_question",
  };
}

function genericAgendaKind(minute) {
  if (minute?.minute_type !== "△議題" || personalMarker(minute)) return null;
  const compact = rawText(minute).replace(/[　\s]/g, "");
  if (/代表質問/u.test(compact)) return "representative_question";
  if (/一般質問/u.test(compact)) return "general_question";
  return null;
}

function isPersonalEnd(minute) {
  return isChair(minute)
    && /議員の(?:一般|代表)?質問を終わります/u.test(rawText(minute));
}

function belongsToMember(rawSpeaker, memberName) {
  const normalized = normalizeName(rawSpeaker);
  return Boolean(
    normalized
    && (normalized === memberName
      || (normalized.length >= 2 && memberName.startsWith(normalized))
      || normalized.startsWith(memberName))
  );
}

function uniqueNumbers(values) {
  return [...new Set(values.map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
}

function sameValues(left, right) {
  return JSON.stringify([...left].map(String).sort()) === JSON.stringify([...right].map(String).sort());
}

function parsePersonalBlocks(meeting) {
  const blocks = [];
  const occupied = new Map();
  for (const schedule of meeting.schedules ?? []) {
    const minutes = schedule.minutes ?? [];
    const used = new Set();
    occupied.set(Number(schedule.schedule_id), used);

    for (let start = 0; start < minutes.length; start += 1) {
      const marker = personalMarker(minutes[start]);
      if (!marker) continue;
      let end = minutes.length - 1;
      for (let index = start + 1; index < minutes.length; index += 1) {
        if (personalMarker(minutes[index])) {
          end = index - 1;
          break;
        }
        if (isPersonalEnd(minutes[index])) {
          end = index;
          break;
        }
      }
      for (let index = start; index <= end; index += 1) used.add(index);
      if (marker.memberName) {
        const minuteIds = minutes.slice(start + 1, end + 1)
          .filter((minute) =>
            minute.minute_type === "◆質問"
            && belongsToMember(minute.title, marker.memberName)
          )
          .map((minute) => minute.minute_id);
        if (minuteIds.length > 0) {
          blocks.push({
            councilId: Number(meeting.council_id),
            scheduleId: Number(schedule.schedule_id),
            blockId: `s${schedule.schedule_id}-m${minutes[start].minute_id}`,
            kind: marker.kind,
            memberName: marker.memberName,
            minuteIds: uniqueNumbers(minuteIds),
          });
        }
      }
      start = end;
    }

    // 個人△見出しが欠けても、一般/代表質問の議題中で、議長の終了宣言まで
    // 同一議員の◆turnが続く場合は独立blockとして期待する。
    let activeKind = null;
    for (let start = 0; start < minutes.length; start += 1) {
      activeKind = genericAgendaKind(minutes[start]) ?? activeKind;
      if (!activeKind || used.has(start) || minutes[start]?.minute_type !== "◆質問") continue;
      const memberName = resolveMember(minutes[start].title, { useSeat: true });
      if (!memberName) continue;
      let end = minutes.length - 1;
      for (let index = start + 1; index < minutes.length; index += 1) {
        if (personalMarker(minutes[index])) {
          end = index - 1;
          break;
        }
        if (isPersonalEnd(minutes[index])) {
          end = index;
          break;
        }
      }
      const minuteIds = [];
      for (let index = start; index <= end; index += 1) {
        used.add(index);
        if (
          minutes[index]?.minute_type === "◆質問"
          && belongsToMember(minutes[index].title, memberName)
        ) {
          minuteIds.push(minutes[index].minute_id);
        }
      }
      if (minuteIds.length > 0) {
        blocks.push({
          councilId: Number(meeting.council_id),
          scheduleId: Number(schedule.schedule_id),
          blockId: `s${schedule.schedule_id}-m${minutes[start].minute_id}`,
          kind: activeKind,
          memberName,
          minuteIds: uniqueNumbers(minuteIds),
        });
      }
      start = end;
    }
  }
  return { blocks, occupied };
}

function isPlenaryStart(minute) {
  return isChair(minute) && /ただいまから[^。\n]*質疑を行います/u.test(rawText(minute));
}

function isPlenaryEnd(minute) {
  const text = rawText(minute);
  return isChair(minute)
    && /質疑を終わります/u.test(text)
    && !/[一-龠々ぁ-んァ-ヶ]+議員の質疑を終わります/u.test(text);
}

function isRawQuestionCapableMeeting(meeting) {
  return (meeting.schedules ?? []).some((schedule) =>
    (schedule.minutes ?? []).some((minute) =>
      personalMarker(minute)
      || genericAgendaKind(minute)
      || isPlenaryStart(minute)
    )
  );
}

function isRoleTurn(minute) {
  const text = rawText(minute).replace(/^[◆△◎○][^　\s]*[　\s]*/, "").trim();
  return /(?:反対|賛成)(?:する)?立場から討論|討論を(?:行|させて)|この際[、，]?動議を提出|指名いたします|御説明申し上げます|^少数意見報告書|^報告いたします/u.test(text);
}

function expectedRespondents(minutes, start) {
  const qualifier = rawText(minutes[start]).match(/(?:提出者|委員長)に対する/u)?.[0]
    ?.replace("に対する", "") ?? "";
  let boundary = 0;
  for (let index = start - 1; index >= 0; index -= 1) {
    if (minutes[index]?.minute_type === "△議題" || isPlenaryEnd(minutes[index])) {
      boundary = index;
      break;
    }
  }
  const prior = minutes.slice(boundary, start).filter((minute) => minute.minute_type === "◆質問");
  const respondents = new Set();
  for (const minute of prior) {
    if (/報告いたします|御説明申し上げます|少数意見報告書|提案(?:の)?理由/u.test(rawText(minute))) {
      const memberName = resolveMember(minute.title, { useSeat: true });
      if (memberName) respondents.add(memberName);
    }
  }
  if (qualifier) {
    const respondent = [...prior].reverse().find((minute) =>
      qualifier !== "委員長" || String(minute.title ?? "").includes("委員長")
    ) ?? prior.at(-1);
    const memberName = resolveMember(respondent?.title, { useSeat: true });
    if (memberName) respondents.add(memberName);
  }
  return respondents;
}

function parsePlenaryBlocks(meeting, occupied) {
  const blocks = [];
  for (const schedule of meeting.schedules ?? []) {
    const minutes = schedule.minutes ?? [];
    const used = occupied.get(Number(schedule.schedule_id)) ?? new Set();
    for (let start = 0; start < minutes.length; start += 1) {
      if (used.has(start) || !isPlenaryStart(minutes[start])) continue;
      let end = minutes.length - 1;
      for (let index = start; index < minutes.length; index += 1) {
        if (isPlenaryEnd(minutes[index])) {
          end = index;
          break;
        }
      }
      const respondents = expectedRespondents(minutes, start);
      const byMember = new Map();
      for (let index = start + 1; index <= end; index += 1) {
        const minute = minutes[index];
        if (minute?.minute_type !== "◆質問" || isRoleTurn(minute)) continue;
        const memberName = resolveMember(minute.title, { useSeat: true });
        if (!memberName || respondents.has(memberName)) continue;
        const ids = byMember.get(memberName) ?? [];
        ids.push(minute.minute_id);
        byMember.set(memberName, ids);
      }
      for (const [memberName, minuteIds] of byMember) {
        blocks.push({
          councilId: Number(meeting.council_id),
          scheduleId: Number(schedule.schedule_id),
          blockId: `s${schedule.schedule_id}-m${minutes[start].minute_id}`,
          kind: "plenary_question",
          memberName,
          minuteIds: uniqueNumbers(minuteIds),
        });
      }
      start = end;
    }
  }
  return blocks;
}

const errors = [];
const rootPath = path.join(dataDir, "members_activity.json");
const sitePath = path.join(siteDataDir, "members_activity.json");
const rootText = fs.readFileSync(rootPath, "utf8");
const siteText = fs.readFileSync(sitePath, "utf8");
if (rootText !== siteText) errors.push("root/site members_activity.json are not identical");

const activity = JSON.parse(rootText);
const actualById = new Map();
let sessionCount = 0;
for (const [memberName, entry] of Object.entries(activity)) {
  if (!memberNames.includes(normalizeName(memberName))) {
    errors.push(`${memberName}: member is not present in members.json`);
  }
  if (normalizeName(entry.name) !== normalizeName(memberName)) {
    errors.push(`${memberName}: entry.name does not match its object key`);
  }
  const sessions = Array.isArray(entry.sessions) ? entry.sessions : [];
  sessionCount += sessions.length;
  if (entry.session_count !== sessions.length) {
    errors.push(`${memberName}: session_count does not match sessions.length`);
  }
  const officialCount = sessions.filter((session) => session.source_status !== "preliminary").length;
  const preliminaryCount = sessions.filter((session) => session.source_status === "preliminary").length;
  if (entry.official_session_count !== officialCount) errors.push(`${memberName}: official_session_count is incorrect`);
  if (entry.preliminary_session_count !== preliminaryCount) errors.push(`${memberName}: preliminary_session_count is incorrect`);
  for (const [field, kind] of [
    ["general_question_count", "general_question"],
    ["representative_question_count", "representative_question"],
    ["committee_question_count", "committee_question"],
    ["plenary_question_count", "plenary_question"],
  ]) {
    const expected = sessions.filter((session) => session.question_kind === kind).length;
    if (entry[field] !== expected) errors.push(`${memberName}: ${field} is incorrect`);
  }

  for (const session of sessions) {
    if (!session.record_id) errors.push(`${memberName}: record_id is missing`);
    if (actualById.has(session.record_id)) errors.push(`duplicate record_id: ${session.record_id}`);
    actualById.set(session.record_id, { ...session, memberName });
    if (!session.href) errors.push(`${session.record_id}: href is missing`);
    if (!session.source_type || !session.source_status) errors.push(`${session.record_id}: source metadata is missing`);
    if (session.date && !/^\d{4}-\d{2}-\d{2}$/.test(session.date)) errors.push(`${session.record_id}: date is not ISO format`);
    if (session.source_status === "official") {
      if (!(session.council_id > 0)) errors.push(`${session.record_id}: official record has no council_id`);
      if (!session.block_id) errors.push(`${session.record_id}: official record has no block_id`);
      if (!Object.hasOwn(session, "agenda_title")) errors.push(`${session.record_id}: official record has no agenda_title`);
      const expectedId = `${city}:official:${session.council_id}:${session.question_kind}:${session.block_id}:${memberName}`;
      if (session.record_id !== expectedId) errors.push(`${session.record_id}: record_id does not encode city/council/kind/block/member`);
    }
    if (session.source_status === "preliminary" && session.source_type !== "video_transcript") {
      errors.push(`${session.record_id}: preliminary record must be a video transcript`);
    }
  }
}

const minutesIndex = readJson(path.join(dataDir, "minutes", "index.json"), []);
const meetings = (Array.isArray(minutesIndex) ? minutesIndex : []).flatMap((item) => {
  const meeting = readJson(path.join(dataDir, "minutes", `${item.council_id}.json`), null);
  return meeting?.schedules ? [meeting] : [];
});
const segmentsByCouncil = new Map();
const segmentIndex = readJson(path.join(dataDir, "segments", "_index.json"), []);
for (const councilId of new Set(
  (Array.isArray(segmentIndex) ? segmentIndex : []).map((item) => Number(item.council_id)).filter(Number.isFinite)
)) {
  segmentsByCouncil.set(councilId, readJson(path.join(dataDir, "segments", `${councilId}.json`), []));
}

const expectedById = new Map();
const rawCapableCouncilIds = new Set();
const committeeCouncilIds = new Set();
function expectedSegments(block) {
  const minuteIds = new Set(block.minuteIds.map(String));
  return (segmentsByCouncil.get(block.councilId) ?? []).filter((segment) =>
    String(segment.source?.schedule_id ?? segment.schedule_id) === String(block.scheduleId)
    && (segment.source?.minute_ids ?? []).some((minuteId) => minuteIds.has(String(minuteId)))
  );
}

function addExpectedBlock(block) {
  const recordId = `${city}:official:${block.councilId}:${block.kind}:${block.blockId}:${block.memberName}`;
  const segments = expectedSegments(block);
  expectedById.set(recordId, { ...block, recordId, evidenceSegmentIds: segments.map((segment) => segment.id) });
}

for (const meeting of meetings) {
  const councilId = Number(meeting.council_id);
  if (String(meeting.name ?? "").includes("委員会")) {
    committeeCouncilIds.add(councilId);
    continue;
  }
  if (!isRawQuestionCapableMeeting(meeting)) continue;
  rawCapableCouncilIds.add(councilId);
  const { blocks, occupied } = parsePersonalBlocks(meeting);
  for (const block of blocks) addExpectedBlock(block);
  for (const block of parsePlenaryBlocks(meeting, occupied)) addExpectedBlock(block);
}

const enrichedMembers = new Map();
const enrichedDir = path.join(dataDir, "minutes", "enriched");
if (fs.existsSync(enrichedDir)) {
  for (const file of fs.readdirSync(enrichedDir).filter((name) => name.endsWith(".json"))) {
    const document = readJson(path.join(enrichedDir, file), null);
    if (!document) continue;
    const names = enrichedMembers.get(String(document.council_id)) ?? new Set();
    for (const questioner of document.questioners ?? []) {
      const memberName = resolveMember(questioner.name);
      if (memberName) names.add(memberName);
    }
    enrichedMembers.set(String(document.council_id), names);
  }
}

for (const meeting of meetings.filter((item) => String(item.name ?? "").includes("委員会"))) {
  const councilId = Number(meeting.council_id);
  const groups = new Map();
  for (const segment of segmentsByCouncil.get(councilId) ?? []) {
    if (segment.speaker_role !== "質問" || segment.is_procedural) continue;
    const memberName = resolveMember(segment.member_name ?? segment.speaker);
    if (!memberName) continue;
    const current = groups.get(memberName) ?? [];
    current.push(segment);
    groups.set(memberName, current);
  }
  for (const [memberName, segments] of groups) {
    const text = segments.map((segment) => segment.text ?? segment.excerpt ?? "").join(" ");
    const accepted = enrichedMembers.get(String(councilId))?.has(memberName)
      || /(?:質問|質疑)(?:を|させて|いたし)|お伺い|お聞かせ|御説明いただ/u.test(text);
    if (!accepted) continue;
    const evidence = segments.filter((segment) => !isRoleTurn(segment));
    const block = {
      councilId,
      scheduleId: null,
      blockId: "committee",
      kind: "committee_question",
      memberName,
      minuteIds: uniqueNumbers(evidence.flatMap((segment) => segment.source?.minute_ids ?? [])),
    };
    const recordId = `${city}:official:${councilId}:${block.kind}:${block.blockId}:${memberName}`;
    expectedById.set(recordId, { ...block, recordId, evidenceSegmentIds: evidence.map((segment) => segment.id) });
  }
}

function expectedHasMemberCouncil(memberName, councilId) {
  return [...expectedById.values()].some((record) =>
    record.memberName === memberName && Number(record.councilId) === Number(councilId)
  );
}

function legacyQuestionKind(sessionName) {
  if (String(sessionName ?? "").includes("委員会")) return "committee_question";
  if (String(sessionName ?? "").includes("代表質問")) return "representative_question";
  if (String(sessionName ?? "").includes("一般質問")) return "general_question";
  return "other_question";
}

const meetingByCouncil = new Map(meetings.map((meeting) => [Number(meeting.council_id), meeting]));
const legacyGroups = new Map();
for (const [councilId, segments] of segmentsByCouncil) {
  if (rawCapableCouncilIds.has(councilId) || committeeCouncilIds.has(councilId)) continue;
  for (const segment of segments) {
    if (segment.speaker_role !== "質問") continue;
    const memberName = resolveMember(segment.member_name ?? segment.speaker);
    if (!memberName) continue;
    const key = `${memberName}::${councilId}`;
    const current = legacyGroups.get(key) ?? { memberName, councilId, segments: [] };
    current.segments.push(segment);
    legacyGroups.set(key, current);
  }
}

for (const { memberName, councilId, segments } of legacyGroups.values()) {
  if (expectedHasMemberCouncil(memberName, councilId)) continue;
  const evidence = segments.filter((segment) => !segment.is_procedural && !isRoleTurn(segment));
  if (evidence.length === 0) continue;
  const retained = evidence;
  const sessionName = meetingByCouncil.get(councilId)?.name ?? segments[0]?.council_name ?? "";
  const kind = legacyQuestionKind(sessionName);
  const blockId = "legacy-segments";
  const recordId = `${city}:official:${councilId}:${kind}:${blockId}:${memberName}`;
  expectedById.set(recordId, {
    recordId,
    councilId,
    scheduleId: null,
    blockId,
    kind,
    memberName,
    minuteIds: uniqueNumbers(retained.flatMap((segment) => segment.source?.minute_ids ?? [])),
    evidenceSegmentIds: retained.map((segment) => segment.id),
  });
}

for (const [rawCouncilId, names] of enrichedMembers) {
  const councilId = Number(rawCouncilId);
  if (rawCapableCouncilIds.has(councilId) || committeeCouncilIds.has(councilId)) continue;
  for (const memberName of names) {
    if (expectedHasMemberCouncil(memberName, councilId)) continue;
    const sessionName = meetingByCouncil.get(councilId)?.name ?? "";
    const kind = legacyQuestionKind(sessionName);
    const blockId = "legacy-enriched";
    const recordId = `${city}:official:${councilId}:${kind}:${blockId}:${memberName}`;
    expectedById.set(recordId, {
      recordId,
      councilId,
      scheduleId: null,
      blockId,
      kind,
      memberName,
      minuteIds: [],
      evidenceSegmentIds: [],
    });
  }
}

const actualOfficialIds = new Set(
  [...actualById].filter(([, record]) => record.source_status === "official").map(([recordId]) => recordId)
);
if (expectedById.size > 0 && actualOfficialIds.size === 0) {
  errors.push(`discoverable official activity exists (${expectedById.size}) but output has no official records`);
}
for (const [recordId, expected] of expectedById) {
  const actual = actualById.get(recordId);
  if (!actual) {
    errors.push(`expected activity record is missing: ${recordId}`);
    continue;
  }
  if (!sameValues(actual.evidence_minute_ids ?? [], expected.minuteIds)) {
    errors.push(`${recordId}: evidence_minute_ids do not match raw question turns`);
  }
  if (!sameValues(actual.evidence_segment_ids ?? [], expected.evidenceSegmentIds)) {
    errors.push(`${recordId}: evidence_segment_ids do not match raw question turns`);
  }
}
for (const recordId of actualOfficialIds) {
  if (!expectedById.has(recordId)) {
    errors.push(`activity has no authoritative raw/committee/legacy evidence: ${recordId}`);
  }
}

const sessionsIndex = readJson(path.join(dataDir, "sessions", "index.json"), []);
for (const indexEntry of Array.isArray(sessionsIndex) ? sessionsIndex : []) {
  const session = readJson(path.join(dataDir, "sessions", `${indexEntry.id}.json`), null);
  if (!session) continue;
  for (const segment of session.segments ?? []) {
    const memberName = resolveMember(segment.detail?.speaker ?? segment.label);
    if (!memberName) continue;
    const evidenceId = `session:${session.id}:${segment.index}`;
    const found = [...actualById.values()].some((record) =>
      record.memberName === memberName && (record.evidence_segment_ids ?? []).includes(evidenceId)
    );
    if (!found) errors.push(`${memberName}: video segment ${evidenceId} is missing from activity`);
  }
}

if (city === "chitose") {
  const official = [...actualById.values()].filter((record) => record.source_status === "official");
  const preliminary = [...actualById.values()].filter((record) => record.source_status === "preliminary");
  const expectedKinds = {
    general_question: 192,
    representative_question: 17,
    committee_question: 135,
    plenary_question: 16,
  };
  if (sessionCount !== 373 || official.length !== 360 || preliminary.length !== 13) {
    errors.push(`chitose regression count: expected 373 = 360 official + 13 preliminary, got ${sessionCount} = ${official.length} + ${preliminary.length}`);
  }
  for (const [kind, expected] of Object.entries(expectedKinds)) {
    const actual = official.filter((record) => record.question_kind === kind).length;
    if (actual !== expected) errors.push(`chitose ${kind}: expected ${expected}, got ${actual}`);
  }

  const expectedMemberCounts = new Map(Object.entries({
    松倉美加: 15, 今井ひろみ: 5, 小川陽平: 5, 佐々木昭: 7, 相沢晶子: 28,
    北山敬太: 28, 吉谷徹: 43, 渡部謙太郎: 19, 北原偉男: 19, 岩満順郎: 23,
    大山益巳: 13, 今野正恵: 18, 平川美由紀: 19, 宮原伸哉: 17, 仲山正人: 18,
    山口康弘: 13, 山崎昌則: 11, 佐々木雅宏: 7, 古川昌俊: 8, 落野章一: 26,
    丸岡伸幸: 21, 坂野智: 5, 梅尾要一: 5,
  }));
  for (const [memberName, expected] of expectedMemberCounts) {
    const actual = activity[memberName]?.sessions?.length ?? 0;
    if (actual !== expected) errors.push(`${memberName}: expected ${expected} records, got ${actual}`);
  }

  const splitCases = [
    [557, "松倉美加"], [557, "北山敬太"], [557, "吉谷徹"],
    [526, "吉谷徹"], [522, "吉谷徹"], [504, "吉谷徹"],
  ];
  for (const [councilId, memberName] of splitCases) {
    const kinds = new Set(official
      .filter((record) => record.council_id === councilId && record.memberName === memberName)
      .map((record) => record.question_kind));
    if (!kinds.has("general_question") || !kinds.has("plenary_question")) {
      errors.push(`${councilId}/${memberName}: general and plenary records are not split`);
    }
  }

  if (official.some((record) => record.council_id === 546 && record.memberName === "北山敬太")) {
    errors.push("chitose 546 北山敬太 false positive remains");
  }
  const forbiddenEvidence = new Set(`
    chitose-560-7-699 chitose-546-7-062 chitose-546-7-064 chitose-546-7-066
    chitose-545-7-752 chitose-495-2-013 chitose-580-7-630 chitose-571-6-590
    chitose-571-6-591 chitose-560-7-697 chitose-554-6-469 chitose-545-7-750
    chitose-538-6-428 chitose-525-7-452 chitose-525-7-453 chitose-518-6-479
    chitose-513-7-516 chitose-504-2-016 chitose-497-6-554 chitose-489-7-664
    chitose-580-7-631 chitose-567-2-004 chitose-567-2-010 chitose-567-2-011
    chitose-567-2-013 chitose-531-4-033 chitose-526-8-105
  `.trim().split(/\s+/));
  for (const record of official) {
    for (const evidenceId of record.evidence_segment_ids ?? []) {
      if (forbiddenEvidence.has(evidenceId)) {
        errors.push(`${record.record_id}: forbidden non-question evidence ${evidenceId}`);
      }
    }
  }

  const sasakiEvidence = new Set(official
    .filter((record) => record.memberName === "佐々木雅宏")
    .flatMap((record) => record.evidence_segment_ids ?? []));
  for (const evidenceId of ["chitose-500-7-089", "chitose-526-4-018", "chitose-526-4-020"]) {
    if (!sasakiEvidence.has(evidenceId)) errors.push(`佐々木雅宏: inherited-name evidence is missing: ${evidenceId}`);
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(`error: ${error}`);
  process.exit(1);
}

console.log(
  `ok ${city}: ${Object.keys(activity).length} members / ${sessionCount} records / ${actualById.size} unique record ids / ${expectedById.size} expected official records`
);
