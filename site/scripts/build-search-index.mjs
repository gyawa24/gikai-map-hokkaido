#!/usr/bin/env node
// 議事録本文を議題単位で集約した軽量な全文検索インデックスを生成する。
//
// 目的: Function bundle に data/*/minutes/*.json (202MB) を含めないため、
//       build 時に全議事録を議題単位で truncate して 1 ファイルに纏める。
//       /api/search はそのインデックス 1 本だけを読めば議題横断の全文検索ができる。
//
// 出力: site/data/_search-index.json (~4-5 MB)
// 構造: { version: 1, generated_at, agendas: [ { city, council_id, ... } ] }
//
// 実行: `npm run build-search-index` または `npm run build` の prebuild で自動実行

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(SITE_DIR, "data");
const SOURCE_DATA_DIR = path.resolve(SITE_DIR, "..", "data");
const OUT_FILE = path.join(DATA_DIR, "_search-index.json");
const PUBLIC_GENERATED_DIR = path.join(SITE_DIR, "public", "generated");
const PUBLIC_SEARCH_INDEX_FILE = path.join(PUBLIC_GENERATED_DIR, "search-index.json");
const PUBLIC_RECENT_SEARCH_INDEX_FILE = path.join(PUBLIC_GENERATED_DIR, "search-index-recent.json");
const PUBLIC_CITY_SEARCH_INDEX_DIR = path.join(PUBLIC_GENERATED_DIR, "search-indexes");
const PUBLIC_CITY_BIGRAM_INDEX_DIR = path.join(PUBLIC_GENERATED_DIR, "search-bigram-cities");
const PUBLIC_TOPICS_INDEX_FILE = path.join(PUBLIC_GENERATED_DIR, "topics-index.json");
const SEGMENT_FALLBACKS_FILE = path.join(DATA_DIR, "search_segment_fallbacks.json");

const AGENDA_MARKER = "△議題";
const DISCUSSION_TYPES = new Set([
  "◆質問",
  "◎答弁",
  "◎市長",
  "○一般質問",
]);
const EXCERPT_MAX = 400;
const RECENT_YEAR_WINDOW = 2;
const BIGRAM_BUCKET_COUNT = 64;
const BIGRAM_MIN_CITY_INDEX_BYTES = 250 * 1024;

function cleanText(s) {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

function cleanIndexText(s) {
  return cleanText(s)
    .replace(/([、。！？]){2,}/g, "$1")
    .replace(/[・･]{3,}/g, "・")
    .replace(/[‐‑‒–—―ー－-]{3,}/g, "ー");
}

function normalizeForBigramSearch(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .replace(/\u3000/g, " ")
    .replace(/[ァ-ヶ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60))
    .toLowerCase()
    .trim();
}

function compactForBigramSearch(text) {
  return normalizeForBigramSearch(text).replace(/[^\p{L}\p{N}]+/gu, "");
}

function bigramsForSearch(text) {
  const compact = compactForBigramSearch(text);
  if (!compact) return [];
  if (compact.length === 1) return [compact];
  const terms = [];
  for (let i = 0; i < compact.length - 1; i += 1) {
    terms.push(compact.slice(i, i + 2));
  }
  return Array.from(new Set(terms));
}

function bigramBucket(term) {
  let hash = 0;
  for (let i = 0; i < term.length; i += 1) {
    hash = ((hash * 31) + term.charCodeAt(i)) >>> 0;
  }
  return hash % BIGRAM_BUCKET_COUNT;
}

function bigramBucketFile(bucket) {
  return `${bucket.toString(16).padStart(2, "0")}.json`;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dateFromScheduleName(year, scheduleName) {
  const normalized = cleanText(scheduleName).replace(/[０-９]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xfee0)
  );
  const match = normalized.match(/(\d{1,2})月(\d{1,2})日/);
  if (!year || !match) return "";
  const month = match[1].padStart(2, "0");
  const day = match[2].padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeMinuteBodyForIndex(speaker, text) {
  const normalizedSpeaker = cleanText(speaker);
  let body = cleanIndexText(text);
  if (!normalizedSpeaker || !body) return body;
  body = body.replace(new RegExp(`^[◆◎○]?\\s*${escapeRegExp(normalizedSpeaker)}\\s*`), "");
  return body.trim();
}

function yearFromDate(date) {
  return cleanText(date).match(/^(\d{4})/)?.[1] ?? "";
}

function memberActivityQuestionLabel(questionKind) {
  if (questionKind === "general_question") return "一般質問";
  if (questionKind === "representative_question") return "代表質問";
  if (questionKind === "committee_question") return "委員会質疑";
  if (questionKind === "plenary_question") return "本会議質疑";
  if (questionKind === "other_question") return "質問";
  return "質問記録";
}

function memberActivitySearchSourceType(activity) {
  return activity.source_status === "preliminary"
    || activity.source_type === "video_transcript"
    || String(activity.href ?? "").includes("/sessions/")
    ? "session"
    : "minutes";
}

// 会議名から西暦を推定（令和◯年 → 2018+N）
function yearFromCouncilName(name) {
  const norm = (name ?? "").replace(/[０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0)
  );
  const reiwa = norm.match(/令和\s*(\d+)/);
  if (reiwa) return String(2018 + Number(reiwa[1]));
  const heisei = norm.match(/平成\s*(\d+)/);
  if (heisei) return String(1988 + Number(heisei[1]));
  const west = norm.match(/(\d{4})/);
  if (west) return west[1];
  return "";
}

function normalizeYearValue(value) {
  const text = cleanText(value);
  if (!text) return "";
  return yearFromCouncilName(text) || yearFromDate(text);
}

function yearNumber(value, fallback) {
  const year = normalizeYearValue(value) || normalizeYearValue(fallback);
  const numeric = Number(year);
  return Number.isFinite(numeric) ? numeric : 0;
}

function latestIndexYear({ agendas, sessions, enriched, memberActivities }) {
  const years = [
    ...agendas.map((row) => yearNumber(row.year || row.date, row.council_name)),
    ...sessions.map((row) => yearNumber(row.date, row.title)),
    ...enriched.map((row) => yearNumber(row.name, row.generated_at)),
    ...memberActivities.map((row) => yearNumber(row.year, row.council_name)),
  ].filter((year) => year > 0);
  return years.length ? Math.max(...years) : new Date().getFullYear();
}

function withoutTranscript(session) {
  return {
    ...session,
    segments: (session.segments ?? []).map((segment) => {
      const nextSegment = { ...segment };
      delete nextSegment.transcript;
      return nextSegment;
    }),
  };
}

function buildRecentRuntimeIndex(runtimeOut) {
  const recentToYear = latestIndexYear(runtimeOut);
  const recentFromYear = recentToYear - RECENT_YEAR_WINDOW + 1;
  const isRecent = (value, fallback) => yearNumber(value, fallback) >= recentFromYear;
  return {
    ...runtimeOut,
    scope: "recent",
    recent_from_year: recentFromYear,
    recent_to_year: recentToYear,
    count: runtimeOut.agendas.filter((row) => isRecent(row.year || row.date, row.council_name)).length,
    agendas: runtimeOut.agendas.filter((row) => isRecent(row.year || row.date, row.council_name)),
    sessions: (runtimeOut.sessions ?? [])
      .filter((row) => isRecent(row.date, row.title))
      .map(withoutTranscript),
    enriched: (runtimeOut.enriched ?? []).filter((row) => isRecent(row.name, row.generated_at)),
    memberActivities: (runtimeOut.memberActivities ?? []).filter((row) => isRecent(row.year, row.council_name)),
  };
}

function pushSearchDocument(documents, doc, additionalSearchText = "") {
  const searchText = cleanText([
    doc.cityName,
    doc.title,
    doc.committee,
    doc.label,
    doc.speaker,
    doc.body,
    doc.context,
    doc.metaText,
    doc.member_name,
    doc.name,
    doc.furigana,
    doc.party,
    doc.faction,
    ...(doc.committees ?? []),
    additionalSearchText,
  ].filter(Boolean).join(" "));
  if (!searchText) return;
  documents.push({
    ...doc,
    body: cleanText(doc.body).slice(0, 500),
    context: cleanText(doc.context || doc.body).slice(0, 700),
    metaText: cleanText(doc.metaText),
    _searchText: searchText,
  });
}

function buildFullTextCouncilDocuments(city, cityRuntimeOut) {
  const indexedCouncilIds = new Set(
    (cityRuntimeOut.agendas ?? []).map((row) => String(row.council_id))
  );
  const minutesIndex = readJson(path.join(DATA_DIR, city, "minutes", "index.json"), []);
  if (!Array.isArray(minutesIndex)) return [];

  const cityName = cityRuntimeOut.municipalities?.[0]?.name
    ?? cityRuntimeOut.agendas?.[0]?.cityName
    ?? cityRuntimeOut.members?.[0]?.cityName
    ?? city;
  const documents = [];

  for (const entry of minutesIndex) {
    const councilId = Number(entry?.council_id);
    if (!Number.isFinite(councilId) || indexedCouncilIds.has(String(councilId))) continue;

    const segments = readJson(
      path.join(SOURCE_DATA_DIR, city, "segments", `${councilId}.json`),
      []
    );
    if (!Array.isArray(segments)) continue;
    const searchableSegments = segments.filter(
      (segment) => !segment?.is_procedural && cleanText(segment?.text)
    );
    if (searchableSegments.length === 0) continue;

    const councilName = cleanText(entry?.name)
      || cleanText(searchableSegments[0]?.council_name)
      || `会議録 ${councilId}`;
    const year = normalizeYearValue(entry?.year) || yearFromCouncilName(councilName);
    const date = searchableSegments.find((segment) => cleanText(segment?.date))?.date ?? "";
    const fullText = searchableSegments
      .map((segment) => [
        segment.speaker,
        segment.speaker_role,
        segment.member_name,
        segment.text,
      ].filter(Boolean).join(" "))
      .join(" ");

    pushSearchDocument(
      documents,
      {
        id: `agenda-fulltext:${city}:${councilId}`,
        source: "agenda",
        sourceType: "minutes",
        city,
        cityName,
        council_id: councilId,
        title: councilName,
        committee: "公式議事録",
        label: "会議録全文",
        body: "",
        context: "公式議事録の全文を検索対象にしています。",
        metaText: [year, date].filter(Boolean).join(" "),
        href: `/${city}/minutes/${councilId}`,
        date,
        year,
        field: "議事録本文",
        fullTextIndexed: true,
      },
      fullText
    );
  }

  return documents;
}

function buildCityBigramDocuments(city, cityRuntimeOut) {
  const documents = [];

  for (const row of cityRuntimeOut.agendas ?? []) {
    pushSearchDocument(documents, {
      id: `agenda:${row.city}:${row.council_id}:${row.schedule_index}:${row.first_minute_id ?? "x"}`,
      source: "agenda",
      sourceType: "minutes",
      city: row.city,
      cityName: row.cityName,
      council_id: row.council_id,
      title: row.council_name,
      committee: row.agenda_title || "議題",
      label: row.schedule_name,
      body: row.text,
      context: [row.agenda_title, row.text].join(" "),
      metaText: [row.year, row.date, row.schedule_name].join(" "),
      href: row.first_minute_id !== null
        ? `/${row.city}/minutes/${row.council_id}`
        : `/${row.city}/minutes/${row.council_id}`,
      date: row.date,
      year: row.year || yearFromCouncilName(row.council_name),
      field: "議事録",
    });
  }

  documents.push(...buildFullTextCouncilDocuments(city, cityRuntimeOut));

  for (const row of cityRuntimeOut.memberActivities ?? []) {
    const summaryTopics = Array.isArray(row.summary_topics) ? row.summary_topics : [];
    const rawTopics = Array.isArray(row.topics) ? row.topics : [];
    const topicText = [...summaryTopics, ...rawTopics].join("、");
    const questionLabel = memberActivityQuestionLabel(row.question_kind);
    const sourceLabel = row.source_label || (row.source_status === "preliminary" ? "会議録速報" : "公式議事録");
    const fallbackHref = Number(row.council_id) > 0
      ? `/${row.city}/minutes/${row.council_id}`
      : `/${row.city}`;
    pushSearchDocument(documents, {
      id: `member_activity:${row.record_id || `${row.city}:${row.member_name}:${row.council_id}:${row.date || "undated"}`}`,
      source: "member_activity",
      sourceType: memberActivitySearchSourceType(row),
      city: row.city,
      cityName: row.cityName,
      council_id: row.council_id,
      member_name: row.member_name,
      record_id: row.record_id,
      title: row.council_name,
      committee: `${row.member_name}議員の${questionLabel}`,
      label: [sourceLabel, questionLabel].filter(Boolean).join("・"),
      body: [row.overview, topicText].filter(Boolean).join(" "),
      context: [
        row.overview,
        summaryTopics.length > 0
          ? `質問テーマ: ${summaryTopics.join("、")}`
          : rawTopics.length > 0
            ? `議事録からの抜粋: ${rawTopics.slice(0, 3).join("。")}`
            : "",
      ].filter(Boolean).join(" "),
      metaText: [row.year, row.date, sourceLabel, row.source_status, questionLabel].filter(Boolean).join(" "),
      href: row.href || fallbackHref,
      date: row.date,
      start_time: row.start_time,
      year: row.year || yearFromCouncilName(row.council_name),
      overview: row.overview,
      question_kind: row.question_kind,
      source_label: row.source_label,
      source_status: row.source_status,
      field: questionLabel,
    });
  }

  for (const row of cityRuntimeOut.members ?? []) {
    const seatNumber = Number(row.seat_number);
    pushSearchDocument(documents, {
      id: `member:${row.city}:${Number.isFinite(seatNumber) ? seatNumber : row.name}`,
      source: "member",
      city: row.city,
      cityName: row.cityName,
      name: row.name,
      member_name: row.name,
      title: row.name,
      body: [row.furigana, row.party, row.faction, ...(row.committees ?? [])].join(" "),
      metaText: Number.isFinite(seatNumber) ? `${seatNumber}番` : "",
      href: Number.isFinite(seatNumber) && seatNumber > 0
        ? `/${row.city}/members/${seatNumber}`
        : `/${row.city}`,
      furigana: row.furigana,
      party: row.party,
      faction: row.faction,
      committees: row.committees ?? [],
    });
  }

  for (const row of cityRuntimeOut.sessions ?? []) {
    for (const segment of row.segments ?? []) {
      const segmentIdentity = segment.speaker && segment.label?.includes(segment.speaker)
        ? segment.label
        : [segment.speaker, segment.label].filter(Boolean).join("・");
      const segmentText = [segment.summary, ...(segment.topics ?? []), segment.transcript]
        .filter(Boolean)
        .join(" ");
      pushSearchDocument(documents, {
        id: `session:${row.city}:${row.id}:${segment.index}`,
        source: "session",
        sourceType: "session",
        city: row.city,
        cityName: row.cityName,
        title: row.title,
        committee: row.committee,
        label: segment.label,
        speaker: segment.speaker,
        body: [segment.label, segment.speaker, segmentText].filter(Boolean).join(" "),
        context: [segmentIdentity, segmentText].filter(Boolean).join(": "),
        metaText: [row.date, row.committee, segment.speaker, segment.label, segment.start_time].join(" "),
        href: `/${row.city}/sessions/${row.id}#seg-${segment.index}`,
        date: row.date,
        start_time: segment.start_time,
        year: yearFromDate(row.date) || yearFromCouncilName(row.title),
        field: segment.summary ? "要約" : "会議録速報",
      });
    }
  }

  for (const row of cityRuntimeOut.enriched ?? []) {
    pushSearchDocument(documents, {
      id: `enriched:${row.city}:${row.council_id}`,
      source: "enriched",
      sourceType: "minutes",
      city: row.city,
      cityName: row.cityName,
      council_id: row.council_id,
      title: row.name,
      body: [row.summary, ...(row.highlights ?? []), ...(row.tags ?? [])].join(" "),
      context: row.summary || (row.highlights ?? []).join("、"),
      metaText: row.generated_at,
      href: `/${row.city}/minutes/${row.council_id}`,
      year: yearFromCouncilName(row.name) || yearFromDate(row.generated_at),
      field: "AI要約",
    });
  }

  for (const [index, row] of (cityRuntimeOut.decisions ?? []).entries()) {
    pushSearchDocument(documents, {
      id: `decision:${row.city}:${index}`,
      source: "decision",
      sourceType: "decision",
      city: row.city,
      cityName: row.cityName,
      title: row.session,
      committee: "議決結果",
      body: row.description,
      context: [row.session, row.description].join(" "),
      href: `/${row.city}/decisions`,
      year: yearFromCouncilName(row.session),
      field: "議決",
    });
  }

  return documents;
}

function writeCityBigramIndex(city, documentsWithSearchText, generatedAt) {
  const cityDir = path.join(PUBLIC_CITY_BIGRAM_INDEX_DIR, city);
  const postingsDir = path.join(cityDir, "postings");
  const buckets = new Map();

  documentsWithSearchText.forEach((doc, docIndex) => {
    for (const term of bigramsForSearch(doc._searchText)) {
      const bucket = bigramBucket(term);
      if (!buckets.has(bucket)) buckets.set(bucket, {});
      const postings = buckets.get(bucket);
      if (!postings[term]) postings[term] = [];
      postings[term].push(docIndex);
    }
  });

  const documents = documentsWithSearchText.map((doc) => {
    const publicDoc = { ...doc };
    delete publicDoc._searchText;
    return publicDoc;
  });
  fs.mkdirSync(postingsDir, { recursive: true });
  fs.writeFileSync(path.join(cityDir, "documents.json"), JSON.stringify(documents));

  const bucketFiles = [];
  for (let bucket = 0; bucket < BIGRAM_BUCKET_COUNT; bucket += 1) {
    const file = bigramBucketFile(bucket);
    const postings = buckets.get(bucket) ?? {};
    fs.writeFileSync(path.join(postingsDir, file), JSON.stringify(postings));
    bucketFiles.push(file);
  }

  fs.writeFileSync(
    path.join(cityDir, "manifest.json"),
    JSON.stringify({
      version: 1,
      generated_at: generatedAt,
      scope: "city-bigram",
      city,
      document_count: documents.length,
      bucket_count: BIGRAM_BUCKET_COUNT,
      buckets: bucketFiles,
    })
  );
}

function getCityName(municipalities, slug) {
  const m = municipalities.find((x) => x.slug === slug);
  return m?.name ?? slug;
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

function buildSessions(city, cityName) {
  const sessionsDir = path.join(DATA_DIR, city, "sessions");
  const indexPath = path.join(sessionsDir, "index.json");
  const index = readJson(indexPath, []);
  if (!Array.isArray(index)) return [];

  return index.flatMap((entry) => {
    if (!entry?.has_summary || (entry.segment_count ?? 0) === 0) return [];
    const session = readJson(path.join(sessionsDir, `${entry.id}.json`), null);
    if (!session) return [];
    return [
      {
        city,
        cityName,
        id: session.id ?? entry.id,
        title: session.title ?? "",
        committee: session.committee ?? "",
        date: session.date ?? "",
        segments: (session.segments ?? []).map((seg) => ({
          index: seg.index ?? 0,
          label: seg.label ?? "",
          speaker: seg.speaker ?? seg.detail?.speaker ?? "",
          start_time: seg.start_time ?? "",
          summary: seg.summary ?? "",
          topics: Array.isArray(seg.topics) ? seg.topics : [],
          transcript: seg.transcript ?? "",
        })),
      },
    ];
  });
}

function buildEnrichedDocs(city, cityName) {
  const enrichedDir = path.join(DATA_DIR, city, "minutes", "enriched");
  if (!fs.existsSync(enrichedDir)) return [];
  return fs
    .readdirSync(enrichedDir)
    .filter((file) => file.endsWith(".json"))
    .flatMap((file) => {
      const doc = readJson(path.join(enrichedDir, file), null);
      if (!doc) return [];
      return [
        {
          city,
          cityName,
          council_id: doc.council_id,
          name: doc.name ?? "",
          generated_at: doc.generated_at ?? "",
          summary: doc.summary ?? "",
          highlights: Array.isArray(doc.highlights) ? doc.highlights : [],
          tags: Array.isArray(doc.tags) ? doc.tags : [],
        },
      ];
    });
}

function buildDecisions(city, cityName) {
  const decisions = readJson(path.join(DATA_DIR, city, "decisions.json"), []);
  if (!Array.isArray(decisions)) return [];
  return decisions.map((decision) => ({
    city,
    cityName,
    session: decision.session ?? "",
    description: decision.description ?? "",
  }));
}

function buildMembers(city, cityName) {
  const members = readJson(path.join(DATA_DIR, city, "members.json"), []);
  if (Array.isArray(members) && members.length > 0) {
    return members.map((member) => ({
      city,
      cityName,
      seat_number: Number.isFinite(Number(member.seat_number)) ? Number(member.seat_number) : null,
      name: member.name ?? "",
      furigana: member.furigana ?? "",
      party: member.party ?? "",
      faction: member.faction ?? "",
      committees: Array.isArray(member.committees) ? member.committees : [],
    }));
  }

  const election = readJson(path.join(DATA_DIR, city, "election.json"), null);
  const candidates = Array.isArray(election?.candidates) ? election.candidates : [];
  return candidates
    .filter((candidate) => candidate.result === "当選")
    .map((candidate) => ({
      city,
      cityName,
      seat_number: null,
      name: candidate.name ?? "",
      furigana: candidate.furigana ?? "",
      party: candidate.party ?? "",
      faction: candidate.party ?? "",
      committees: [],
    }));
}

function buildMemberActivities(city, cityName) {
  const activity = readJson(path.join(DATA_DIR, city, "members_activity.json"), {});
  if (!activity || typeof activity !== "object" || Array.isArray(activity)) return [];

  return Object.values(activity).flatMap((entry) => {
    const memberName = cleanText(entry?.name);
    const sessions = Array.isArray(entry?.sessions) ? entry.sessions : [];
    if (!memberName || sessions.length === 0) return [];

    return sessions
      .filter((session) => Number.isFinite(Number(session?.council_id)) && Number(session.council_id) >= 0)
      .map((session) => {
        const councilName = cleanText(session.session);
        const summaryTopics = Array.isArray(session.summary_topics)
          ? session.summary_topics.map(cleanText).filter(Boolean)
          : [];
        const topics = Array.isArray(session.topics)
          ? session.topics.map(cleanText).filter(Boolean)
          : [];
        const runtimeActivity = {
          city,
          cityName,
          member_name: memberName,
          record_id: cleanText(session.record_id),
          council_id: Number(session.council_id),
          council_name: councilName,
          year: cleanText(session.year) || yearFromCouncilName(councilName),
          date: cleanText(session.date),
          href: cleanText(session.href),
          overview: cleanText(session.overview),
          question_kind: cleanText(session.question_kind),
          source_type: cleanText(session.source_type),
          source_label: cleanText(session.source_label),
          source_status: cleanText(session.source_status),
          start_time: cleanText(session.start_time),
          topics: summaryTopics.length ? [] : topics.slice(0, 6),
          summary_topics: summaryTopics,
        };
        return Object.fromEntries(
          Object.entries(runtimeActivity).filter(([, value]) => (
            value !== "" && (!Array.isArray(value) || value.length > 0)
          ))
        );
      });
  });
}

function buildSegmentFallbackAgendas({ city, cityName, councilId, councilName, year }) {
  const segments = readJson(path.join(DATA_DIR, city, "segments", `${councilId}.json`), []);
  if (!Array.isArray(segments) || segments.length === 0) return [];

  return segments
    .filter((seg) => !seg.is_procedural && cleanText(seg.text))
    .map((seg, index) => {
      const speaker = cleanText(seg.speaker);
      const role = cleanText(seg.speaker_role);
      const body = cleanText(seg.text);
      const scheduleId = Number.isFinite(Number(seg.schedule_id)) ? Number(seg.schedule_id) : 1;
      const scheduleName = cleanText(seg.schedule_name);
      return {
        city,
        cityName,
        council_id: councilId,
        council_name: councilName,
        year,
        date: dateFromScheduleName(year, scheduleName),
        schedule_index: Math.max(0, scheduleId - 1),
        schedule_name: scheduleName,
        agenda_title: [role, speaker].filter(Boolean).join(": ") || `発言 ${index + 1}`,
        first_minute_id: 0,
        text: body.slice(0, EXCERPT_MAX),
        truncated: body.length > EXCERPT_MAX,
      };
    });
}

function buildIndex() {
  const municipalitiesPath = path.join(DATA_DIR, "municipalities.json");
  const municipalities = JSON.parse(fs.readFileSync(municipalitiesPath, "utf-8"));
  const segmentFallbackCities = new Set(readJson(SEGMENT_FALLBACKS_FILE, []));

  /** @type {Array<object>} */
  const agendas = [];
  /** @type {Array<object>} */
  const sessions = [];
  /** @type {Array<object>} */
  const enriched = [];
  /** @type {Array<object>} */
  const decisions = [];
  /** @type {Array<object>} */
  const members = [];
  /** @type {Array<object>} */
  const memberActivities = [];

  const cityDirs = fs
    .readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
    .map((d) => d.name);

  for (const city of cityDirs) {
    const cityName = getCityName(municipalities, city);
    sessions.push(...buildSessions(city, cityName));
    enriched.push(...buildEnrichedDocs(city, cityName));
    decisions.push(...buildDecisions(city, cityName));
    members.push(...buildMembers(city, cityName));
    memberActivities.push(...buildMemberActivities(city, cityName));

    const minutesDir = path.join(DATA_DIR, city, "minutes");
    const indexPath = path.join(minutesDir, "index.json");
    if (!fs.existsSync(indexPath)) continue;

    let councilIndex;
    try {
      councilIndex = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
    } catch {
      continue;
    }

    for (const entry of councilIndex) {
      const councilFile = path.join(minutesDir, entry.file);
      if (!fs.existsSync(councilFile)) continue;
      let council;
      try {
        council = JSON.parse(fs.readFileSync(councilFile, "utf-8"));
      } catch {
        continue;
      }

      const councilId = council.council_id ?? entry.council_id;
      const councilName = council.name ?? entry.name;
      const year = entry.year || yearFromCouncilName(councilName);
      const agendaCountBeforeCouncil = agendas.length;

      for (let schIdx = 0; schIdx < (council.schedules ?? []).length; schIdx++) {
        const sch = council.schedules[schIdx];
        let currentAgendaTitle = null;
        let currentAgendaBody = [];
        let currentFirstMinuteId = null;
        const schName = cleanText(sch.name);
        const schDate = dateFromScheduleName(year, schName);

        const flush = () => {
          if (!currentAgendaTitle && currentAgendaBody.length === 0) return;
          const body = cleanIndexText(currentAgendaBody.join(" "));
          agendas.push({
            city,
            cityName,
            council_id: councilId,
            council_name: councilName,
            year,
            date: schDate,
            schedule_index: schIdx,
            schedule_name: schName,
            agenda_title: currentAgendaTitle ?? "",
            first_minute_id: currentFirstMinuteId,
            text: body.slice(0, EXCERPT_MAX),
            truncated: body.length > EXCERPT_MAX,
          });
        };

        for (const m of sch.minutes ?? []) {
          if (m.minute_type === "名簿") continue;
          if (m.minute_type === AGENDA_MARKER) {
            flush();
            currentAgendaTitle = cleanText(m.text).replace(/^△/, "");
            currentAgendaBody = [];
            currentFirstMinuteId = m.minute_id ?? null;
          } else if (DISCUSSION_TYPES.has(m.minute_type)) {
            if (currentFirstMinuteId === null) currentFirstMinuteId = m.minute_id ?? null;
            const speaker = cleanText(m.title);
            const body = normalizeMinuteBodyForIndex(speaker, m.text);
            currentAgendaBody.push(speaker ? `${speaker}: ${body}` : body);
          }
        }
        flush();
      }

      if (segmentFallbackCities.has(city) && agendas.length === agendaCountBeforeCouncil) {
        agendas.push(
          ...buildSegmentFallbackAgendas({
            city,
            cityName,
            councilId,
            councilName,
            year,
          })
        );
      }
    }
  }

  const out = {
    version: 1,
    generated_at: new Date().toISOString(),
    excerpt_max: EXCERPT_MAX,
    count: agendas.length,
    agendas,
  };

  const runtimeAgendas = agendas.map((agenda) => {
    const row = { ...agenda };
    delete row.truncated;
    delete row.first_minute_id;
    return row;
  });
  const runtimeOut = {
    ...out,
    agendas: runtimeAgendas,
    scope: "full",
    municipalities: municipalities
      .filter((m) => m.active)
      .map((m) => ({ slug: m.slug, name: m.name })),
    sessions,
    enriched,
    decisions,
    members,
    memberActivities,
  };
  const recentRuntimeOut = buildRecentRuntimeIndex(runtimeOut);
  const topicsOut = {
    version: 1,
    generated_at: out.generated_at,
    count: enriched.length,
    records: enriched,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(out));
  fs.mkdirSync(PUBLIC_GENERATED_DIR, { recursive: true });
  fs.mkdirSync(PUBLIC_CITY_SEARCH_INDEX_DIR, { recursive: true });
  fs.rmSync(PUBLIC_CITY_BIGRAM_INDEX_DIR, { recursive: true, force: true });
  fs.mkdirSync(PUBLIC_CITY_BIGRAM_INDEX_DIR, { recursive: true });
  fs.writeFileSync(PUBLIC_SEARCH_INDEX_FILE, JSON.stringify(runtimeOut));
  fs.writeFileSync(PUBLIC_RECENT_SEARCH_INDEX_FILE, JSON.stringify(recentRuntimeOut));
  for (const city of cityDirs) {
    const cityRuntimeOut = {
      ...out,
      scope: "city",
      count: agendas.filter((row) => row.city === city).length,
      agendas: agendas.filter((row) => row.city === city),
      municipalities: runtimeOut.municipalities.filter((row) => row.slug === city),
      sessions: sessions.filter((row) => row.city === city),
      enriched: enriched.filter((row) => row.city === city),
      decisions: decisions.filter((row) => row.city === city),
      members: members.filter((row) => row.city === city),
      memberActivities: memberActivities.filter((row) => row.city === city),
    };
    const cityRuntimeJson = JSON.stringify(cityRuntimeOut);
    fs.writeFileSync(
      path.join(PUBLIC_CITY_SEARCH_INDEX_DIR, `${city}.json`),
      cityRuntimeJson
    );
    const cityBigramDocuments = buildCityBigramDocuments(city, cityRuntimeOut);
    const hasFullTextDocuments = cityBigramDocuments.some((doc) => doc.fullTextIndexed);
    if (
      hasFullTextDocuments
      || Buffer.byteLength(cityRuntimeJson) >= BIGRAM_MIN_CITY_INDEX_BYTES
    ) {
      writeCityBigramIndex(city, cityBigramDocuments, out.generated_at);
    }
  }
  fs.writeFileSync(PUBLIC_TOPICS_INDEX_FILE, JSON.stringify(topicsOut));
  const stat = fs.statSync(OUT_FILE);
  const runtimeStat = fs.statSync(PUBLIC_SEARCH_INDEX_FILE);
  const recentRuntimeStat = fs.statSync(PUBLIC_RECENT_SEARCH_INDEX_FILE);
  const topicsStat = fs.statSync(PUBLIC_TOPICS_INDEX_FILE);
  console.log(
    `search-index written: ${OUT_FILE.replace(SITE_DIR, "site")} (${agendas.length} agendas, ${(stat.size / 1024 / 1024).toFixed(1)} MB)`
  );
  console.log(
    `runtime search-index written: ${PUBLIC_SEARCH_INDEX_FILE.replace(SITE_DIR, "site")} (${(runtimeStat.size / 1024 / 1024).toFixed(1)} MB)`
  );
  console.log(
    `recent search-index written: ${PUBLIC_RECENT_SEARCH_INDEX_FILE.replace(SITE_DIR, "site")} (${(recentRuntimeStat.size / 1024 / 1024).toFixed(1)} MB, gzip ${(zlib.gzipSync(fs.readFileSync(PUBLIC_RECENT_SEARCH_INDEX_FILE)).length / 1024 / 1024).toFixed(2)} MB)`
  );
  console.log(
    `topics-index written: ${PUBLIC_TOPICS_INDEX_FILE.replace(SITE_DIR, "site")} (${enriched.length} records, ${(topicsStat.size / 1024 / 1024).toFixed(1)} MB)`
  );
}

buildIndex();
