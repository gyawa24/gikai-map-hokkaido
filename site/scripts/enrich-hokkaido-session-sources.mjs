#!/usr/bin/env node
/**
 * 北海道議会 sessions に録画配信URLと分割動画URLを付与する
 *
 * 使い方:
 *   node scripts/enrich-hokkaido-session-sources.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const SITE_ROOT = path.resolve(__dirname, "..");
const city = "hokkaido";

const SEARCH_URL = "https://pref-hokkaido.gijiroku.com/g07_Video_Search.asp?Sflg=1";
const SEARCH_BASE = "https://pref-hokkaido.gijiroku.com/";

function normalizeText(text) {
  return String(text ?? "").normalize("NFKC").replace(/\s+/g, "");
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
  return htmlDecode(text).replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").trim();
}

function absoluteUrl(url) {
  return new URL(url, SEARCH_BASE).toString();
}

function meetingNameFromTitle(title) {
  return String(title).replace(/\s+\d+月\d+日.*$/, "").trim();
}

function parseSearchOptions(html) {
  const map = new Map();
  for (const match of html.matchAll(/<option value="(\d+)"[^>]*>([^<]+)<\/option>/g)) {
    map.set(normalizeText(match[2]), match[1]);
  }
  return map;
}

function parseNitteiEntries(html, year) {
  const entries = [];
  for (const match of html.matchAll(/g07_Video_Search\.asp\?Sflg=1&amp;kaigi=(\d+)&amp;NitteiID=(\d+)'>\s*([^<]+)\s*<\/a>/g)) {
    const label = htmlDecode(match[3]).trim();
    const parts = label.split(/　+/);
    const datePart = parts[0] ?? "";
    const committee = parts.slice(1).join(" ").trim();
    const dateMatch = datePart.match(/(\d{1,2})月(\d{1,2})日/);
    if (!dateMatch) continue;
    const date = `${year}-${String(Number(dateMatch[1])).padStart(2, "0")}-${String(Number(dateMatch[2])).padStart(2, "0")}`;
    entries.push({
      kaigi_id: match[1],
      nittei_id: match[2],
      date,
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
  const mediaUrl = playerHtml.match(/"file":\s*"([^"]+)"/)?.[1];
  const thumbnailUrl = playerHtml.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
  return {
    player_url: playerUrl,
    media_url: mediaUrl,
    thumbnail_url: thumbnailUrl,
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
    const titleCells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => stripTags(m[1]));
    const title = titleCells.filter(Boolean).slice(0, 2).join(" / ") || `segment-${i + 1}`;
    const player = await fetchPlayerMetadata(viewUrl);
    segments.push({
      title,
      view_url: viewUrl,
      player_url: player?.player_url,
      media_url: player?.media_url,
      thumbnail_url: player?.thumbnail_url,
    });
  }
  return segments;
}

const minutesIndex = JSON.parse(
  fs.readFileSync(path.join(ROOT, "data", city, "minutes", "index.json"), "utf-8")
);
const councilNameMap = new Map(minutesIndex.map((item) => [item.council_id, item.name]));
const sessionsDir = path.join(ROOT, "data", city, "sessions");
const indexPath = path.join(sessionsDir, "index.json");
const index = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
const searchOptions = parseSearchOptions(await fetchShiftJis(SEARCH_URL));
const nitteiCache = new Map();
const segmentsCache = new Map();

let updated = 0;

for (const entry of index) {
  const sessionPath = path.join(sessionsDir, `${entry.id}.json`);
  if (!fs.existsSync(sessionPath)) continue;
  const session = JSON.parse(fs.readFileSync(sessionPath, "utf-8"));
  const councilName =
    councilNameMap.get(session.minutes_council_id) ?? meetingNameFromTitle(session.title);
  const kaigiId = searchOptions.get(normalizeText(councilName));
  if (!kaigiId) continue;

  if (!nitteiCache.has(kaigiId)) {
    const html = await fetchShiftJis(`${SEARCH_BASE}g07_Video_Search.asp?kaigi=${kaigiId}&Sflg=1`);
    nitteiCache.set(kaigiId, parseNitteiEntries(html, session.date.slice(0, 4)));
  }
  const nitteiEntries = nitteiCache.get(kaigiId);
  const match = nitteiEntries.find(
    (item) =>
      item.date === session.date &&
      normalizeText(item.committee) === normalizeText(session.committee ?? "")
  );
  if (!match) continue;

  if (!segmentsCache.has(match.url)) {
    segmentsCache.set(match.url, await parseSegmentsForNittei(match.url));
  }
  const sourceSegments = segmentsCache.get(match.url);
  const firstThumbnail = sourceSegments.find((segment) => segment.thumbnail_url)?.thumbnail_url;

  const nextSession = {
    ...session,
    source_type: "web",
    source_url: match.url,
    source_label: "録画配信ページ",
    source_thumbnail_url: firstThumbnail ?? session.source_thumbnail_url,
    archive_kaigi_id: kaigiId,
    archive_nittei_id: match.nittei_id,
    source_segments: sourceSegments,
  };
  fs.writeFileSync(sessionPath, JSON.stringify(nextSession, null, 2), "utf-8");

  entry.source_type = nextSession.source_type;
  entry.source_url = nextSession.source_url;
  entry.source_label = nextSession.source_label;
  entry.source_thumbnail_url = nextSession.source_thumbnail_url;
  updated++;
}

fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf-8");
fs.mkdirSync(path.join(SITE_ROOT, "data", city, "sessions"), { recursive: true });
for (const file of fs.readdirSync(sessionsDir)) {
  fs.copyFileSync(
    path.join(sessionsDir, file),
    path.join(SITE_ROOT, "data", city, "sessions", file)
  );
}

console.log(`[${city}] ${updated} sessions updated`);
