#!/usr/bin/env node
/**
 * enriched・segments・会議録速報を会議単位で統合し、議員ごとの質問履歴を生成する。
 *
 * 使い方:
 *   node scripts/build-member-activity.mjs --city chitose
 *   --allow-empty / --allow-coverage-drop は意図的な削除時だけ使用する。
 *
 * 出力:
 *   data/{city}/members_activity.json
 *   site/data/{city}/members_activity.json
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const SITE_ROOT = path.resolve(__dirname, "..");

const cityArgIndex = process.argv.indexOf("--city");
const city = cityArgIndex >= 0 ? process.argv[cityArgIndex + 1] : "chitose";
if (!city) throw new Error("--city requires a value");

const dataDir = path.join(ROOT, "data", city);
const siteDataDir = path.join(SITE_ROOT, "data", city);
const enrichedDir = path.join(dataDir, "minutes", "enriched");
const segmentsDir = path.join(dataDir, "segments");
const sessionsDir = path.join(dataDir, "sessions");

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

// --- メンバー読み込み ---
const members = JSON.parse(fs.readFileSync(path.join(dataDir, "members.json"), "utf-8"));
const memberNames = members.map((m) => m.name.replace(/\s/g, ""));
const reportedNameIssues = new Set();
const municipalities = readJson(path.join(ROOT, "data", "municipalities.json"), []);
const municipality = Array.isArray(municipalities)
  ? municipalities.find((item) => item.slug === city)
  : null;
const minutesIndex = readJson(path.join(dataDir, "minutes", "index.json"), []);
const minutesByCouncilId = new Map(
  (Array.isArray(minutesIndex) ? minutesIndex : []).map((item) => [String(item.council_id), item])
);

function officialMinutesUrl() {
  if (municipality?.system === "dnp" || municipality?.tenant_id != null) {
    return `https://ssp.kaigiroku.net/tenant/${city}/MinuteBrowse.html`;
  }
  return undefined;
}

function minutesHref(councilId, scheduleId, minuteId) {
  const base = `/${city}/minutes/${councilId}`;
  if (!Number.isFinite(Number(scheduleId)) || !Number.isFinite(Number(minuteId))) return base;
  return `${base}#minute-${scheduleId}-${minuteId}`;
}

function reportNameIssue(key, message) {
  if (reportedNameIssues.has(key)) return;
  reportedNameIssues.add(key);
  console.log(message);
}

// --- 名寄せ関数 ---
function normalizeQuestioner(raw) {
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

function seatNumberFromSpeaker(raw) {
  const normalized = String(raw ?? "").replace(/[０-９]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xfee0)
  );
  return Number(normalized.match(/^(\d+)番/)?.[1] ?? 0) || null;
}

function findMember(raw, { allowSeat = false } = {}) {
  const normalized = normalizeQuestioner(raw);
  if (!normalized) return null;

  // 1. 完全一致
  const exact = memberNames.findIndex((n) => n === normalized);
  if (exact !== -1) return memberNames[exact];

  // 本会議質疑の略記（例: 18番佐々木議員）は、同姓が複数いる場合に限り
  // 議席番号と姓の双方が一致するときだけ解決する。個人質問は正式見出しを優先する。
  if (allowSeat) {
    const seatNumber = seatNumberFromSpeaker(raw);
    const bySeat = members.find((member) => Number(member.seat_number) === seatNumber);
    const bySeatName = bySeat?.name?.replace(/\s/g, "");
    if (bySeatName && bySeatName.startsWith(normalized)) return bySeatName;
  }

  // 2. 姓のみ（2文字以下）の場合は姓で前方一致。
  //    同姓議員が複数いるときは誤帰属を避けて名寄せ失敗にする（中立性ポリシー: 漏れより誤帰属の方が深刻）
  if (normalized.length <= 2) {
    const byLastName = memberNames.filter((n) => n.startsWith(normalized));
    if (byLastName.length === 1) return byLastName[0];
    if (byLastName.length > 1) {
      reportNameIssue(
        `ambiguous:${raw}`,
        `  名寄せ曖昧: "${raw}" 候補複数 [${byLastName.join(", ")}]`
      );
      return null;
    }
  }

  // 3. 部分一致（名前全体が含まれる）。候補が一意のときだけ採用する
  const partials = memberNames.filter(
    (n) => n.includes(normalized) || normalized.includes(n)
  );
  if (partials.length === 1) return partials[0];
  if (partials.length > 1) {
    reportNameIssue(
      `ambiguous:${raw}`,
      `  名寄せ曖昧: "${raw}" 候補複数 [${partials.join(", ")}]`
    );
    return null;
  }

  // 4. 姓のみ3文字以上でも前方一致を試みる
  const byPrefix = memberNames.find((n) => n.startsWith(normalized.slice(0, 2)));
  if (byPrefix && normalized.length >= 2) {
    // 曖昧すぎる（佐々木昭 vs 佐々木雅宏）は除外
    const candidates = memberNames.filter((n) => n.startsWith(normalized.slice(0, 2)));
    if (candidates.length === 1) return candidates[0];
  }

  return null;
}

function uniqueTopics(items) {
  return Array.from(new Set(items.map((item) => String(item ?? "").trim()).filter(Boolean)));
}

function extractTopicsFromText(text) {
  const source = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!source) return [];

  const topics = [];
  const patterns = [
    /大項目\d+[、，\s　]+([^。\n]+?について)/g,
    /中項目\d+[、，\s　]+([^。\n]+?について)/g,
    /([^\n。]{8,40}?について)/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const topic = match[1].trim();
      if (topic && !topics.includes(topic)) topics.push(topic);
    }
    if (topics.length > 0) break;
  }

  if (topics.length > 0) return topics.slice(0, 6);

  const fallback = source.slice(0, 40).trim();
  return fallback ? [fallback] : [];
}

function loadEnrichedFiles() {
  if (!fs.existsSync(enrichedDir)) return [];
  return fs.readdirSync(enrichedDir)
    .filter((f) => f.endsWith(".json"))
    .sort();
}

function loadSegmentIndexes() {
  const indexPath = path.join(segmentsDir, "_index.json");
  if (!fs.existsSync(indexPath)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function loadSessionFiles() {
  const index = readJson(path.join(sessionsDir, "index.json"), []);
  if (!Array.isArray(index)) return [];
  return index.flatMap((entry) => {
    if (!entry?.id) return [];
    const session = readJson(path.join(sessionsDir, `${entry.id}.json`), null);
    return session ? [session] : [];
  });
}

function yearFromMeetingName(name) {
  const normalized = String(name ?? "").replace(/[０-９]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xfee0)
  );
  const reiwa = normalized.match(/令和\s*(\d+)年/);
  if (reiwa) return String(2018 + Number(reiwa[1]));
  const heisei = normalized.match(/平成\s*(\d+)年/);
  if (heisei) return String(1988 + Number(heisei[1]));
  return normalized.match(/(?:^|\D)(\d{4})(?:\D|$)/)?.[1] ?? "";
}

function dateFromSchedule(year, scheduleName) {
  const normalized = String(scheduleName ?? "").replace(/[０-９]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xfee0)
  );
  const match = normalized.match(/(\d{1,2})月(\d{1,2})日/);
  if (!/^\d{4}$/.test(String(year ?? "")) || !match) return "";
  return `${year}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

function mergeTopicDetails(left = [], right = []) {
  const byTitle = new Map();
  for (const detail of [...left, ...right]) {
    const title = String(detail?.title ?? "").trim();
    if (!title) continue;
    const current = byTitle.get(title) ?? { title };
    const qa = [...(current.qa ?? []), ...(detail.qa ?? [])]
      .filter((item) => item?.question && item?.answer)
      .filter((item, index, rows) =>
        rows.findIndex((candidate) =>
          candidate.question === item.question && candidate.answer === item.answer
        ) === index
      );
    byTitle.set(title, {
      ...current,
      ...detail,
      title,
      ...(qa.length > 0 ? { qa } : {}),
    });
  }
  return [...byTitle.values()];
}

function mergeSession(current, next) {
  if (!current) return next;
  const dates = uniqueTopics([
    ...(current.dates ?? []),
    current.date,
    ...(next.dates ?? []),
    next.date,
  ]).sort();
  return {
    ...current,
    ...Object.fromEntries(
      Object.entries(next).filter(([, value]) => value !== undefined && value !== null && value !== "")
    ),
    record_id: current.record_id,
    topics: uniqueTopics([...(current.topics ?? []), ...(next.topics ?? [])]),
    summary_topics: uniqueTopics([
      ...(current.summary_topics ?? []),
      ...(next.summary_topics ?? []),
    ]),
    dates,
    date: dates[0] ?? current.date ?? next.date,
    topic_details: mergeTopicDetails(current.topic_details, next.topic_details),
    evidence_segment_ids: uniqueTopics([
      ...(current.evidence_segment_ids ?? []),
      ...(next.evidence_segment_ids ?? []),
    ]),
    evidence_minute_ids: uniqueTopics([
      ...(current.evidence_minute_ids ?? []),
      ...(next.evidence_minute_ids ?? []),
    ]).map((minuteId) => Number(minuteId)).filter(Number.isFinite),
  };
}

// activity: { [normalizedMemberName]: { sessions: Map<identity, session> } }
const activity = {};
for (const name of memberNames) {
  activity[name] = { sessions: new Map() };
}

function addActivity(memberName, identity, session) {
  if (!activity[memberName]) return;
  const current = activity[memberName].sessions.get(identity);
  activity[memberName].sessions.set(identity, mergeSession(current, session));
}

const enrichedFiles = loadEnrichedFiles();
const enrichedMembersByCouncil = new Map();
const enrichedSupplements = new Map();
if (enrichedFiles.length > 0) {
  for (const file of enrichedFiles) {
    const data = JSON.parse(fs.readFileSync(path.join(enrichedDir, file), "utf-8"));
    const sessionName = data.name;
    const councilId = data.council_id;
    const councilMembers = enrichedMembersByCouncil.get(String(councilId)) ?? new Set();

    for (const q of (data.questioners ?? [])) {
      const memberName = findMember(q.name);
      if (!memberName) {
        reportNameIssue(
          `unmatched:${q.name}:${sessionName}`,
          `  名寄せ失敗: "${q.name}" (${sessionName})`
        );
        continue;
      }
      councilMembers.add(memberName);
      const allTopics = uniqueTopics([
        ...(q.topics ?? []),
        ...(q.ai_topics ?? []),
      ]);
      const supplementKey = `${councilId}:${memberName}`;
      const current = enrichedSupplements.get(supplementKey) ?? {
        councilId: Number(councilId),
        memberName,
        sessionName,
        topics: [],
      };
      current.topics = uniqueTopics([...current.topics, ...allTopics]);
      enrichedSupplements.set(supplementKey, current);
    }
    enrichedMembersByCouncil.set(String(councilId), councilMembers);
  }
}

function likelyCommitteeQuestion(segments) {
  const text = segments.map((segment) => segment.text ?? segment.excerpt ?? "").join(" ");
  return /(?:質問|質疑)(?:を|させて|いたし)|お伺い|お聞かせ|御説明いただ/u.test(text);
}

const segmentIndex = loadSegmentIndexes();
const councilIds = uniqueTopics(segmentIndex.map((item) => item.council_id));
const segmentsByCouncil = new Map();
for (const rawCouncilId of councilIds) {
  const councilId = Number(rawCouncilId);
  if (!Number.isFinite(councilId)) continue;
  const fp = path.join(segmentsDir, `${councilId}.json`);
  const segments = readJson(fp, []);
  if (!Array.isArray(segments)) continue;
  segmentsByCouncil.set(councilId, segments);
}

function rawMinuteText(minute) {
  return String(minute?.text ?? minute?.title ?? "");
}

function individualQuestionMarker(minute) {
  if (minute?.minute_type !== "△議題") return null;
  const compact = rawMinuteText(minute).replace(/[　\s]/g, "");
  const match = compact.match(/^△?(.+?)議員の(一般質問|代表質問)/u);
  if (!match) return null;
  return {
    rawName: match[1],
    questionKind: match[2] === "代表質問"
      ? "representative_question"
      : "general_question",
  };
}

function genericQuestionAgendaKind(minute) {
  if (minute?.minute_type !== "△議題" || individualQuestionMarker(minute)) return null;
  const compact = rawMinuteText(minute).replace(/[　\s]/g, "");
  if (/代表質問/u.test(compact)) return "representative_question";
  if (/一般質問/u.test(compact)) return "general_question";
  return null;
}

function isChairMinute(minute) {
  return minute?.minute_type === "○議長" || String(minute?.title ?? "").endsWith("議長");
}

function isIndividualQuestionEnd(minute) {
  return isChairMinute(minute)
    && /議員の(?:一般|代表)?質問を終わります/u.test(rawMinuteText(minute));
}

function speakerMatchesCanonical(rawSpeaker, canonicalName) {
  const normalized = normalizeQuestioner(rawSpeaker);
  return Boolean(
    normalized
    && (normalized === canonicalName
      || (normalized.length >= 2 && canonicalName.startsWith(normalized))
      || normalized.startsWith(canonicalName))
  );
}

function uniqueNumbers(values) {
  return [...new Set(values.map(Number).filter(Number.isFinite))];
}

function parsePersonalQuestionBlocks(meeting) {
  const blocks = [];
  const coveredBySchedule = new Map();

  for (const schedule of meeting.schedules ?? []) {
    const minutes = schedule.minutes ?? [];
    const covered = new Set();
    coveredBySchedule.set(Number(schedule.schedule_id), covered);

    for (let index = 0; index < minutes.length; index += 1) {
      const marker = individualQuestionMarker(minutes[index]);
      if (!marker) continue;

      let endIndex = minutes.length - 1;
      let closureMethod = "schedule_end";
      for (let cursor = index + 1; cursor < minutes.length; cursor += 1) {
        if (individualQuestionMarker(minutes[cursor])) {
          endIndex = cursor - 1;
          closureMethod = "next_question_marker";
          break;
        }
        if (isIndividualQuestionEnd(minutes[cursor])) {
          endIndex = cursor;
          closureMethod = "chair_declaration";
          break;
        }
      }
      for (let cursor = index; cursor <= endIndex; cursor += 1) covered.add(cursor);

      const memberName = findMember(marker.rawName);
      if (memberName) {
        const minuteIds = minutes
          .slice(index + 1, endIndex + 1)
          .filter((minute) =>
            minute.minute_type === "◆質問"
            && speakerMatchesCanonical(minute.title, memberName)
          )
          .map((minute) => minute.minute_id);
        if (minuteIds.length > 0) {
          blocks.push({
            councilId: Number(meeting.council_id),
            sessionName: meeting.name,
            year: String(meeting.year ?? yearFromMeetingName(meeting.name)),
            scheduleId: Number(schedule.schedule_id),
            scheduleName: schedule.name ?? "",
            blockId: `s${schedule.schedule_id}-m${minutes[index].minute_id}`,
            questionKind: marker.questionKind,
            memberName,
            agendaTitle: marker.questionKind === "representative_question" ? "代表質問" : "一般質問",
            minuteIds: uniqueNumbers(minuteIds),
            markerMinuteId: Number(minutes[index].minute_id),
            endMinuteId: Number(minutes[endIndex]?.minute_id),
            closureMethod,
          });
        }
      }
      index = endIndex;
    }

    // DNP側で個人見出しだけ欠けた場合も、一般/代表質問の議題と議長の終了宣言を
    // 境界にする。531吉谷のような欠落を、本文キーワードだけで推測しないためのfallback。
    let activeKind = null;
    for (let index = 0; index < minutes.length; index += 1) {
      activeKind = genericQuestionAgendaKind(minutes[index]) ?? activeKind;
      if (!activeKind || covered.has(index) || minutes[index]?.minute_type !== "◆質問") continue;

      const memberName = findMember(minutes[index].title, { allowSeat: true });
      if (!memberName) continue;
      let endIndex = minutes.length - 1;
      let closureMethod = "schedule_end";
      for (let cursor = index + 1; cursor < minutes.length; cursor += 1) {
        if (individualQuestionMarker(minutes[cursor])) {
          endIndex = cursor - 1;
          closureMethod = "next_question_marker";
          break;
        }
        if (isIndividualQuestionEnd(minutes[cursor])) {
          endIndex = cursor;
          closureMethod = "chair_declaration";
          break;
        }
      }
      const minuteIds = [];
      for (let cursor = index; cursor <= endIndex; cursor += 1) {
        covered.add(cursor);
        const minute = minutes[cursor];
        if (
          minute?.minute_type === "◆質問"
          && speakerMatchesCanonical(minute.title, memberName)
        ) {
          minuteIds.push(minute.minute_id);
        }
      }
      if (minuteIds.length > 0) {
        blocks.push({
          councilId: Number(meeting.council_id),
          sessionName: meeting.name,
          year: String(meeting.year ?? yearFromMeetingName(meeting.name)),
          scheduleId: Number(schedule.schedule_id),
          scheduleName: schedule.name ?? "",
          blockId: `s${schedule.schedule_id}-m${minutes[index].minute_id}`,
          questionKind: activeKind,
          memberName,
          agendaTitle: activeKind === "representative_question" ? "代表質問" : "一般質問",
          minuteIds: uniqueNumbers(minuteIds),
          markerMinuteId: Number(minutes[index].minute_id),
          endMinuteId: Number(minutes[endIndex]?.minute_id),
          closureMethod,
        });
      }
      index = endIndex;
    }
  }

  return { blocks, coveredBySchedule };
}

function isPlenaryQuestionStart(minute) {
  return isChairMinute(minute)
    && /ただいまから[^。\n]*質疑を行います/u.test(rawMinuteText(minute));
}

function isOverallPlenaryQuestionEnd(minute) {
  const text = rawMinuteText(minute);
  return isChairMinute(minute)
    && /質疑を終わります/u.test(text)
    && !/[一-龠々ぁ-んァ-ヶ]+議員の質疑を終わります/u.test(text);
}

function isRawQuestionCapableMeeting(meeting) {
  return (meeting.schedules ?? []).some((schedule) =>
    (schedule.minutes ?? []).some((minute) =>
      individualQuestionMarker(minute)
      || genericQuestionAgendaKind(minute)
      || isPlenaryQuestionStart(minute)
    )
  );
}

function isClearlyNonQuestionRoleTurn(minute) {
  const text = rawMinuteText(minute).replace(/^[◆△◎○][^　\s]*[　\s]*/, "").trim();
  return /(?:反対|賛成)(?:する)?立場から討論|討論を(?:行|させて)|この際[、，]?動議を提出|指名いたします|御説明申し上げます|^少数意見報告書|^報告いたします/u.test(text);
}

function agendaTitleBefore(minutes, startIndex) {
  let boundary = 0;
  for (let index = startIndex - 1; index >= 0; index -= 1) {
    if (isOverallPlenaryQuestionEnd(minutes[index])) {
      boundary = index + 1;
      break;
    }
  }
  const titles = minutes
    .slice(boundary, startIndex + 1)
    .filter((minute) => minute.minute_type === "△議題")
    .map((minute) => rawMinuteText(minute).replace(/^△/, "").replace(/\s+/g, " ").trim())
    .filter((title) => title && !/^日程第[0-9０-９一二三四五六七八九十]+$/u.test(title))
    .filter((title) => !/^(?:一般|代表)質問$/u.test(title));
  if (titles.length > 0) return uniqueTopics(titles).slice(-4).join(" / ");

  const priorAgenda = [...minutes.slice(0, startIndex)]
    .reverse()
    .find((minute) => {
      if (minute.minute_type !== "△議題") return false;
      const title = rawMinuteText(minute).replace(/^△/, "").replace(/\s+/g, " ").trim();
      return title && !/^日程第[0-9０-９一二三四五六七八九十]+$/u.test(title);
    });
  if (priorAgenda) {
    return rawMinuteText(priorAgenda).replace(/^△/, "").replace(/\s+/g, " ").trim();
  }

  return rawMinuteText(minutes[startIndex])
    .split("ただいまから")[0]
    .replace(/^○[^　\s]+[　\s]*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function plenaryRespondents(minutes, startIndex) {
  const openerText = rawMinuteText(minutes[startIndex]);
  const qualifier = openerText.match(/(?:提出者|委員長)に対する/u)?.[0]?.replace("に対する", "") ?? "";
  let boundary = 0;
  for (let index = startIndex - 1; index >= 0; index -= 1) {
    if (minutes[index]?.minute_type === "△議題" || isOverallPlenaryQuestionEnd(minutes[index])) {
      boundary = index;
      break;
    }
  }
  const priorTurns = minutes.slice(boundary, startIndex).filter((minute) => minute.minute_type === "◆質問");
  const respondents = new Set();

  for (const minute of priorTurns) {
    if (/報告いたします|御説明申し上げます|少数意見報告書|提案(?:の)?理由/u.test(rawMinuteText(minute))) {
      const memberName = findMember(minute.title, { allowSeat: true });
      if (memberName) respondents.add(memberName);
    }
  }

  if (qualifier) {
    const qualified = [...priorTurns].reverse().find((minute) =>
      qualifier !== "委員長" || String(minute.title ?? "").includes("委員長")
    ) ?? priorTurns.at(-1);
    const memberName = findMember(qualified?.title, { allowSeat: true });
    if (memberName) respondents.add(memberName);
  }
  return respondents;
}

function parsePlenaryQuestionBlocks(meeting, coveredBySchedule) {
  const blocks = [];
  for (const schedule of meeting.schedules ?? []) {
    const minutes = schedule.minutes ?? [];
    const covered = coveredBySchedule.get(Number(schedule.schedule_id)) ?? new Set();
    for (let index = 0; index < minutes.length; index += 1) {
      if (covered.has(index) || !isPlenaryQuestionStart(minutes[index])) continue;

      let endIndex = minutes.length - 1;
      let closureMethod = "schedule_end";
      for (let cursor = index; cursor < minutes.length; cursor += 1) {
        if (isOverallPlenaryQuestionEnd(minutes[cursor])) {
          endIndex = cursor;
          closureMethod = "chair_declaration";
          break;
        }
      }
      const respondents = plenaryRespondents(minutes, index);
      const minuteIdsByMember = new Map();
      for (let cursor = index + 1; cursor <= endIndex; cursor += 1) {
        const minute = minutes[cursor];
        if (minute?.minute_type !== "◆質問" || isClearlyNonQuestionRoleTurn(minute)) continue;
        const memberName = findMember(minute.title, { allowSeat: true });
        if (!memberName || respondents.has(memberName)) continue;
        const current = minuteIdsByMember.get(memberName) ?? [];
        current.push(minute.minute_id);
        minuteIdsByMember.set(memberName, current);
      }

      const blockId = `s${schedule.schedule_id}-m${minutes[index].minute_id}`;
      const agendaTitle = agendaTitleBefore(minutes, index);
      for (const [memberName, minuteIds] of minuteIdsByMember) {
        blocks.push({
          councilId: Number(meeting.council_id),
          sessionName: meeting.name,
          year: String(meeting.year ?? yearFromMeetingName(meeting.name)),
          scheduleId: Number(schedule.schedule_id),
          scheduleName: schedule.name ?? "",
          blockId,
          questionKind: "plenary_question",
          memberName,
          agendaTitle,
          minuteIds: uniqueNumbers(minuteIds),
          markerMinuteId: Number(minutes[index].minute_id),
          endMinuteId: Number(minutes[endIndex]?.minute_id),
          closureMethod,
        });
      }
      index = endIndex;
    }
  }
  return blocks;
}

function segmentsForBlock(block) {
  const minuteIds = new Set(block.minuteIds.map(String));
  return (segmentsByCouncil.get(block.councilId) ?? []).filter((segment) => {
    const scheduleId = segment.source?.schedule_id ?? segment.schedule_id;
    if (String(scheduleId) !== String(block.scheduleId)) return false;
    return (segment.source?.minute_ids ?? []).some((minuteId) => minuteIds.has(String(minuteId)));
  });
}

function addOfficialBlock(block) {
  const segments = segmentsForBlock(block);
  const dates = uniqueTopics(segments.map((segment) => segment.date)).sort();
  const topics = uniqueTopics(
    segments.flatMap((segment) => extractTopicsFromText(segment.text ?? segment.excerpt))
  );
  const recordId = `${city}:official:${block.councilId}:${block.questionKind}:${block.blockId}:${block.memberName}`;
  addActivity(block.memberName, recordId, {
    record_id: recordId,
    session: block.sessionName,
    year: block.year,
    council_id: block.councilId,
    date: dates[0] ?? dateFromSchedule(block.year, block.scheduleName),
    dates: dates.length > 0 ? dates : [dateFromSchedule(block.year, block.scheduleName)].filter(Boolean),
    question_kind: block.questionKind,
    block_id: block.blockId,
    schedule_id: block.scheduleId,
    schedule_name: block.scheduleName,
    agenda_title: block.agendaTitle ?? "",
    marker_minute_id: block.markerMinuteId,
    end_minute_id: block.endMinuteId,
    closure_method: block.closureMethod,
    source_type: "official_minutes",
    source_status: "official",
    source_label: "公式会議録",
    source_url: officialMinutesUrl(),
    href: minutesHref(block.councilId, block.scheduleId, block.minuteIds[0]),
    topics,
    summary_topics: [],
    topic_details: [],
    evidence_minute_ids: block.minuteIds,
    evidence_segment_ids: segments.map((segment) => segment.id),
  });
}

const rawMeetings = [];
for (const meetingMeta of Array.isArray(minutesIndex) ? minutesIndex : []) {
  const meeting = readJson(path.join(dataDir, "minutes", `${meetingMeta.council_id}.json`), null);
  if (meeting?.schedules) rawMeetings.push(meeting);
}

const rawCapableCouncilIds = new Set();
const committeeCouncilIds = new Set();
for (const meeting of rawMeetings) {
  const councilId = Number(meeting.council_id);
  if (String(meeting.name ?? "").includes("委員会")) {
    committeeCouncilIds.add(councilId);
    continue;
  }
  if (!isRawQuestionCapableMeeting(meeting)) continue;
  rawCapableCouncilIds.add(councilId);
  const { blocks: personalBlocks, coveredBySchedule } = parsePersonalQuestionBlocks(meeting);
  for (const block of personalBlocks) addOfficialBlock(block);
  for (const block of parsePlenaryQuestionBlocks(meeting, coveredBySchedule)) addOfficialBlock(block);
}

// 委員会は従来どおりcouncil単位で束ねる。ただし討論・動議・説明等の◆turnは
// DNP上の分類が「質問」でも、質問根拠とトピックには採用しない。
const segmentGroups = new Map();
for (const [councilId, segments] of segmentsByCouncil) {
  const meeting = minutesByCouncilId.get(String(councilId));
  const sessionName = meeting?.name ?? segments[0]?.council_name ?? "";
  if (!sessionName.includes("委員会")) continue;

  for (const seg of segments) {
    if (seg.speaker_role !== "質問" || seg.is_procedural) continue;
    const memberName = findMember(seg.member_name ?? seg.speaker);
    if (!memberName) continue;
    const groupKey = `${memberName}::${councilId}`;
    const current = segmentGroups.get(groupKey) ?? { memberName, councilId, segments: [] };
    current.segments.push(seg);
    segmentGroups.set(groupKey, current);
  }
}

for (const { memberName, councilId, segments } of segmentGroups.values()) {
  const meeting = minutesByCouncilId.get(String(councilId));
  const sessionName = meeting?.name ?? segments[0]?.council_name ?? "";
  const isEnrichedQuestioner = enrichedMembersByCouncil.get(String(councilId))?.has(memberName) ?? false;
  const accepted =
    isEnrichedQuestioner ||
    likelyCommitteeQuestion(segments);
  if (!accepted) continue;

  const evidenceSegments = segments.filter((segment) => !isClearlyNonQuestionRoleTurn(segment));
  const dates = uniqueTopics(evidenceSegments.map((segment) => segment.date)).sort();
  const topics = uniqueTopics(
    evidenceSegments.flatMap((segment) => extractTopicsFromText(segment.text ?? segment.excerpt))
  );
  const blockId = "committee";
  const firstEvidenceSource = evidenceSegments.find((segment) =>
    Number.isFinite(Number(segment.source?.schedule_id))
    && Number.isFinite(Number(segment.source?.minute_ids?.[0]))
  )?.source;
  const recordId = `${city}:official:${councilId}:committee_question:${blockId}:${memberName}`;
  addActivity(memberName, recordId, {
    record_id: recordId,
    session: sessionName,
    year: String(meeting?.year ?? yearFromMeetingName(sessionName)),
    council_id: councilId,
    date: dates[0],
    dates,
    question_kind: "committee_question",
    block_id: blockId,
    schedule_id: null,
    schedule_name: "",
    agenda_title: sessionName,
    source_type: "official_minutes",
    source_status: "official",
    source_label: "公式会議録",
    source_url: officialMinutesUrl(),
    href: minutesHref(councilId, firstEvidenceSource?.schedule_id, firstEvidenceSource?.minute_ids?.[0]),
    topics,
    summary_topics: [],
    topic_details: [],
    evidence_minute_ids: uniqueNumbers(
      evidenceSegments.flatMap((segment) => segment.source?.minute_ids ?? [])
    ),
    evidence_segment_ids: evidenceSegments.map((segment) => segment.id),
  });
}

function hasOfficialRecord(memberName, councilId) {
  return [...(activity[memberName]?.sessions.values() ?? [])].some((record) =>
    record.source_status === "official" && Number(record.council_id) === Number(councilId)
  );
}

function legacyQuestionKind(sessionName) {
  if (String(sessionName ?? "").includes("委員会")) return "committee_question";
  if (String(sessionName ?? "").includes("代表質問")) return "representative_question";
  if (String(sessionName ?? "").includes("一般質問")) return "general_question";
  return "other_question";
}

const legacySegmentGroups = new Map();
for (const [councilId, segments] of segmentsByCouncil) {
  if (rawCapableCouncilIds.has(councilId) || committeeCouncilIds.has(councilId)) continue;
  for (const segment of segments) {
    if (segment.speaker_role !== "質問") continue;
    const memberName = findMember(segment.member_name ?? segment.speaker);
    if (!memberName) continue;
    const key = `${memberName}::${councilId}`;
    const current = legacySegmentGroups.get(key) ?? { memberName, councilId, segments: [] };
    current.segments.push(segment);
    legacySegmentGroups.set(key, current);
  }
}

for (const { memberName, councilId, segments } of legacySegmentGroups.values()) {
  if (hasOfficialRecord(memberName, councilId)) continue;
  const meeting = minutesByCouncilId.get(String(councilId));
  const sessionName = meeting?.name ?? segments[0]?.council_name ?? "";
  const evidenceSegments = segments.filter((segment) =>
    !segment.is_procedural && !isClearlyNonQuestionRoleTurn(segment)
  );
  if (evidenceSegments.length === 0) continue;
  const retainedSegments = evidenceSegments;
  const dates = uniqueTopics(retainedSegments.map((segment) => segment.date)).sort();
  const topics = uniqueTopics(
    retainedSegments.flatMap((segment) => extractTopicsFromText(segment.text ?? segment.excerpt))
  );
  const firstEvidenceSource = retainedSegments.find((segment) =>
    Number.isFinite(Number(segment.source?.schedule_id))
    && Number.isFinite(Number(segment.source?.minute_ids?.[0]))
  )?.source;
  const questionKind = legacyQuestionKind(sessionName);
  const blockId = "legacy-segments";
  const recordId = `${city}:official:${councilId}:${questionKind}:${blockId}:${memberName}`;
  addActivity(memberName, recordId, {
    record_id: recordId,
    session: sessionName,
    year: String(meeting?.year ?? yearFromMeetingName(sessionName)),
    council_id: councilId,
    date: dates[0],
    dates,
    question_kind: questionKind,
    block_id: blockId,
    schedule_id: null,
    schedule_name: "",
    agenda_title: sessionName,
    source_type: "official_minutes",
    source_status: "official",
    source_label: "公式会議録",
    source_url: officialMinutesUrl(),
    href: minutesHref(councilId, firstEvidenceSource?.schedule_id, firstEvidenceSource?.minute_ids?.[0]),
    topics,
    summary_topics: [],
    topic_details: [],
    evidence_minute_ids: uniqueNumbers(
      retainedSegments.flatMap((segment) => segment.source?.minute_ids ?? [])
    ),
    evidence_segment_ids: retainedSegments.map((segment) => segment.id),
  });
}

for (const supplement of enrichedSupplements.values()) {
  if (
    rawCapableCouncilIds.has(supplement.councilId)
    || committeeCouncilIds.has(supplement.councilId)
    || hasOfficialRecord(supplement.memberName, supplement.councilId)
  ) {
    continue;
  }
  const questionKind = legacyQuestionKind(supplement.sessionName);
  const blockId = "legacy-enriched";
  const recordId = `${city}:official:${supplement.councilId}:${questionKind}:${blockId}:${supplement.memberName}`;
  addActivity(supplement.memberName, recordId, {
    record_id: recordId,
    session: supplement.sessionName,
    year: yearFromMeetingName(supplement.sessionName),
    council_id: supplement.councilId,
    date: "",
    dates: [],
    question_kind: questionKind,
    block_id: blockId,
    schedule_id: null,
    schedule_name: "",
    agenda_title: supplement.sessionName,
    source_type: "official_minutes",
    source_status: "official",
    source_label: "公式会議録",
    source_url: officialMinutesUrl(),
    href: minutesHref(supplement.councilId),
    topics: supplement.topics,
    summary_topics: [],
    topic_details: [],
    evidence_minute_ids: [],
    evidence_segment_ids: [],
  });
}

// enrichedのトピックを、同一議員・同一会議の成立済みrecordへ補足する。
for (const supplement of enrichedSupplements.values()) {
  const records = [...(activity[supplement.memberName]?.sessions.entries() ?? [])]
    .filter(([, record]) =>
      record.source_status === "official"
      && Number(record.council_id) === supplement.councilId
    );
  if (records.length === 0) continue;
  const preferred = records.find(([, record]) =>
    record.question_kind === "general_question"
    || record.question_kind === "representative_question"
  ) ?? (records.length === 1 ? records[0] : null);
  if (!preferred) continue;
  addActivity(supplement.memberName, preferred[0], {
    ...preferred[1],
    topics: uniqueTopics([...(preferred[1].topics ?? []), ...supplement.topics]),
  });
}

for (const session of loadSessionFiles()) {
  for (const segment of session.segments ?? []) {
    const memberName = findMember(segment.detail?.speaker ?? segment.label);
    if (!memberName) continue;
    const topicDetails = (segment.detail?.topics ?? []).flatMap((topic) => {
      const title = String(topic?.theme ?? "").trim();
      if (!title) return [];
      return [{
        title,
        summary: String(topic.summary ?? "").trim() || undefined,
        qa: (topic.qa ?? []).flatMap((item) =>
          item?.q && item?.a ? [{ question: item.q, answer: item.a }] : []
        ),
      }];
    });
    const topics = uniqueTopics([
      ...(segment.topics ?? []),
      ...topicDetails.map((topic) => topic.title),
    ]);
    const sourceUrl = session.source_url ?? session.transcript_source_url;
    addActivity(memberName, `video:${session.id}:${segment.index}`, {
      record_id: `${city}:video:${session.id}:${segment.index}:${memberName}`,
      session: session.title ?? "",
      year: String(session.date ?? "").slice(0, 4) || yearFromMeetingName(session.title),
      council_id: 0,
      date: session.date,
      dates: session.date ? [session.date] : [],
      question_kind: "general_question",
      source_type: "video_transcript",
      source_status: "preliminary",
      source_label: "動画会議録速報",
      source_url: sourceUrl,
      source_note: session.transcript_note,
      href: `/${city}/sessions/${session.id}#seg-${segment.index}`,
      start_time: segment.start_time,
      end_time: segment.end_time,
      overview: segment.detail?.overview ?? segment.summary,
      topics,
      summary_topics: topics,
      topic_details: topicDetails,
      evidence_segment_ids: [`session:${session.id}:${segment.index}`],
    });
  }
}

// --- 大テーマへのキーワードマッピング ---
const THEME_KEYWORDS = [
  { theme: "教育",         keywords: ["学力", "学校", "教育", "授業", "不登校", "図書", "給食", "学習", "高校", "大学", "奨学"] },
  { theme: "子育て・保育", keywords: ["子育て", "保育", "幼稚園", "育児", "待機児童", "少子化", "放課後", "児童", "子ども", "こども", "出産"] },
  { theme: "福祉・介護",   keywords: ["福祉", "介護", "高齢者", "障害", "生活保護", "支援", "老人", "ケア", "デイ", "障がい"] },
  { theme: "防災・安全",   keywords: ["防災", "避難", "災害", "ハザード", "消防", "救急", "緊急", "安全", "熊", "ヒグマ", "鳥獣"] },
  { theme: "農業・農地",   keywords: ["農業", "農地", "農家", "農産", "収穫", "農協", "水田", "畜産", "漁業", "水産"] },
  { theme: "観光・交流",   keywords: ["観光", "宿泊", "インバウンド", "旅行", "交流", "イベント", "にぎわい", "シティ"] },
  { theme: "道路・インフラ", keywords: ["道路", "橋", "インフラ", "修繕", "公共施設", "舗装", "整備", "上下水道", "水道"] },
  { theme: "環境",         keywords: ["環境", "ごみ", "廃棄物", "リサイクル", "脱炭素", "カーボン", "ゼロ", "再生可能", "太陽光"] },
  { theme: "産業・経済",   keywords: ["産業", "企業", "工業", "経済", "雇用", "振興", "誘致", "工場", "商業", "商店街", "起業"] },
  { theme: "DX・デジタル", keywords: ["DX", "デジタル", "ICT", "AI", "システム", "電子", "オンライン", "マイナンバー"] },
  { theme: "財政・予算",   keywords: ["予算", "財政", "歳入", "歳出", "決算", "基金", "税", "補助金", "交付金"] },
  { theme: "健康・医療",   keywords: ["医療", "健康", "病院", "診療", "クリニック", "がん", "検診", "メンタル"] },
  { theme: "まちづくり",   keywords: ["まちづくり", "都市", "開発", "再開発", "市街地", "景観", "空き家", "移住", "定住", "人口"] },
  { theme: "交通",         keywords: ["交通", "バス", "鉄道", "自転車", "駐車", "路線", "タクシー"] },
  { theme: "スポーツ・文化", keywords: ["スポーツ", "文化", "芸術", "体育", "スタジアム", "アリーナ", "図書館", "合宿"] },
];

function extractThemes(topics) {
  const themeCounts = {};
  for (const topic of topics) {
    for (const { theme, keywords } of THEME_KEYWORDS) {
      if (keywords.some((kw) => topic.includes(kw))) {
        themeCounts[theme] = (themeCounts[theme] ?? 0) + 1;
      }
    }
  }
  return Object.entries(themeCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t);
}

const SUMMARY_TOPIC_RULES = [
  { label: "学校・教育", keywords: ["教育行政"] },
  { label: "部活動の地域移行", keywords: ["部活動", "地域移行"] },
  { label: "部活動指導員", keywords: ["部活動指導員"] },
  { label: "部活動の地域移行の受け皿", keywords: ["運営主体", "受皿"] },
  { label: "部活動の地域移行の受け皿", keywords: ["担い手確保"] },
  { label: "スケート学習", keywords: ["スケート学習"] },
  { label: "危機管理", keywords: ["危機管理体制"] },
  { label: "学校への私物端末持ち込み", keywords: ["私的デバイス"] },
  { label: "除雪・排雪", keywords: ["除排雪"] },
  { label: "除雪体制", keywords: ["除雪体制"] },
  { label: "千歳駅前の路面凍結", keywords: ["路面凍結"] },
  { label: "除雪情報の発信", keywords: ["除雪情報システム"] },
  { label: "学力向上の取り組み", keywords: ["学力向上"] },
  { label: "事業評価の見直し", keywords: ["事務事業評価"] },
  { label: "市役所の電話対応", keywords: ["電話交換"] },
  { label: "職員研修", keywords: ["職員研修"] },
  { label: "市営住宅の活用", keywords: ["市営住宅営繕"] },
  { label: "市営住宅の学生向け活用", keywords: ["市営住宅", "学生"] },
  { label: "行政ポータルアプリ", keywords: ["ポータルアプリ"] },
  { label: "外国人相談窓口", keywords: ["外国人相談窓口"] },
  { label: "学校ICT機器整備", keywords: ["ＩＣＴ機器"] },
  { label: "学校施設の維持補修", keywords: ["小中学校維持補修"] },
  { label: "学校保健・安全", keywords: ["学校保健安全"] },
  { label: "学校活動支援", keywords: ["学校活動支援"] },
  { label: "人口ビジョン", keywords: ["人口ビジョン"] },
  { label: "人口予測計画", keywords: ["人口予測"] },
  { label: "学校給食", keywords: ["学校給食", "給食"] },
  { label: "若者支援・まちづくり", keywords: ["若者支援", "まちづくり"] },
];

const IGNORE_SUMMARY_TOPIC_PATTERNS = [
  /ありがとうございます/,
  /分かりました/,
  /質問を終わります/,
  /以下の[0-9０-９一二三四五六七八九十]+つの論点/,
  /今までの評価/,
  /具体的な効果/,
  /今後の対応/,
  /参考までに/,
  /そのあたり/,
  /本来目指すべき目的/,
  /事業の予算額/,
  /この事業費/,
  /この事業の概要/,
  /内容としまして/,
  /確認だった/,
  /再度確認/,
  /語尾が分から/,
  /具体的な効果/,
  /具体的な戦略/,
  /どのように受け止め/,
  /予測されている/,
  /それじゃ全然足りない/,
  /御答弁/,
  /答弁を伺/,
  /お答え/,
  /質問ではない/,
  /感想/,
  /御挨拶/,
  /御指名/,
  /終わります/,
  /本会議において設置/,
  /委員会に付託/,
  /予算特別委員会に付託/,
  /補正予算特別委員会に付託/,
  /決算特別委員会に付託/,
  /ただいま/,
  /今回/,
  /先ほど/,
  /それでは/,
  /^[0-9]+つの事業$/,
  /^事業内容$/,
  /^本事業$/,
  /^事業の目的$/,
  /^今後の活用の見通し$/,
  /今後の活用[、，]?展開イメージ/,
  /^これらの事業の具体的な内容$/,
  /^今後の整備$/,
  /^予算額/,
];

const SUMMARY_TOPIC_ALLOW_PATTERNS = [
  /(行政|事業|業務|制度|計画|体制|方針|政策|支援|対策|整備|管理|運用|活用|連携|保全|財政|予算|決算|交通|給食|保育|医療|福祉|観光|防災|安全|人口|除雪|学習|研修|手当|会計|負担|水道|下水道|土地|道路|空港|基地|農業|鳥獣|ヒグマ|公園|図書館|郷土資料|まちづくり|ビジョン)/,
];

function toHalfWidthDigits(text) {
  return text.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

function applySummaryRule(topic) {
  return SUMMARY_TOPIC_RULES.find((rule) => rule.keywords.every((kw) => topic.includes(kw)))?.label ?? null;
}

function cleanSummaryTopic(raw) {
  const source = toHalfWidthDigits(String(raw ?? ""))
    .replace(/\s+/g, " ")
    .replace(/^[、，。・\s]+/, "")
    .trim();
  let topic = source;
  if (!topic) return null;
  if (IGNORE_SUMMARY_TOPIC_PATTERNS.some((pattern) => pattern.test(topic))) return null;

  const ruled = applySummaryRule(topic);
  if (ruled) return ruled;

  const hasExplicitTopicMarker = /(大項目|中項目|小項目|質問項目|^[0-9一二三四五六七八九十]+[点つ目]|^の[0-9一二三四五六七八九十])/.test(topic);
  if (!hasExplicitTopicMarker && topic.length > 18) return null;

  topic = topic
    .replace(/^(まずは?|続きまして|なお|初めに|最後に|改めまして|そこで|また|そして|次に|では、次に|質問を始める前に)[、，。\s]*/g, "")
    .replace(/^の[0-9一二三四五六七八九十]+(点目)?として[、，\s]*/g, "")
    .replace(/^(番|に|上で)[、，\s]*/g, "")
    .replace(/^.*?(中項目|小項目)[0-9一二三四五六七八九十（）()]*[、，:\s]*/g, "")
    .replace(/^(大項目|中項目|小項目|質問項目)[0-9一二三四五六七八九十（）()]*[、，:\s]*/g, "")
    .replace(/^(大項目|中項目|小項目|質問項目)[0-9一二三四五六七八九十（）()]*の?/g, "")
    .replace(/^[0-9一二三四五六七八九十]+[点つ目として、，\s]+/g, "")
    .replace(/^(この|その|今の|昨今、特に)/g, "")
    .replace(/[、，]?(について|に関して|をめぐって).*$/g, "")
    .replace(/(事業|業務|計画|体制|制度|方針|政策)の概要$/g, "$1")
    .replace(/^(市の|今の|この)/g, "")
    .replace(/[。、「」『』（）()]+$/g, "")
    .trim();

  if (!topic || topic.length < 3) return null;
  if (IGNORE_SUMMARY_TOPIC_PATTERNS.some((pattern) => pattern.test(topic))) return null;
  if (!SUMMARY_TOPIC_ALLOW_PATTERNS.some((pattern) => pattern.test(topic))) return null;
  if (topic.length > 18) return null;
  return topic;
}

function addSummaryTopic(result, topic) {
  if (!topic) return;
  const existingIndex = result.findIndex((item) => item === topic || item.includes(topic) || topic.includes(item));
  if (existingIndex === -1) {
    result.push(topic);
    return;
  }
  if (topic.length < result[existingIndex].length) {
    result[existingIndex] = topic;
  }
}

function summarizeTopics(topics) {
  const result = [];
  for (const topic of topics) {
    addSummaryTopic(result, cleanSummaryTopic(topic));
    if (result.length >= 12) break;
  }
  return result;
}

function toOutputSession(session) {
  const summaryTopics = session.summary_topics?.length
    ? uniqueTopics(session.summary_topics).slice(0, 12)
    : summarizeTopics(session.topics).slice(0, 8);
  return {
    ...session,
    summary_topics: summaryTopics,
  };
}

// --- 出力形式に変換 ---
const result = {};
for (const name of memberNames) {
  const a = activity[name];
  const sessions = [...a.sessions.values()]
    .map(toOutputSession)
    .sort((left, right) => {
      const leftDate = left.date || `${left.year || "0000"}-00-00`;
      const rightDate = right.date || `${right.year || "0000"}-00-00`;
      if (leftDate !== rightDate) return rightDate.localeCompare(leftDate);
      if (left.council_id !== right.council_id) return right.council_id - left.council_id;
      if (left.session !== right.session) return left.session.localeCompare(right.session, "ja");
      return left.record_id.localeCompare(right.record_id, "ja");
    });
  if (sessions.length === 0) continue;

  // トピック頻度集計
  const topicCounts = {};
  for (const s of sessions) {
    for (const t of s.topics) {
      topicCounts[t] = (topicCounts[t] ?? 0) + 1;
    }
  }
  const topTopics = Object.entries(topicCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t);

  const themes = extractThemes(topTopics);
  const summaryTopics = uniqueTopics([
    ...sessions.flatMap((session) => session.summary_topics ?? []),
    ...summarizeTopics(topTopics),
  ]).slice(0, 16);
  const officialSessions = sessions.filter((session) => session.source_status !== "preliminary");
  const preliminarySessions = sessions.filter((session) => session.source_status === "preliminary");

  result[name] = {
    name,
    session_count: sessions.length,
    official_session_count: officialSessions.length,
    preliminary_session_count: preliminarySessions.length,
    general_question_count: sessions.filter(
      (session) => session.question_kind === "general_question"
    ).length,
    representative_question_count: sessions.filter(
      (session) => session.question_kind === "representative_question"
    ).length,
    committee_question_count: sessions.filter(
      (session) => session.question_kind === "committee_question"
    ).length,
    plenary_question_count: sessions.filter(
      (session) => session.question_kind === "plenary_question"
    ).length,
    themes,
    summary_topics: summaryTopics,
    top_topics: summaryTopics.slice(0, 6),
    all_topics: topTopics,
    sessions,
  };
}

// --- 保存 ---
const json = JSON.stringify(result, null, 2);
const outData = path.join(dataDir, "members_activity.json");
const outSite = path.join(siteDataDir, "members_activity.json");
const previous = readJson(outData, {});
const previousRecordCount = Object.values(previous ?? {}).reduce(
  (total, entry) => total + (Array.isArray(entry?.sessions) ? entry.sessions.length : 0),
  0
);
const nextRecordCount = Object.values(result).reduce(
  (total, entry) => total + (Array.isArray(entry?.sessions) ? entry.sessions.length : 0),
  0
);
const allowEmpty = process.argv.includes("--allow-empty");
const allowCoverageDrop = process.argv.includes("--allow-coverage-drop");
if (previousRecordCount > 0 && nextRecordCount === 0 && !allowEmpty) {
  throw new Error(
    `安全ゲート: ${city}の質問記録が${previousRecordCount}件から0件になるため保存を中止しました。`
  );
}
if (
  previousRecordCount >= 10
  && nextRecordCount < Math.ceil(previousRecordCount * 0.5)
  && !allowCoverageDrop
) {
  throw new Error(
    `安全ゲート: ${city}の質問記録が${previousRecordCount}件から${nextRecordCount}件へ大幅に減るため保存を中止しました。`
  );
}
fs.mkdirSync(siteDataDir, { recursive: true });
fs.writeFileSync(outData, json, "utf-8");
fs.writeFileSync(outSite, json, "utf-8");

console.log(`\n完了: ${Object.keys(result).length}名分の活動データを生成`);
console.log(`保存先: ${outData}`);
