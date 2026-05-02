#!/usr/bin/env node
/**
 * 札幌市議会の録画配信ページから、minutes 未収録の会期を sessions として取り込む
 *
 * 使い方:
 *   node site/scripts/bootstrap-sapporo-stream-meeting.mjs --title "令和8年第1回定例会"
 *
 * オプション:
 *   --title <text>     会議名（例: 令和8年第1回定例会）
 *   --gikai-id <id>    配信側の gikai_id を直接指定する場合
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const SITE_ROOT = path.resolve(__dirname, "..");
const city = "sapporo";

const BASE_URL = "https://sapporo-city.stream.jfit.co.jp/";
const LIST_URL = `${BASE_URL}?kaigi_id=1&tpl=gikai_list`;

const args = process.argv.slice(2);
const get = (flag) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
};

const titleFilter = get("--title");
const explicitGikaiId = get("--gikai-id");

if (!titleFilter && !explicitGikaiId) {
  console.error("Usage: node site/scripts/bootstrap-sapporo-stream-meeting.mjs --title <text> [--gikai-id <id>]");
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

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0" },
  });
  if (!res.ok) throw new Error(`fetch failed: ${res.status} ${url}`);
  return res.text();
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0" },
  });
  if (!res.ok) throw new Error(`fetch failed: ${res.status} ${url}`);
  return res.json();
}

function parseListPage(html) {
  const meetings = [];
  for (const match of html.matchAll(/<a href="\/\?tpl=gikai_days_list&amp;gikai_id=(\d+)">([^<]+)<\/a>/g)) {
    meetings.push({
      gikai_id: match[1],
      name: htmlDecode(match[2]).trim(),
    });
  }
  return meetings;
}

function parseDayListPage(html, year) {
  const rows = [];
  for (const match of html.matchAll(
    /<tr>\s*<td class="width-150">([^<]+)<\/td>\s*<td>\s*<a href="([^"]*tpl=gikai_result[^"]*)">([^<]+)<\/a>/g
  )) {
    const dateText = htmlDecode(match[1]).trim();
    const relUrl = htmlDecode(match[2]);
    const label = htmlDecode(match[3]).trim();
    const md = dateText.match(/(\d{1,2})月(\d{1,2})日/);
    if (!md) continue;
    rows.push({
      date: `${year}-${String(Number(md[1])).padStart(2, "0")}-${String(Number(md[2])).padStart(2, "0")}`,
      label,
      url: absoluteUrl(relUrl),
    });
  }
  return rows;
}

function parseBmData(html) {
  const encoded = html.match(/<div id="bm_data"[^>]*>([^<]+)<\/div>/)?.[1]?.trim();
  if (!encoded) return null;
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf-8"));
}

async function fetchPlayerMetadata(playUrl) {
  const html = await fetchText(playUrl);
  const bmData = parseBmData(html);
  const sourceUrl = bmData?.playerSetting?.source
    ? absoluteUrl(bmData.playerSetting.source)
    : null;
  const title = bmData?.title ?? null;
  let mediaUrl = null;
  let playerUrl = null;

  if (sourceUrl) {
    const sources = await fetchJson(sourceUrl);
    const hls = sources.find((item) => item.StreamingProtocol === "Hls");
    const dash = sources.find((item) => item.StreamingProtocol === "Dash");
    mediaUrl = hls?.Source ?? dash?.Source ?? null;
    playerUrl = sourceUrl;
  }

  const thumbnailUrl =
    html.match(/<meta property="og:image" content="([^"]+)"/)?.[1] ??
    absoluteUrl("/material/image/poster.jpg");

  return {
    title,
    player_url: playerUrl,
    media_url: mediaUrl,
    thumbnail_url: thumbnailUrl,
  };
}

async function parseSegmentsForResultPage(url) {
  const html = await fetchText(url);
  const rows = html.match(/<tr class="font-90">[\s\S]*?<\/tr>/g) ?? [];
  const segments = [];

  for (const row of rows) {
    const inquiryId = row.match(/play_vod&amp;inquiry_id=(\d+)/)?.[1];
    if (!inquiryId) continue;

    const speaker = stripTags(
      row.match(/<li class="font-bold">([\s\S]*?)<\/li>/)?.[1] ?? ""
    );
    const party = stripTags(row.match(/<li>([^<]+)<\/li>\s*<li class="font-bold">/)?.[1] ?? "");
    const agenda = stripTags(row.match(/<td>([\s\S]*?)<\/td>\s*<td class="width-60 center">/)?.[1] ?? "");
    const playUrl = absoluteUrl(`/?tpl=play_vod&inquiry_id=${inquiryId}`);
    const player = await fetchPlayerMetadata(playUrl);

    segments.push({
      title: [speaker || null, agenda || null].filter(Boolean).join(" / "),
      speaker: [party || null, speaker || null].filter(Boolean).join(" ").trim() || undefined,
      view_url: playUrl,
      player_url: player.player_url,
      media_url: player.media_url,
      thumbnail_url: player.thumbnail_url,
      external_title: player.title ?? undefined,
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

function makeSessionId(gikaiId, order, date) {
  return `${gikaiId}-${String(order).padStart(2, "0")}-${date.replaceAll("-", "")}`;
}

function saveAll(sessions) {
  const index = sessions.map((session) => ({
    id: session.id,
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

  for (const base of [path.join(ROOT, "data"), path.join(SITE_ROOT, "data")]) {
    const dir = path.join(base, city, "sessions");
    fs.mkdirSync(dir, { recursive: true });
    for (const session of sessions) {
      fs.writeFileSync(path.join(dir, `${session.id}.json`), JSON.stringify(session, null, 2), "utf-8");
    }
    fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify(index, null, 2), "utf-8");
  }
}

const meetings = parseListPage(await fetchText(LIST_URL));
const meeting =
  (explicitGikaiId
    ? meetings.find((item) => item.gikai_id === explicitGikaiId)
    : meetings.find((item) => normalizeText(item.name) === normalizeText(titleFilter))) ?? null;

if (!meeting) {
  console.error(`Meeting not found: ${titleFilter ?? explicitGikaiId}`);
  process.exit(1);
}

const yearMatch = meeting.name.match(/令和(\d+)年第1回|令和(\d+)年/);
const year = (() => {
  if (!yearMatch) return new Date().getFullYear();
  const reiwa = Number(yearMatch[1] ?? yearMatch[2]);
  return 2018 + reiwa;
})();

const dayRows = parseDayListPage(
  await fetchText(`${BASE_URL}?tpl=gikai_days_list&gikai_id=${meeting.gikai_id}`),
  year
);

const existing = readExistingSessions();
const sessions = [...existing.values()];
const seenIds = new Set(sessions.map((session) => session.id));

let added = 0;

for (let i = 0; i < dayRows.length; i++) {
  const row = dayRows[i];
  const id = makeSessionId(meeting.gikai_id, i + 1, row.date);
  if (seenIds.has(id)) continue;

  const sourceSegments = await parseSegmentsForResultPage(row.url);
  const session = {
    id,
    title: `${meeting.name} ${Number(row.date.slice(5, 7))}月${Number(row.date.slice(8, 10))}日`,
    date: row.date,
    city,
    committee: "本会議",
    source_type: "web",
    source_url: row.url,
    source_label: "録画配信ページ",
    source_thumbnail_url: sourceSegments.find((segment) => segment.thumbnail_url)?.thumbnail_url,
    archive_gikai_id: meeting.gikai_id,
    stream_only: true,
    source_segments: sourceSegments,
    segments: [],
  };

  sessions.push(session);
  seenIds.add(id);
  added += 1;
}

sessions.sort((a, b) => String(b.date).localeCompare(String(a.date)) || a.id.localeCompare(b.id));
saveAll(sessions);

console.log(`[${city}] ${meeting.name}: ${added} sessions added`);
