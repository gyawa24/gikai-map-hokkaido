#!/usr/bin/env node
/**
 * 札幌市議会 sessions に録画配信URLと分割動画URLを付与する
 *
 * 使い方:
 *   node site/scripts/enrich-sapporo-session-sources.mjs
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

function normalizeText(text) {
  return String(text ?? "").normalize("NFKC").replace(/\s+/g, "");
}

function absoluteUrl(url) {
  return new URL(url, BASE_URL).toString();
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

function buildDateLabel(date) {
  const d = new Date(`${date}T00:00:00+09:00`);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
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

function parseDayListPage(html) {
  const rows = [];
  for (const match of html.matchAll(
    /<tr>\s*<td class="width-150">([^<]+)<\/td>\s*<td>\s*<a href="([^"]*tpl=gikai_result[^"]*)">([^<]+)<\/a>/g
  )) {
    const dateText = htmlDecode(match[1]).trim();
    const relUrl = htmlDecode(match[2]);
    const label = htmlDecode(match[3]).trim();
    const md = dateText.match(/(\d{1,2})月(\d{1,2})日/);
    rows.push({
      dateText,
      month: md ? Number(md[1]) : null,
      day: md ? Number(md[2]) : null,
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

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0" },
  });
  if (!res.ok) throw new Error(`fetch failed: ${res.status} ${url}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0" },
  });
  if (!res.ok) throw new Error(`fetch failed: ${res.status} ${url}`);
  return res.text();
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

const minutesIndex = JSON.parse(
  fs.readFileSync(path.join(ROOT, "data", city, "minutes", "index.json"), "utf-8")
);
const sessionsDir = path.join(ROOT, "data", city, "sessions");
const indexPath = path.join(sessionsDir, "index.json");
if (!fs.existsSync(indexPath)) {
  console.error(`Session index not found: ${indexPath}`);
  process.exit(1);
}

const sessionsIndex = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
const sessions = new Map();
for (const entry of sessionsIndex) {
  const fp = path.join(sessionsDir, `${entry.id}.json`);
  if (!fs.existsSync(fp)) continue;
  sessions.set(entry.id, JSON.parse(fs.readFileSync(fp, "utf-8")));
}

const meetings = parseListPage(await fetchText(LIST_URL));
const meetingsByName = new Map(meetings.map((meeting) => [normalizeText(meeting.name), meeting]));
const dayListCache = new Map();
const resultCache = new Map();

let updated = 0;

for (const item of minutesIndex) {
  const minutesName = normalizeText(item.name);
  const meeting = meetingsByName.get(minutesName);
  if (!meeting) continue;

  if (!dayListCache.has(meeting.gikai_id)) {
    const html = await fetchText(`${BASE_URL}?tpl=gikai_days_list&gikai_id=${meeting.gikai_id}`);
    dayListCache.set(meeting.gikai_id, parseDayListPage(html));
  }

  const dayRows = dayListCache.get(meeting.gikai_id);
  const matchingRows = dayRows
    .map((row) => ({
      ...row,
      date: row.month && row.day ? `${item.year}-${String(row.month).padStart(2, "0")}-${String(row.day).padStart(2, "0")}` : null,
    }))
    .filter((row) => row.date);

  for (const row of matchingRows) {
    const dateLabel = buildDateLabel(row.date);
    const session = [...sessions.values()].find(
      (candidate) =>
        candidate.minutes_council_id === item.council_id &&
        candidate.date === row.date &&
        normalizeText(candidate.title).includes(normalizeText(dateLabel))
    );
    if (!session) continue;

    if (!resultCache.has(row.url)) {
      resultCache.set(row.url, await parseSegmentsForResultPage(row.url));
    }
    const sourceSegments = resultCache.get(row.url);
    const firstThumbnail = sourceSegments.find((segment) => segment.thumbnail_url)?.thumbnail_url;

    const nextSession = {
      ...session,
      source_type: "web",
      source_url: row.url,
      source_label: "録画配信ページ",
      source_thumbnail_url: firstThumbnail ?? session.source_thumbnail_url,
      source_segments: sourceSegments,
      archive_gikai_id: meeting.gikai_id,
    };

    fs.writeFileSync(
      path.join(sessionsDir, `${session.id}.json`),
      JSON.stringify(nextSession, null, 2),
      "utf-8"
    );

    const indexEntry = sessionsIndex.find((entry) => entry.id === session.id);
    if (indexEntry) {
      indexEntry.source_type = nextSession.source_type;
      indexEntry.source_url = nextSession.source_url;
      indexEntry.source_label = nextSession.source_label;
      indexEntry.source_thumbnail_url = nextSession.source_thumbnail_url;
    }
    sessions.set(session.id, nextSession);
    updated += 1;
  }
}

fs.writeFileSync(indexPath, JSON.stringify(sessionsIndex, null, 2), "utf-8");
fs.mkdirSync(path.join(SITE_ROOT, "data", city, "sessions"), { recursive: true });
for (const file of fs.readdirSync(sessionsDir)) {
  fs.copyFileSync(
    path.join(sessionsDir, file),
    path.join(SITE_ROOT, "data", city, "sessions", file)
  );
}

console.log(`[${city}] ${updated} sessions updated`);
