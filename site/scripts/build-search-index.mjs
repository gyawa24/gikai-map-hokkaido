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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(SITE_DIR, "data");
const OUT_FILE = path.join(DATA_DIR, "_search-index.json");
const PUBLIC_GENERATED_DIR = path.join(SITE_DIR, "public", "generated");
const PUBLIC_SEARCH_INDEX_FILE = path.join(PUBLIC_GENERATED_DIR, "search-index.json");
const PUBLIC_CITY_SEARCH_INDEX_DIR = path.join(PUBLIC_GENERATED_DIR, "search-indexes");
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

function cleanText(s) {
  return (s ?? "").replace(/\s+/g, " ").trim();
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
      .filter((session) => Number.isFinite(Number(session?.council_id)) && Number(session.council_id) > 0)
      .map((session) => {
        const councilName = cleanText(session.session);
        const summaryTopics = Array.isArray(session.summary_topics)
          ? session.summary_topics.map(cleanText).filter(Boolean)
          : [];
        const topics = Array.isArray(session.topics)
          ? session.topics.map(cleanText).filter(Boolean)
          : [];
        return {
          city,
          cityName,
          member_name: memberName,
          council_id: Number(session.council_id),
          council_name: councilName,
          year: cleanText(session.year) || yearFromCouncilName(councilName),
          topics: summaryTopics.length ? [] : topics.slice(0, 6),
          summary_topics: summaryTopics,
        };
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
      return {
        city,
        cityName,
        council_id: councilId,
        council_name: councilName,
        year,
        schedule_index: Math.max(0, scheduleId - 1),
        schedule_name: cleanText(seg.schedule_name),
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
        const schName = sch.name ?? "";

        const flush = () => {
          if (!currentAgendaTitle && currentAgendaBody.length === 0) return;
          const body = currentAgendaBody.join(" ");
          agendas.push({
            city,
            cityName,
            council_id: councilId,
            council_name: councilName,
            year,
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
            const speaker = m.title ? `${m.title}: ` : "";
            currentAgendaBody.push(speaker + cleanText(m.text));
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

  const runtimeOut = {
    ...out,
    municipalities: municipalities
      .filter((m) => m.active)
      .map((m) => ({ slug: m.slug, name: m.name })),
    sessions,
    enriched,
    decisions,
    members,
    memberActivities,
  };
  const topicsOut = {
    version: 1,
    generated_at: out.generated_at,
    count: enriched.length,
    records: enriched,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(out));
  fs.mkdirSync(PUBLIC_GENERATED_DIR, { recursive: true });
  fs.mkdirSync(PUBLIC_CITY_SEARCH_INDEX_DIR, { recursive: true });
  fs.writeFileSync(PUBLIC_SEARCH_INDEX_FILE, JSON.stringify(runtimeOut));
  for (const city of cityDirs) {
    const cityRuntimeOut = {
      ...out,
      count: agendas.filter((row) => row.city === city).length,
      agendas: agendas.filter((row) => row.city === city),
      municipalities: runtimeOut.municipalities.filter((row) => row.slug === city),
      sessions: sessions.filter((row) => row.city === city),
      enriched: enriched.filter((row) => row.city === city),
      decisions: decisions.filter((row) => row.city === city),
      members: members.filter((row) => row.city === city),
      memberActivities: memberActivities.filter((row) => row.city === city),
    };
    fs.writeFileSync(
      path.join(PUBLIC_CITY_SEARCH_INDEX_DIR, `${city}.json`),
      JSON.stringify(cityRuntimeOut)
    );
  }
  fs.writeFileSync(PUBLIC_TOPICS_INDEX_FILE, JSON.stringify(topicsOut));
  const stat = fs.statSync(OUT_FILE);
  const runtimeStat = fs.statSync(PUBLIC_SEARCH_INDEX_FILE);
  const topicsStat = fs.statSync(PUBLIC_TOPICS_INDEX_FILE);
  console.log(
    `search-index written: ${OUT_FILE.replace(SITE_DIR, "site")} (${agendas.length} agendas, ${(stat.size / 1024 / 1024).toFixed(1)} MB)`
  );
  console.log(
    `runtime search-index written: ${PUBLIC_SEARCH_INDEX_FILE.replace(SITE_DIR, "site")} (${(runtimeStat.size / 1024 / 1024).toFixed(1)} MB)`
  );
  console.log(
    `topics-index written: ${PUBLIC_TOPICS_INDEX_FILE.replace(SITE_DIR, "site")} (${enriched.length} records, ${(topicsStat.size / 1024 / 1024).toFixed(1)} MB)`
  );
}

buildIndex();
