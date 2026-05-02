#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");

const KEEP_TYPES = new Set(["◆質問", "◎答弁"]);
const ROLE_MAP = {
  "◆質問": "質問",
  "◎答弁": "答弁",
};
const PROCEDURAL_SPEAKER_PATTERNS = [
  /議長$/,
  /委員長$/,
  /事務局長$/,
  /書記$/,
];
const MEMBER_ROLE_REMAINDER_RE =
  /^(?:副|臨時|仮)?(?:議員|議長|委員長|委員)$|^.+(?:常任|特別)?委員長$/;

function isProceduralSpeaker(speaker) {
  if (!speaker) return false;
  return PROCEDURAL_SPEAKER_PATTERNS.some((re) => re.test(speaker));
}

function parseScheduleDate(year, scheduleName) {
  if (!year || !scheduleName) return null;
  const match = scheduleName.match(/(\d+)月(\d+)日/);
  if (!match) return null;
  const month = String(match[1]).padStart(2, "0");
  const day = String(match[2]).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripSpeakerPrefix(text, speaker) {
  if (!text || !speaker) return text;
  const re = new RegExp(`^[◆◎○△]?${escapeRegex(speaker)}[\\s　]+`);
  return text.replace(re, "");
}

function makeExcerpt(text, max = 100) {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

async function loadMembers(slug) {
  const membersPath = path.join(PROJECT_ROOT, "data", slug, "members.json");
  try {
    const raw = await fs.readFile(membersPath, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

function buildSurnameIndex(members) {
  // surname → { name, faction }
  // First entry wins for duplicate surnames.
  const map = new Map();
  for (const m of members) {
    if (!m?.name) continue;
    const surname = m.name.split(/[\s　]/)[0];
    if (!surname || map.has(surname)) continue;
    map.set(surname, { name: m.name, faction: m.faction ?? null });
  }
  return map;
}

function matchMember(speaker, surnameIndex) {
  if (!speaker) return null;
  const stripped = speaker.replace(/^[0-9０-９]+番/, "");
  for (const [surname, info] of surnameIndex) {
    if (!stripped.startsWith(surname)) continue;
    const remainder = stripped.slice(surname.length);
    if (MEMBER_ROLE_REMAINDER_RE.test(remainder)) return info;
  }
  return null;
}

async function buildSegmentsForMunicipality(slug) {
  const minutesDir = path.join(PROJECT_ROOT, "data", slug, "minutes");
  const segmentsDir = path.join(PROJECT_ROOT, "data", slug, "segments");

  const members = await loadMembers(slug);
  const surnameIndex = buildSurnameIndex(members);

  const files = (await fs.readdir(minutesDir))
    .filter((f) => /^\d+\.json$/.test(f))
    .sort();

  await fs.mkdir(segmentsDir, { recursive: true });

  const indexEntries = [];
  let totalSegments = 0;
  let matchedMemberCount = 0;

  for (const file of files) {
    const minutesPath = path.join(minutesDir, file);
    const raw = await fs.readFile(minutesPath, "utf8");
    const data = JSON.parse(raw);
    const councilId = data.council_id;
    const councilName = data.name;
    const year = data.year;

    const segments = [];

    for (const schedule of data.schedules ?? []) {
      const scheduleId = schedule.schedule_id;
      const scheduleName = schedule.name;
      const date = parseScheduleDate(year, scheduleName);

      let group = null;

      const flush = () => {
        if (!group) return;
        const ordinal = segments.length + 1;
        const id = `${slug}-${councilId}-${scheduleId}-${String(ordinal).padStart(3, "0")}`;
        const text = group.texts.join("\n");
        const member = matchMember(group.speaker, surnameIndex);
        if (member) matchedMemberCount += 1;
        segments.push({
          id,
          municipality: slug,
          council_id: councilId,
          council_name: councilName,
          schedule_id: scheduleId,
          schedule_name: scheduleName,
          date,
          speaker: group.speaker,
          speaker_role: ROLE_MAP[group.minuteType] ?? group.minuteType,
          is_procedural: isProceduralSpeaker(group.speaker),
          member_name: member?.name ?? null,
          member_faction: member?.faction ?? null,
          text,
          text_length: text.length,
          source: {
            minutes_file: `data/${slug}/minutes/${file}`,
            schedule_id: scheduleId,
            minute_ids: group.minuteIds,
          },
        });
        group = null;
      };

      for (const minute of schedule.minutes ?? []) {
        if (!KEEP_TYPES.has(minute.minute_type)) {
          flush();
          continue;
        }

        const speaker = minute.title;
        const minuteType = minute.minute_type;
        const cleanedText = stripSpeakerPrefix(minute.text, speaker);

        if (
          group &&
          group.speaker === speaker &&
          group.minuteType === minuteType
        ) {
          group.texts.push(cleanedText);
          group.minuteIds.push(minute.minute_id);
        } else {
          flush();
          group = {
            speaker,
            minuteType,
            texts: [cleanedText],
            minuteIds: [minute.minute_id],
          };
        }
      }

      flush();
    }

    const outPath = path.join(segmentsDir, `${councilId}.json`);
    await fs.writeFile(outPath, JSON.stringify(segments, null, 2) + "\n");

    for (const seg of segments) {
      indexEntries.push({
        id: seg.id,
        council_id: seg.council_id,
        council_name: seg.council_name,
        date: seg.date,
        speaker: seg.speaker,
        speaker_role: seg.speaker_role,
        is_procedural: seg.is_procedural,
        member_name: seg.member_name,
        member_faction: seg.member_faction,
        text_length: seg.text_length,
        excerpt: makeExcerpt(seg.text),
      });
    }

    totalSegments += segments.length;
  }

  indexEntries.sort((a, b) => {
    const dateCmp = (b.date ?? "").localeCompare(a.date ?? "");
    if (dateCmp !== 0) return dateCmp;
    return a.id.localeCompare(b.id);
  });

  const indexPath = path.join(segmentsDir, "_index.json");
  await fs.writeFile(indexPath, JSON.stringify(indexEntries, null, 2) + "\n");

  return {
    totalSegments,
    councilCount: files.length,
    memberCount: members.length,
    matchedMemberCount,
  };
}

async function main() {
  const slug = process.argv[2] ?? "chitose";
  const result = await buildSegmentsForMunicipality(slug);
  const matchPct = result.totalSegments
    ? Math.round((result.matchedMemberCount / result.totalSegments) * 100)
    : 0;
  console.log(
    `[${slug}] ${result.totalSegments} segments / ${result.councilCount} councils / member match: ${result.matchedMemberCount} (${matchPct}%) → data/${slug}/segments/`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
