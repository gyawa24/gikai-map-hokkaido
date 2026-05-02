#!/usr/bin/env node
/**
 * 北海道議会の録画配信ページから、minutes 未収録の会期を sessions として取り込む
 *
 * 使い方:
 *   node site/scripts/bootstrap-hokkaido-stream-meeting.mjs --title "令和8年第1回定例会"
 *
 * オプション:
 *   --title <text>     会議名（例: 令和8年第1回定例会）
 *   --kaigi-id <id>    配信側の kaigi を直接指定する場合
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const SITE_ROOT = path.resolve(__dirname, "..");
const city = "hokkaido";

const BASE_URL = "https://pref-hokkaido.gijiroku.com/";
const SEARCH_URL = `${BASE_URL}g07_Video_Search.asp?Sflg=1`;

const args = process.argv.slice(2);
const get = (flag) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
};

const titleFilter = get("--title");
const explicitKaigiId = get("--kaigi-id");

if (!titleFilter && !explicitKaigiId) {
  console.error(
    "Usage: node site/scripts/bootstrap-hokkaido-stream-meeting.mjs --title <text> [--kaigi-id <id>]"
  );
  process.exit(1);
}

function normalizeText(text) {
  return String(text ?? "").normalize("NFKC").replace(/\s+/g, "");
}

function htmlDecode(text) {
  return String(text ?? "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&#39;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&nbsp;", " ");
}

function stripTags(text) {
  return htmlDecode(text)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\u3000/g, " ")
    .trim();
}

function absoluteUrl(url) {
  return new URL(url, BASE_URL).toString();
}

async function fetchShiftJis(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0",
    },
  });
  if (!res.ok) throw new Error(`fetch failed: ${res.status} ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  return new TextDecoder("shift_jis").decode(buffer);
}

function parseMeetings(html) {
  const meetings = [];
  for (const match of html.matchAll(/<option value="(\d+)"[^>]*>([^<]+)<\/option>/g)) {
    meetings.push({
      kaigi_id: match[1],
      name: htmlDecode(match[2]).trim(),
    });
  }
  return meetings;
}

function parseDayEntries(html, year) {
  const entries = [];
  for (const match of html.matchAll(
    /g07_Video_Search\.asp\?Sflg=1&amp;kaigi=(\d+)&amp;NitteiID=(\d+)'>\s*([^<]+)\s*<\/a>/g
  )) {
    const label = htmlDecode(match[3]).trim();
    const parts = label.split(/　+/);
    const datePart = parts[0] ?? "";
    const committee = parts.slice(1).join(" ").trim() || "本会議";
    const md = datePart.match(/(\d{1,2})月(\d{1,2})日/);
    if (!md) continue;

    entries.push({
      kaigi_id: match[1],
      nittei_id: match[2],
      date: `${year}-${String(Number(md[1])).padStart(2, "0")}-${String(Number(md[2])).padStart(2, "0")}`,
      committee,
      url: absoluteUrl(`g07_Video_Search.asp?Sflg=1&kaigi=${match[1]}&NitteiID=${match[2]}`),
    });
  }
  return entries;
}

async function fetchPlayerMetadata(viewUrl) {
  const viewHtml = await fetchShiftJis(viewUrl);
  const playerMatch = viewHtml.match(/<iframe[^>]+src="([^"]+)"[^>]*title="録画再生画面"/);
  if (!playerMatch) return null;

  const playerUrl = absoluteUrl(playerMatch[1]);
  const playerHtml = await fetch(playerUrl, {
    headers: { "user-agent": "Mozilla/5.0" },
  }).then((res) => res.text());

  return {
    player_url: playerUrl,
    media_url: playerHtml.match(/"file":\s*"([^"]+)"/)?.[1] ?? null,
    thumbnail_url:
      playerHtml.match(/<meta property="og:image" content="([^"]+)"/)?.[1] ?? null,
  };
}

async function parseSegmentsForNittei(url) {
  const html = await fetchShiftJis(url);
  const rows = html.match(/<tr>[\s\S]*?g07_Video_View\.asp\?SrchID=\d+[\s\S]*?<\/tr>/g) ?? [];
  const segments = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const relViewUrl = row.match(/g07_Video_View\.asp\?SrchID=\d+/)?.[0];
    if (!relViewUrl) continue;

    const viewUrl = absoluteUrl(relViewUrl);
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => stripTags(m[1]));
    const speaker = cells[0] || undefined;
    const agenda = cells[1] || undefined;
    const player = await fetchPlayerMetadata(viewUrl);

    segments.push({
      title: [speaker ?? null, agenda ?? null].filter(Boolean).join(" / ") || `segment-${i + 1}`,
      speaker,
      view_url: viewUrl,
      player_url: player?.player_url,
      media_url: player?.media_url,
      thumbnail_url: player?.thumbnail_url,
    });
  }

  return segments;
}

function readExistingSessions() {
  const dir = path.join(ROOT, "data", city, "sessions");
  const map = new Map();
  if (!fs.existsSync(dir)) return map;
  for (const file of fs.readdirSync(dir)) {
    if (file === "index.json" || !file.endsWith(".json")) continue;
    const session = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));
    map.set(session.id, session);
  }
  return map;
}

function buildSessionTitle(meetingName, date, committee) {
  const dateLabel = `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;
  if (!committee || committee === "本会議") return `${meetingName} ${dateLabel}`;
  return `${meetingName} ${dateLabel} ${committee}`;
}

function makeSessionId(kaigiId, nitteiId, date) {
  return `${kaigiId}-${nitteiId}-${date.replaceAll("-", "")}`;
}

function toIndex(sessions) {
  return sessions.map((session) => ({
    id: session.id,
    youtube_id: session.youtube_id,
    source_type: session.source_type,
    source_url: session.source_url,
    source_label: session.source_label,
    source_thumbnail_url: session.source_thumbnail_url,
    title: session.title,
    date: session.date,
    committee: session.committee,
    segment_count: session.segments.length,
    has_transcript: session.segments.length > 0,
    has_summary: session.segments.some((seg) => !!seg.summary),
    speakers: [],
  }));
}

function saveAll(sessions) {
  const index = toIndex(sessions);
  for (const base of [path.join(ROOT, "data"), path.join(SITE_ROOT, "data")]) {
    const dir = path.join(base, city, "sessions");
    fs.mkdirSync(dir, { recursive: true });
    for (const session of sessions) {
      fs.writeFileSync(path.join(dir, `${session.id}.json`), JSON.stringify(session, null, 2), "utf-8");
    }
    fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify(index, null, 2), "utf-8");
  }
}

const meetings = parseMeetings(await fetchShiftJis(SEARCH_URL));
const meeting =
  (explicitKaigiId
    ? meetings.find((item) => item.kaigi_id === explicitKaigiId)
    : meetings.find((item) => normalizeText(item.name) === normalizeText(titleFilter))) ?? null;

if (!meeting) {
  console.error(`Meeting not found: ${titleFilter ?? explicitKaigiId}`);
  process.exit(1);
}

const yearMatch = meeting.name.match(/令和(\d+)年|平成(\d+)年/);
const year = (() => {
  if (!yearMatch) return new Date().getFullYear();
  if (yearMatch[1]) return 2018 + Number(yearMatch[1]);
  return 1988 + Number(yearMatch[2]);
})();

const dayEntries = parseDayEntries(
  await fetchShiftJis(`${BASE_URL}g07_Video_Search.asp?kaigi=${meeting.kaigi_id}&Sflg=1`),
  year
);

const existing = readExistingSessions();
const sessions = [...existing.values()];
const byId = new Map(sessions.map((session) => [session.id, session]));

let added = 0;
let updated = 0;

for (const entry of dayEntries) {
  const id = makeSessionId(meeting.kaigi_id, entry.nittei_id, entry.date);
  const current = byId.get(id) ?? {};
  const sourceSegments = await parseSegmentsForNittei(entry.url);
  const next = {
    ...current,
    id,
    title: buildSessionTitle(meeting.name, entry.date, entry.committee),
    date: entry.date,
    city,
    committee: entry.committee,
    source_type: "web",
    source_url: entry.url,
    source_label: "録画配信ページ",
    source_thumbnail_url:
      sourceSegments.find((segment) => segment.thumbnail_url)?.thumbnail_url ??
      current.source_thumbnail_url,
    archive_kaigi_id: meeting.kaigi_id,
    archive_nittei_id: entry.nittei_id,
    stream_only: true,
    source_segments: sourceSegments,
    segments: current.segments ?? [],
  };

  if (byId.has(id)) {
    updated += 1;
    const idx = sessions.findIndex((session) => session.id === id);
    sessions[idx] = next;
  } else {
    added += 1;
    sessions.push(next);
  }
  byId.set(id, next);
}

sessions.sort((a, b) => String(b.date).localeCompare(String(a.date)) || a.id.localeCompare(b.id));
saveAll(sessions);

console.log(`[${city}] ${meeting.name}: ${added} sessions added, ${updated} sessions updated`);
