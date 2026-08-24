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

  // 4. 姓のみ3文字以上でも、入力全体が氏名の前方と一致するときだけ採用する。
  //    先頭2文字だけでは、旧議員のフルネームを同姓の現職へ誤帰属させる。
  if (normalized.length >= 3) {
    const candidates = memberNames.filter((n) => n.startsWith(normalized));
    if (candidates.length === 1) return candidates[0];
  }

  return null;
}

function uniqueTopics(items) {
  return Array.from(new Set(items.map((item) => String(item ?? "").trim()).filter(Boolean)));
}

const MAX_SESSION_CANONICAL_TOPICS = 24;
const MAX_SESSION_GENERATED_TOPICS = 24;
const MAX_MEMBER_GENERATED_TOPICS = 80;

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
    canonical_topics: uniqueTopics([
      ...(current.canonical_topics ?? []),
      ...(next.canonical_topics ?? []),
    ]).slice(0, MAX_SESSION_CANONICAL_TOPICS),
    generated_topics: uniqueTopics([
      ...(current.generated_topics ?? []),
      ...(next.generated_topics ?? []),
    ]).slice(0, MAX_SESSION_GENERATED_TOPICS),
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
const generatedTopicsByMember = new Map();
if (enrichedFiles.length > 0) {
  for (const file of enrichedFiles) {
    const data = JSON.parse(fs.readFileSync(path.join(enrichedDir, file), "utf-8"));
    const sessionName = data.name;
    const councilId = data.council_id;
    if (!minutesByCouncilId.has(String(councilId))) continue;
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
        ...(Array.isArray(q.topics) ? q.topics : []),
        ...(Array.isArray(q.ai_topics) ? q.ai_topics : []),
      ])
        .slice(0, MAX_SESSION_CANONICAL_TOPICS);
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
  if (!minutesByCouncilId.has(String(councilId))) continue;
  const fp = path.join(segmentsDir, `${councilId}.json`);
  const segments = readJson(fp, []);
  if (!Array.isArray(segments)) continue;
  segmentsByCouncil.set(councilId, segments);
}

function rawMinuteText(minute) {
  return String(minute?.text ?? minute?.title ?? "");
}

function chairStatementText(minute) {
  const text = rawMinuteText(minute);
  const title = String(minute?.title ?? "").trim();
  for (const prefix of [`○${title}`, title]) {
    if (title && text.startsWith(prefix)) return text.slice(prefix.length).trimStart();
  }
  return text;
}

function explicitIndividualQuestionMarker(minute) {
  if (minute?.minute_type !== "△議題") return null;
  const compact = rawMinuteText(minute).replace(/[　\s]/g, "");
  const match = compact.match(/^△?(.+?)(?:議員|委員)の(一般質問|代表質問)/u);
  if (!match) return null;
  return {
    rawName: match[1],
    questionKind: match[2] === "代表質問"
      ? "representative_question"
      : "general_question",
  };
}

function genericQuestionAgendaKind(minute) {
  const compact = rawMinuteText(minute).replace(/[　\s]/g, "");
  if (minute?.minute_type === "△議題") {
    if (/代表質問/u.test(compact)) return "representative_question";
    if (/(?:一般|個人)質問/u.test(compact)) return "general_question";
    return null;
  }
  if (!isChairMinute(minute)) return null;
  if (/代表質問(?:の議事)?(?:を)?(?:行います|継続(?:いた)?します|続行(?:いた)?します|続けたいと思います)/u.test(compact)) {
    return "representative_question";
  }
  if (/(?:一般|個人)質問(?:の議事)?(?:を)?(?:行います|継続(?:いた)?します|続行(?:いた)?します|続けたいと思います)/u.test(compact)) {
    return "general_question";
  }
  return null;
}

function closesPersonalQuestionAgenda(minute) {
  if (genericQuestionAgendaKind(minute)) return false;
  if (minute?.minute_type === "△議題") {
    const title = String(minute?.title ?? rawMinuteText(minute)).replace(/[　\s]/g, "");
    if (/^(?:(?:休憩|再開)(?:宣告)?|発言の訂正|議事進行の動議|会議時間の延長(?:について)?)$/u.test(title)) return false;
    if (/(?:議員|委員|君|氏)$/u.test(title)) return false;
    return true;
  }
  if (!isChairMinute(minute)) return false;
  const statement = chairStatementText(minute).replace(/[　\s]/g, "");
  if (/^(?:引き続き、?|次に、?)?日程第[^。]{0,24}(?:一般|代表|個人)質問/u.test(statement)) {
    return false;
  }
  return /^(?:引き続き、?|次に、?)?日程第/u.test(statement)
    || /^(?:引き続き、?)?(?:議案|意見書案|請願|陳情|報告)第?[0-9０-９一二三四五六七八九十]+[^。]{0,80}(?:議題|一括議題)/u.test(statement);
}

function isChairMinute(minute) {
  return minute?.minute_type === "○議長" || String(minute?.title ?? "").endsWith("議長");
}

function announcedQuestionerMarker(minute, activeKind) {
  if (!activeKind || !isChairMinute(minute)) return null;
  const compact = chairStatementText(minute).replace(/[　\s]/g, "");
  const matches = [...compact.matchAll(
    /([\p{L}々ヶヵ・]{1,24})(?:議員|委員|君|氏)の質問を(?:許可(?:いた)?します|許します)/gu
  )];
  const rawName = matches.at(-1)?.[1];
  return rawName ? { rawName, questionKind: activeKind } : null;
}

function individualQuestionMarker(minute, activeKind = null) {
  return explicitIndividualQuestionMarker(minute)
    ?? announcedQuestionerMarker(minute, genericQuestionAgendaKind(minute) ?? activeKind);
}

function individualQuestionEndingMatches(minute) {
  if (!isChairMinute(minute)) return [];
  return [...chairStatementText(minute).replace(/[　\s]/g, "").matchAll(
    /(?:([\p{L}々ヶヵ・0-9０-９（()）]{1,34}?)(?:議員|委員|議|君|氏)(?:の)?|([0-9０-９]+番)(?:の)?)(?:(一般|代表|再|個人)?(?:質問|質疑)|発言)(?:は|を|が)?(?:これで)?(?:終了(?:いた)?し(?:ます|ました)|終わ?り(?:ます|ました)|終え(?:ます|ました)|終結(?:いた)?し(?:ます|ました)|了(?:し|いたし)?ました)/gu
  )];
}

function isIndividualQuestionEnd(minute) {
  return individualQuestionEndingMatches(minute).length > 0;
}

function normalizeEndingReference(raw) {
  return String(raw ?? "")
    .replace(/[　\s]/g, "")
    .replace(/^[0-9０-９]+番[、，]?/u, "")
    .replace(/[（()）]/g, "")
    .replace(/[、，。・]/g, "")
    .trim();
}

function endingReferenceMatchesMember(raw, memberName) {
  const reference = normalizeEndingReference(raw);
  for (let offset = 0; offset < reference.length; offset += 1) {
    const suffix = reference.slice(offset);
    if (suffix.length < 2) continue;
    if (
      memberName === suffix
      || memberName.startsWith(suffix)
      || suffix.startsWith(memberName)
    ) return true;
  }
  return false;
}

function resolveMemberFromNameSuffix(raw) {
  const normalized = normalizeQuestioner(raw);
  for (let offset = 0; offset < normalized.length; offset += 1) {
    const candidate = normalized.slice(offset);
    if (!candidate) continue;
    const memberName = findMember(candidate);
    if (memberName) return memberName;
  }
  return null;
}

function declaredQuestionEndings(minute, activeKind) {
  const endings = [];
  for (const match of individualQuestionEndingMatches(minute)) {
    const rawName = match[1] ?? match[2];
    const memberName = resolveMemberFromNameSuffix(rawName);
    const questionKind = match[3] === "代表"
      ? "representative_question"
      : match[3] === "一般" || match[3] === "個人"
        ? "general_question"
        : activeKind;
    if (!questionKind) continue;
    endings.push({ rawName, memberName, questionKind });
  }
  return endings;
}

function resolveEndingMemberInRange(ending, minutes, startIndex, endIndex) {
  const hasQuestionTurn = (memberName) => minutes
    .slice(startIndex, endIndex)
    .some((minute, offset) =>
      minute?.minute_type === "◆質問"
      && speakerMatchesCanonical(minute.title, memberName)
      && !isNonQuestionTurnAt(minutes, startIndex + offset)
    );
  if (ending.memberName && hasQuestionTurn(ending.memberName)) return ending.memberName;
  const candidates = memberNames.filter((memberName) =>
    endingReferenceMatchesMember(ending.rawName, memberName)
    && hasQuestionTurn(memberName)
  );
  if (candidates.length === 1) return candidates[0];
  if (/^[0-9０-９]+番$/u.test(ending.rawName)) {
    const supported = memberNames.filter(hasQuestionTurn);
    if (supported.length === 1) return supported[0];
  }
  return null;
}

function isQuestionProgramEnd(minute) {
  if (!isChairMinute(minute)) return false;
  const statements = chairStatementText(minute)
    .replace(/[　\s]/g, "")
    .split(/[。！？]/u)
    .filter(Boolean);
  return statements.some((statement) => {
    if (/(?:全て|すべて)の議員の(?:一般|代表)質問/u.test(statement)) return true;
    if (/(?:以上で|以上をもって|これをもちまして|これにて)(?:(?!(?:議員|委員|君|氏))[^。]){0,100}(?:一般|代表|個人)質問(?:は|を)?(?:全て|すべて)?(?:終了|終結|終わ)/u.test(statement)) {
      return true;
    }
    for (const match of statement.matchAll(/(?:一般|代表|個人)質問/gu)) {
      const prefix = statement.slice(0, match.index);
      if (/(?:議員|委員|君|氏)/u.test(prefix)) continue;
      if (/(?:一般|代表|個人)質問(?:は|を)?(?:全て|すべて)?(?:終了|終結|終わ)/u.test(statement.slice(match.index))) {
        return true;
      }
    }
    return false;
  });
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

function buildPersonalQuestionMarkers(minutes) {
  const markers = new Map();
  let activeKind = null;
  for (let index = 0; index < minutes.length; index += 1) {
    if (activeKind && closesPersonalQuestionAgenda(minutes[index])) activeKind = null;
    activeKind = genericQuestionAgendaKind(minutes[index]) ?? activeKind;
    const marker = individualQuestionMarker(minutes[index], activeKind);
    if (marker) markers.set(index, marker);
    if (isQuestionProgramEnd(minutes[index])) activeKind = null;
  }
  return markers;
}

function buildDeclaredEndingBlocks(meeting, schedule, minutes, markers, covered) {
  const blocks = [];
  let activeKind = null;
  let programStartIndex = 0;
  let previousEndingIndex = -1;

  for (let endIndex = 0; endIndex < minutes.length; endIndex += 1) {
    if (activeKind && closesPersonalQuestionAgenda(minutes[endIndex])) {
      activeKind = null;
      programStartIndex = endIndex + 1;
      previousEndingIndex = -1;
    }
    const agendaKind = genericQuestionAgendaKind(minutes[endIndex]);
    if (agendaKind) {
      if (agendaKind !== activeKind) {
        previousEndingIndex = -1;
        programStartIndex = endIndex;
      }
      activeKind = agendaKind;
    }

    const endings = declaredQuestionEndings(minutes[endIndex], activeKind);
    const seen = new Set();
    for (const ending of endings) {
      const boundaryStart = Math.max(
        programStartIndex,
        previousEndingIndex >= 0 ? previousEndingIndex : programStartIndex
      );
      const memberName = resolveEndingMemberInRange(ending, minutes, boundaryStart, endIndex);
      if (!memberName) continue;
      const endingKey = `${ending.questionKind}:${memberName}`;
      if (seen.has(endingKey)) continue;
      seen.add(endingKey);

      const speakerTurnIndices = [];
      const questionTurnIndices = [];
      for (let index = boundaryStart; index < endIndex; index += 1) {
        const minute = minutes[index];
        if (
          minute?.minute_type === "◆質問"
          && speakerMatchesCanonical(minute.title, memberName)
        ) {
          speakerTurnIndices.push(index);
          if (!isNonQuestionTurnAt(minutes, index)) questionTurnIndices.push(index);
        }
      }
      if (questionTurnIndices.length === 0) continue;

      const firstTurnIndex = speakerTurnIndices[0];
      let markerIndex = firstTurnIndex;
      for (const [candidateIndex, marker] of markers) {
        if (candidateIndex < boundaryStart || candidateIndex > firstTurnIndex) continue;
        const markerMember = resolveMemberFromNameSuffix(marker.rawName);
        if (
          markerMember === memberName
          && marker.questionKind === ending.questionKind
        ) {
          markerIndex = candidateIndex;
        }
      }

      for (let index = markerIndex; index < endIndex; index += 1) covered.add(index);
      blocks.push({
        councilId: Number(meeting.council_id),
        sessionName: meeting.name,
        year: String(meeting.year ?? yearFromMeetingName(meeting.name)),
        scheduleId: Number(schedule.schedule_id),
        scheduleName: schedule.name ?? "",
        blockId: `s${schedule.schedule_id}-m${minutes[markerIndex].minute_id}`,
        questionKind: ending.questionKind,
        memberName,
        agendaTitle: ending.questionKind === "representative_question" ? "代表質問" : "一般質問",
        minuteIds: uniqueNumbers(questionTurnIndices.map((index) => minutes[index].minute_id)),
        markerMinuteId: Number(minutes[markerIndex].minute_id),
        endMinuteId: Number(minutes[endIndex].minute_id),
        closureMethod: "chair_declaration",
      });
    }

    if (isIndividualQuestionEnd(minutes[endIndex])) previousEndingIndex = endIndex;
    if (isQuestionProgramEnd(minutes[endIndex])) {
      activeKind = null;
      programStartIndex = endIndex + 1;
      previousEndingIndex = -1;
    }
  }

  return blocks;
}

function parsePersonalQuestionBlocks(meeting) {
  const blocks = [];
  const coveredBySchedule = new Map();

  for (const schedule of meeting.schedules ?? []) {
    const minutes = schedule.minutes ?? [];
    const covered = new Set();
    const markers = buildPersonalQuestionMarkers(minutes);
    coveredBySchedule.set(Number(schedule.schedule_id), covered);

    blocks.push(...buildDeclaredEndingBlocks(meeting, schedule, minutes, markers, covered));

    for (let index = 0; index < minutes.length; index += 1) {
      const marker = markers.get(index);
      if (!marker || covered.has(index)) continue;
      const memberName = findMember(marker.rawName);

      let endIndex = minutes.length - 1;
      let closureMethod = "schedule_end";
      for (let cursor = index + 1; cursor < minutes.length; cursor += 1) {
        if (isQuestionProgramEnd(minutes[cursor])) {
          endIndex = cursor;
          closureMethod = "question_program_end";
          break;
        }
        if (markers.has(cursor)) {
          endIndex = cursor - 1;
          closureMethod = "next_question_marker";
          break;
        }
        if (isIndividualQuestionEnd(minutes[cursor])) {
          endIndex = cursor;
          closureMethod = "chair_declaration";
          break;
        }
        const nextMember = minutes[cursor]?.minute_type === "◆質問"
          && !isNonQuestionTurnAt(minutes, cursor)
          ? findMember(minutes[cursor].title, { allowSeat: true })
          : null;
        if (nextMember && nextMember !== memberName) {
          endIndex = cursor - 1;
          closureMethod = "next_question_speaker";
          break;
        }
      }
      for (let cursor = index; cursor <= endIndex; cursor += 1) covered.add(cursor);

      if (memberName) {
        const minuteIds = minutes
          .slice(index + 1, endIndex + 1)
          .filter((minute, offset) =>
            minute.minute_type === "◆質問"
            && speakerMatchesCanonical(minute.title, memberName)
            && !isNonQuestionTurnAt(minutes, index + 1 + offset)
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
      if (activeKind && closesPersonalQuestionAgenda(minutes[index])) activeKind = null;
      activeKind = genericQuestionAgendaKind(minutes[index]) ?? activeKind;
      if (isQuestionProgramEnd(minutes[index])) {
        activeKind = null;
        continue;
      }
      if (isIndividualQuestionEnd(minutes[index])) continue;
      if (
        !activeKind
        || covered.has(index)
        || minutes[index]?.minute_type !== "◆質問"
        || isNonQuestionTurnAt(minutes, index)
      ) continue;

      const memberName = findMember(minutes[index].title, { allowSeat: true });
      if (!memberName) continue;
      let endIndex = minutes.length - 1;
      let closureMethod = "schedule_end";
      for (let cursor = index + 1; cursor < minutes.length; cursor += 1) {
        if (isQuestionProgramEnd(minutes[cursor])) {
          endIndex = cursor;
          closureMethod = "question_program_end";
          break;
        }
        if (markers.has(cursor)) {
          endIndex = cursor - 1;
          closureMethod = "next_question_marker";
          break;
        }
        if (isIndividualQuestionEnd(minutes[cursor])) {
          endIndex = cursor;
          closureMethod = "chair_declaration";
          break;
        }
        const nextMember = minutes[cursor]?.minute_type === "◆質問"
          && !isNonQuestionTurnAt(minutes, cursor)
          ? findMember(minutes[cursor].title, { allowSeat: true })
          : null;
        if (nextMember && nextMember !== memberName) {
          endIndex = cursor - 1;
          closureMethod = "next_question_speaker";
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
          && !isNonQuestionTurnAt(minutes, cursor)
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
      if (closureMethod === "question_program_end") activeKind = null;
      index = endIndex;
    }
  }

  const byMemberBoundary = new Map();
  for (const block of blocks) {
    const key = [block.councilId, block.scheduleId, block.questionKind, block.memberName].join(":");
    const current = byMemberBoundary.get(key);
    if (!current) {
      byMemberBoundary.set(key, block);
      continue;
    }
    const first = Number(block.markerMinuteId) < Number(current.markerMinuteId) ? block : current;
    const last = Number(block.endMinuteId) > Number(current.endMinuteId) ? block : current;
    byMemberBoundary.set(key, {
      ...first,
      blockId: `s${first.scheduleId}-m${first.markerMinuteId}`,
      minuteIds: uniqueNumbers([...current.minuteIds, ...block.minuteIds]),
      endMinuteId: last.endMinuteId,
      closureMethod: last.closureMethod,
    });
  }
  return { blocks: [...byMemberBoundary.values()], coveredBySchedule };
}

function isPlenaryQuestionStart(minute) {
  if (!isChairMinute(minute)) return false;
  const text = rawMinuteText(minute);
  return /ただいまから[^。\n]*質疑を行います/u.test(text)
    || /(?:第[0-9０-９一二三四五六七八九十]+款|同款)[^。\n]{0,80}質疑(?:に付します|を続行(?:いた)?します)/u.test(text);
}

function plenaryScopeMarker(minute) {
  const compact = rawMinuteText(minute).normalize("NFKC").replace(/[　\s]/g, "");
  const explicit = compact.match(/第([0-9一二三四五六七八九十]+)款/u);
  if (explicit) return { type: "explicit", key: `款:${explicit[1]}` };
  if (/同款[^。\n]{0,80}質疑を続行(?:いた)?します/u.test(compact)) {
    return { type: "same", key: null };
  }
  return { type: "other", key: null };
}

function isOverallPlenaryQuestionEnd(minute) {
  const text = rawMinuteText(minute);
  return isChairMinute(minute)
    && (
      /質疑終結(?:いた)?しました/u.test(text)
      || (
        /質疑を終わります/u.test(text)
        && !/[一-龠々ぁ-んァ-ヶ]+議員の質疑を終わります/u.test(text)
      )
    );
}

function isRawQuestionCapableMeeting(meeting) {
  return (meeting.schedules ?? []).some((schedule) =>
    (schedule.minutes ?? []).some((minute) =>
      explicitIndividualQuestionMarker(minute)
      || genericQuestionAgendaKind(minute)
      || isPlenaryQuestionStart(minute)
    )
  );
}

function isPureCorrectionOrWithdrawal(text) {
  if (text.length > 240) return false;
  const action = text.match(
    /(?:訂正とおわびを申し上げます?|訂正(?:いたします|します|させていただきます)|(?:発言|質問|質疑)[\s\S]{0,220}?(?:撤回(?:したい|します|いたします)|取り?消し(?:たい|ます|いたします)|却下(?:します|いたします)))/u
  );
  if (!action) return false;
  const tail = text
    .slice((action.index ?? 0) + action[0].length)
    .replace(/^[\s　。！？、，]+/u, "");
  return !/(?:伺|お聞き|お尋ね|(?:お)?教えて|お教え|お知らせ|説明(?:を)?(?:願|いただ)|お願いしたい|いかが|どう(?:でしょう|です)|でしょうか|ですか|ますか)/u.test(tail);
}

function hasSubstantiveQuestionSignal(text) {
  const withoutClosings = String(text ?? "")
    .replace(/質問(?:は|を)?(?:しません|いたしません|しない|いたさない|するつもりはありません)/gu, "")
    .replace(/(?:(?:私|以上|これ)の)?(?:質問|質疑)(?:を|は)?(?:終わ(?:ります|りたいと思います|らせていただきます)|終了(?:します|いたします))/gu, "");
  return /(?:質問|質疑|伺|聞|尋|問(?:い|う|え|わせ|われ)|答(?:え|弁)|御?見解|御?所見|御?説明|教|知らせ|示|確認|いかが|どう|どの(?:よう|くらい|程度|ぐらい)|何(?:件|人|割|点|回|年|月|日|円|％|パーセント)|[?？]|(?:の|なの|なのです|です|ます|ません|でしょう)か(?:[、。？！]|$))/u.test(withoutClosings);
}

function isExplicitNoQuestionClosing(text) {
  const negative = String(text ?? "").match(
    /質問(?:は|を)?(?:しません|いたしません|しない|いたさない|するつもりはありません)/u
  );
  if (!negative) return false;
  const remainder = text.slice((negative.index ?? 0) + negative[0].length);
  const asksAfterward = /(?:質問(?:します|いたします|があります)|質疑(?:します|いたします)|伺|聞(?:き|かせ)|尋ね|問(?:い|う|わせ)|答(?:え|弁)|御?見解|御?所見|いかが|どう|どの(?:よう|程度|くらい|ぐらい)|何(?:件|人|割|点|回|年|月|日|円|％)|[?？]|(?:の|なの|です|ます|ません|でしょう)か(?:[、。？！]|$))/u.test(remainder);
  const compact = text.replace(/[\s　]+/g, "");
  return !asksAfterward
    && /(?:終わ(?:ります|りたい)|以上(?:です|であります))[^。]*[。！]?$/u.test(compact);
}

function hasTerminalNoAnswerClosing(text) {
  const compact = String(text ?? "").replace(/[\s　]+/g, "");
  const questionClose = /(?:(?:私|以上|これ)(?:から)?の)?(?:質問|質疑)(?:を|は)?[、，]?(?:これで)?(?:終わ(?:ります|りたい(?:と思います)?|らせていただき(?:ます|たいと思います))|終え(?:ます|たい(?:と思います)?)|終了(?:します|いたします|させていただき(?:ます|たいと思います)))(?:[。！]*(?:どうも)?ありがとうございました)?(?:[。！]*以上です)?[。！]*$/u;
  const bareClose = /(?:これで)?終わ(?:ります|りたい(?:と思います)?|らせていただき(?:ます|たいと思います))[。！]*(?:ありがとうございました[。！]*)?(?:以上です[。！]*)?$/u;
  return questionClose.test(compact) || bareClose.test(compact);
}

function hasResponseBeforeNextQuestionBoundary(minutes, index) {
  for (let cursor = index + 1; cursor < minutes.length; cursor += 1) {
    const minute = minutes[cursor];
    const text = rawMinuteText(minute);
    if (minute?.minute_type === "◎答弁" || /^◎/u.test(text)) return true;
    if (
      isChairMinute(minute)
      && /(?:答弁を求め|答弁願|御?答弁(?:を|願)|お答え(?:を|願)|説明を求め)/u.test(text)
    ) {
      return true;
    }
    if (minute?.minute_type === "◆質問" || minute?.minute_type === "△議題") return false;
    if (
      isChairMinute(minute)
      && /(?:他に|次に|質疑終結|質疑を(?:保留|終わ)|暫時休憩|散会|質問(?:は|を)?(?:終了|終結|終わ)|議員(?:の質問)?を許)/u.test(text)
    ) {
      return false;
    }
  }
  return false;
}

function isClearlyNonQuestionRoleTurn(minute) {
  const text = rawMinuteText(minute).replace(/^[◆△◎○][^　\s]*[　\s]*/, "").trim();
  if (isPureCorrectionOrWithdrawal(text)) return true;
  if (/^(?:以上です|これで)?終わります[。！]?$/u.test(text)) return true;
  if (/^御異議なしと認め|本日はこれをもちまして散会/u.test(text)) return true;
  if (text.length <= 80 && !/(?:質問|質疑|伺|お聞き|お尋ね)/u.test(text) && /^(?:分かりました|了解しました|ありがとうございます)[^。]*(?:よろしく|結構|以上)/u.test(text)) {
    return true;
  }
  if (/(?:反対|賛成)(?:する)?立場から討論|討論を(?:行|させて)|動議を(?:提出|かけ|発議)|議会運営委員会を開いて(?:協議|調査)|指名いたします|御説明申し上げます|^少数意見報告書|^(?:御)?報告(?:いた|申し上げ)ます/u.test(text)) {
    return true;
  }
  if (isExplicitNoQuestionClosing(text)) return true;
  const hasQuestionSignal = hasSubstantiveQuestionSignal(text);
  const compact = text.replace(/[\s　]+/g, "");
  if (!hasQuestionSignal) {
    if (
      text.length <= 220
      && /(?:以上(?:です|で(?:、)?(?:終わ|終わり)|であります)|(?:(?:私|以上|これ)の)?(?:質問|質疑)(?:を|は)?終わ(?:ります|りたいと思います|らせていただきます)|終わ(?:ります|りたいと思います|らせていただきます)|ありがとうございました|よろしく(?:お願い(?:いた)?します|頼みます)|お願い(?:いた)?します)[。！]*(?:ありがとうございました[。！]*)?(?:以上です[。！]*)?$/u.test(compact)
    ) {
      return true;
    }
    if (
      /(?:要望|指摘)(?:を)?(?:して|させていただいて|いたしまして)[^。]{0,55}(?:(?:(?:私|以上|これ)の)?(?:質問|質疑)(?:を|は)?)?(?:終わ(?:ります|りたい)|以上(?:です|であります))(?:ありがとうございました[。！]*)?(?:以上です[。！]*)?$/su.test(compact)
    ) {
      return true;
    }
  }
  return !hasQuestionSignal && (
    /自己紹介(?:を|させて|いたし)/u.test(text)
    || /(?:委員長報告|委員会[^\n。]*(?:経過|結果)[^\n。]*報告)/u.test(text)
  );
}

function isNonQuestionTurnAt(minutes, index) {
  const minute = minutes[index];
  if (isClearlyNonQuestionRoleTurn(minute)) return true;
  if (minute?.minute_type !== "◆質問") return false;
  for (let cursor = index - 1; cursor >= Math.max(0, index - 8); cursor -= 1) {
    const prior = minutes[cursor];
    const text = rawMinuteText(prior);
    if (/(?:発言の訂正|訂正の申出|議事進行)/u.test(text)) return true;
    if (genericQuestionAgendaKind(prior) || individualQuestionMarker(prior)) return false;
    if (prior?.minute_type === "△議題" && closesPersonalQuestionAgenda(prior)) return false;
  }
  return false;
}

function isNonQuestionPlenaryTurnAt(minutes, index) {
  if (isNonQuestionTurnAt(minutes, index)) return true;
  const minute = minutes[index];
  if (minute?.minute_type !== "◆質問") return false;
  const text = rawMinuteText(minute).replace(/^[◆△◎○][^　\s]*[　\s]*/, "").trim();
  return hasTerminalNoAnswerClosing(text)
    && !hasResponseBeforeNextQuestionBoundary(minutes, index);
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
  const blocksByRecord = new Map();
  for (const schedule of meeting.schedules ?? []) {
    const minutes = schedule.minutes ?? [];
    const covered = coveredBySchedule.get(Number(schedule.schedule_id)) ?? new Set();
    let resumableScope = null;
    for (let index = 0; index < minutes.length; index += 1) {
      if (covered.has(index) || !isPlenaryQuestionStart(minutes[index])) continue;

      const defaultBlockId = `s${schedule.schedule_id}-m${minutes[index].minute_id}`;
      const scopeMarker = plenaryScopeMarker(minutes[index]);
      let blockId = defaultBlockId;
      if (scopeMarker.type === "explicit") {
        resumableScope = { key: scopeMarker.key, blockId: defaultBlockId };
      } else if (scopeMarker.type === "same" && resumableScope) {
        blockId = resumableScope.blockId;
      } else {
        resumableScope = null;
      }

      let endIndex = minutes.length - 1;
      let closureMethod = "schedule_end";
      for (let cursor = index + 1; cursor < minutes.length; cursor += 1) {
        if (isPlenaryQuestionStart(minutes[cursor])) {
          endIndex = cursor - 1;
          closureMethod = "next_plenary_agenda";
          break;
        }
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
        if (minute?.minute_type !== "◆質問" || isNonQuestionPlenaryTurnAt(minutes, cursor)) continue;
        const memberName = findMember(minute.title, { allowSeat: true });
        if (!memberName || respondents.has(memberName)) continue;
        const current = minuteIdsByMember.get(memberName) ?? [];
        current.push(minute.minute_id);
        minuteIdsByMember.set(memberName, current);
      }

      const agendaTitle = agendaTitleBefore(minutes, index);
      for (const [memberName, minuteIds] of minuteIdsByMember) {
        const recordKey = `${blockId}:${memberName}`;
        const nextBlock = {
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
        };
        const current = blocksByRecord.get(recordKey);
        blocksByRecord.set(recordKey, current
          ? {
              ...current,
              minuteIds: uniqueNumbers([...current.minuteIds, ...nextBlock.minuteIds]),
              endMinuteId: nextBlock.endMinuteId,
              closureMethod: nextBlock.closureMethod,
            }
          : nextBlock);
      }
      if (closureMethod === "chair_declaration") resumableScope = null;
      index = endIndex;
    }
  }
  return [...blocksByRecord.values()];
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
const rawMeetingByCouncilId = new Map(
  rawMeetings.map((meeting) => [Number(meeting.council_id), meeting])
);
const recordEvidenceTextCache = new Map();

function compactEvidenceText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}々ヶヵー]+/gu, "");
}

function recordEvidenceText(record) {
  if (recordEvidenceTextCache.has(record.record_id)) {
    return recordEvidenceTextCache.get(record.record_id);
  }
  const evidenceSegmentIds = new Set(record.evidence_segment_ids ?? []);
  const evidenceTexts = (segmentsByCouncil.get(Number(record.council_id)) ?? [])
    .filter((segment) => evidenceSegmentIds.has(segment.id))
    .map((segment) => segment.text ?? segment.excerpt ?? "");

  const meeting = rawMeetingByCouncilId.get(Number(record.council_id));
  const evidenceMinuteIds = new Set((record.evidence_minute_ids ?? []).map(Number));
  const hasScheduleId = record.schedule_id !== null
    && record.schedule_id !== undefined
    && Number.isFinite(Number(record.schedule_id));
  if (hasScheduleId) {
    const scheduleId = Number(record.schedule_id);
    evidenceTexts.push(
      ...(meeting?.schedules ?? [])
        .filter((schedule) => Number(schedule.schedule_id) === scheduleId)
        .flatMap((schedule) => schedule.minutes ?? [])
        .filter((minute) => evidenceMinuteIds.has(Number(minute.minute_id)))
        .map(rawMinuteText)
    );
  }
  const uniqueTexts = new Map();
  for (const text of evidenceTexts) {
    const compactText = compactEvidenceText(text);
    if (compactText && !uniqueTexts.has(compactText)) uniqueTexts.set(compactText, text);
  }
  const compact = compactEvidenceText([...uniqueTexts.values()].join(" "));
  recordEvidenceTextCache.set(record.record_id, compact);
  return compact;
}

function canonicalTopicAssignments(records, topics) {
  const assignments = new Map(records.map(([recordId]) => [recordId, []]));
  for (const topic of topics) {
    const compactTopic = compactEvidenceText(topic);
    if (!compactTopic) continue;
    for (const [recordId, record] of records) {
      if (recordEvidenceText(record).includes(compactTopic)) {
        assignments.get(recordId).push(topic);
      }
    }
  }
  return assignments;
}

for (const meeting of rawMeetings) {
  if (String(meeting.name ?? "").includes("委員会")) {
    continue;
  }
  if (!isRawQuestionCapableMeeting(meeting)) continue;
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

// enriched単独では質問記録を成立させない。原文上の質問turnを持つ
// 同一議員・同一会議のrecordがある場合だけ、表示用トピックを補足する。
for (const supplement of enrichedSupplements.values()) {
  const records = [...(activity[supplement.memberName]?.sessions.entries() ?? [])]
    .filter(([, record]) =>
      record.source_status === "official"
      && Number(record.council_id) === supplement.councilId
    );
  if (records.length === 0) continue;
  const assignments = canonicalTopicAssignments(records, supplement.topics);
  const canonicalTopicSet = new Set([...assignments.values()].flat());
  const generatedTopics = supplement.topics.filter((topic) => !canonicalTopicSet.has(topic));
  if (generatedTopics.length > 0) {
    generatedTopicsByMember.set(
      supplement.memberName,
      uniqueTopics([
        ...(generatedTopicsByMember.get(supplement.memberName) ?? []),
        ...generatedTopics,
      ]).slice(0, MAX_MEMBER_GENERATED_TOPICS)
    );
  }
  for (const [recordId, canonicalTopics] of assignments) {
    const record = activity[supplement.memberName].sessions.get(recordId);
    const recordGeneratedTopics = records.length === 1 ? generatedTopics : [];
    if (canonicalTopics.length === 0 && recordGeneratedTopics.length === 0) continue;
    addActivity(supplement.memberName, recordId, {
      ...record,
      canonical_topics: uniqueTopics([
        ...(record.canonical_topics ?? []),
        ...canonicalTopics,
      ]).slice(0, MAX_SESSION_CANONICAL_TOPICS),
      generated_topics: uniqueTopics([
        ...(record.generated_topics ?? []),
        ...recordGeneratedTopics,
      ]).slice(0, MAX_SESSION_GENERATED_TOPICS),
    });
  }
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

const MAX_SESSION_DISPLAY_TOPICS = 12;
const MAX_MEMBER_ALL_TOPICS = 80;

function classificationStatus(sessions) {
  const hasLegacyUnclassified = sessions.some((session) =>
    session.block_id === "legacy-segments" || session.block_id === "legacy-enriched"
  );
  if (!hasLegacyUnclassified) return "classified";
  const hasClassified = sessions.some((session) =>
    session.block_id !== "legacy-segments" && session.block_id !== "legacy-enriched"
  );
  return hasClassified ? "mixed" : "legacy_unclassified";
}

function toOutputSession(session) {
  const canonicalTopics = uniqueTopics(session.canonical_topics ?? [])
    .slice(0, MAX_SESSION_CANONICAL_TOPICS);
  const derivedSummaryTopics = session.summary_topics?.length
    ? uniqueTopics(session.summary_topics)
    : summarizeTopics(session.topics).slice(0, 8);
  const summaryTopics = uniqueTopics([
    ...canonicalTopics,
    ...derivedSummaryTopics,
  ]).slice(0, 12);
  const generatedTopics = uniqueTopics(session.generated_topics ?? [])
    .filter((topic) => !canonicalTopics.includes(topic))
    .slice(0, MAX_SESSION_GENERATED_TOPICS);
  return {
    ...session,
    // Full excerpts remain in minutes/segments and are referenced by the
    // evidence IDs. The activity projection keeps only a bounded display list.
    topics: uniqueTopics(session.topics).slice(0, MAX_SESSION_DISPLAY_TOPICS),
    canonical_topics: canonicalTopics.length > 0 ? canonicalTopics : undefined,
    generated_topics: generatedTopics.length > 0 ? generatedTopics : undefined,
    summary_topics: summaryTopics,
  };
}

// --- 出力形式に変換 ---
const result = {};
for (const name of memberNames) {
  const a = activity[name];
  const rawSessions = [...a.sessions.values()]
    .sort((left, right) => {
      const leftDate = left.date || `${left.year || "0000"}-00-00`;
      const rightDate = right.date || `${right.year || "0000"}-00-00`;
      if (leftDate !== rightDate) return rightDate.localeCompare(leftDate);
      if (left.council_id !== right.council_id) return right.council_id - left.council_id;
      if (left.session !== right.session) return left.session.localeCompare(right.session, "ja");
      return left.record_id.localeCompare(right.record_id, "ja");
    });
  if (rawSessions.length === 0) continue;

  // トピック頻度集計
  const topicCounts = {};
  for (const s of rawSessions) {
    for (const t of s.topics) {
      topicCounts[t] = (topicCounts[t] ?? 0) + 1;
    }
  }
  const topTopics = Object.entries(topicCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t);

  const sessions = rawSessions.map(toOutputSession);
  const themes = extractThemes(topTopics);
  const summaryTopics = uniqueTopics([
    ...sessions.flatMap((session) => session.summary_topics ?? []),
    ...summarizeTopics(topTopics),
  ]).slice(0, 16);
  const officialSessions = sessions.filter((session) => session.source_status !== "preliminary");
  const preliminarySessions = sessions.filter((session) => session.source_status === "preliminary");

  result[name] = {
    name,
    classification_status: classificationStatus(sessions),
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
    other_question_count: sessions.filter(
      (session) => session.question_kind === "other_question"
    ).length,
    themes,
    summary_topics: summaryTopics,
    generated_topics: generatedTopicsByMember.get(name) ?? [],
    top_topics: summaryTopics.slice(0, 6),
    all_topics: topTopics.slice(0, MAX_MEMBER_ALL_TOPICS),
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
