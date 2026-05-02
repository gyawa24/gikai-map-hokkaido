#!/usr/bin/env node
/**
 * minutes データから sessions の雛形を生成するスクリプト
 *
 * 使い方:
 *   node scripts/bootstrap-sessions-from-minutes.mjs --city hokkaido
 *
 * オプション:
 *   --city <slug>         対象自治体（必須）
 *   --archive-url <url>   視聴先URL。未指定時は自治体に応じた既定値を使う
 *   --source-label <str>  視聴ボタン文言（デフォルト: 録画配信一覧）
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const SITE_ROOT = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
const get = (flag) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
};

const city = get("--city");
const archiveUrlFlag = get("--archive-url");
const sourceLabel = get("--source-label") ?? "録画配信一覧";

if (!city) {
  console.error("Usage: node scripts/bootstrap-sessions-from-minutes.mjs --city <slug>");
  process.exit(1);
}

const municipalities = JSON.parse(
  fs.readFileSync(path.join(ROOT, "data", "municipalities.json"), "utf-8")
);
const municipality = municipalities.find((m) => m.slug === city);
const councilName = municipality?.council_name ?? `${city}議会`;
const archiveUrl =
  archiveUrlFlag ??
  (city === "hokkaido"
    ? "https://www.gikai.pref.hokkaido.lg.jp/cyukei/"
    : city === "sapporo"
      ? "https://sapporo-city.stream.jfit.co.jp/?kaigi_id=1&tpl=gikai_list"
      : null);

const minutesIndexPath = path.join(ROOT, "data", city, "minutes", "index.json");
if (!fs.existsSync(minutesIndexPath)) {
  console.error(`Minutes index not found: ${minutesIndexPath}`);
  process.exit(1);
}

const minutesIndex = JSON.parse(fs.readFileSync(minutesIndexPath, "utf-8"));

function parseMonthDay(...values) {
  for (const value of values) {
    const text = typeof value === "string" ? value : "";
    const match = text.match(/(\d{1,2})月\s*(\d{1,2})日/);
    if (match) {
      return {
        month: Number(match[1]),
        day: Number(match[2]),
      };
    }
  }
  return null;
}

function buildDate(year, schedule, firstMinute) {
  const md = parseMonthDay(schedule?.name, firstMinute?.title, firstMinute?.text);
  if (!md) return null;
  return `${year}-${String(md.month).padStart(2, "0")}-${String(md.day).padStart(2, "0")}`;
}

function buildTitle(council, schedule, committee, date) {
  const dateLabel = date
    ? `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`
    : `第${schedule.schedule_id}日程`;
  if (committee && committee !== "本会議") {
    return `${council.name} ${dateLabel} ${committee}`;
  }
  return `${council.name} ${dateLabel}`;
}

function makeSessionId(councilId, scheduleId, date) {
  const suffix = date ? date.replaceAll("-", "") : `s${String(scheduleId).padStart(2, "0")}`;
  return `${councilId}-${String(scheduleId).padStart(2, "0")}-${suffix}`;
}

function isTableOfContentsSchedule(schedule, firstMinute) {
  const text = `${schedule?.name ?? ""} ${(firstMinute?.title ?? "")}`.trim();
  return /目次/.test(text);
}

function readExistingSessionMap(baseDir) {
  const sessionsDir = path.join(baseDir, city, "sessions");
  const map = new Map();
  if (!fs.existsSync(sessionsDir)) return map;
  for (const file of fs.readdirSync(sessionsDir)) {
    if (file === "index.json" || !file.endsWith(".json")) continue;
    const fp = path.join(sessionsDir, file);
    const session = JSON.parse(fs.readFileSync(fp, "utf-8"));
    map.set(file.replace(".json", ""), session);
  }
  return map;
}

const existingMap = readExistingSessionMap(path.join(ROOT, "data"));
const sessions = [];

for (const item of minutesIndex) {
  const minutesFile = path.join(ROOT, "data", city, "minutes", item.file);
  if (!fs.existsSync(minutesFile)) continue;
  const council = JSON.parse(fs.readFileSync(minutesFile, "utf-8"));
  for (let i = 0; i < (council.schedules ?? []).length; i++) {
    const schedule = council.schedules[i];
    const firstMinute = schedule.minutes?.[0];
    if (isTableOfContentsSchedule(schedule, firstMinute)) continue;
    const date = buildDate(item.year, schedule, firstMinute);
    const committee = firstMinute?.minute_type ?? "本会議";
    const id = makeSessionId(item.council_id, schedule.schedule_id, date);
    const existing = existingMap.get(id) ?? {};
    sessions.push({
      ...existing,
      id,
      title: buildTitle(item, schedule, committee, date),
      date: date ?? existing.date ?? `${item.year}-01-01`,
      city,
      committee,
      source_type: existing.source_type ?? "web",
      source_url: existing.source_url ?? archiveUrl ?? undefined,
      source_label: existing.source_label ?? sourceLabel,
      source_thumbnail_url: existing.source_thumbnail_url ?? undefined,
      youtube_id: existing.youtube_id ?? undefined,
      minutes_council_id: item.council_id,
      minutes_schedule_id: schedule.schedule_id,
      minutes_schedule_index: i,
      minutes_file: item.file,
      segments: existing.segments ?? [],
      generated_at: existing.generated_at,
    });
  }
}

sessions.sort((a, b) => {
  const byDate = String(b.date).localeCompare(String(a.date));
  return byDate !== 0 ? byDate : a.id.localeCompare(b.id);
});

const index = sessions.map((session) => ({
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

function save(baseDir) {
  const sessionsDir = path.join(baseDir, city, "sessions");
  fs.mkdirSync(sessionsDir, { recursive: true });
  const validFiles = new Set(sessions.map((session) => `${session.id}.json`));
  for (const file of fs.readdirSync(sessionsDir)) {
    if (file === "index.json" || !file.endsWith(".json")) continue;
    if (!validFiles.has(file)) {
      fs.unlinkSync(path.join(sessionsDir, file));
    }
  }
  for (const session of sessions) {
    fs.writeFileSync(
      path.join(sessionsDir, `${session.id}.json`),
      JSON.stringify(session, null, 2),
      "utf-8"
    );
  }
  fs.writeFileSync(path.join(sessionsDir, "index.json"), JSON.stringify(index, null, 2), "utf-8");
}

save(path.join(ROOT, "data"));
save(path.join(SITE_ROOT, "data"));

console.log(`[${city}] ${sessions.length}件の sessions 雛形を生成しました`);
console.log(`  council: ${councilName}`);
console.log(`  source_url: ${archiveUrl ?? "(未設定)"}`);
