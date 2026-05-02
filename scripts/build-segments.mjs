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
const ADMIN_ROLE_KEYWORDS = [
  "副市長",
  "市長",
  "教育長",
  "部長",
  "局長",
  "課長",
  "室長",
  "主幹",
  "主査",
  "主任",
];
const MEMBER_ROLE_KEYWORDS = ["議員", "議長", "委員長", "委員"];

function isProceduralSpeaker(speaker) {
  if (!speaker) return false;
  return PROCEDURAL_SPEAKER_PATTERNS.some((re) => re.test(speaker));
}

function isMemberRoleSpeaker(speaker) {
  if (!speaker) return false;
  if (ADMIN_ROLE_KEYWORDS.some((kw) => speaker.includes(kw))) return false;
  return MEMBER_ROLE_KEYWORDS.some((kw) => speaker.includes(kw));
}

function toHalfWidthDigits(s) {
  return s.replace(/[０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xff10 + 0x30)
  );
}

function extractNameInfo(speaker) {
  if (!speaker) return null;
  let s = speaker;

  // Capture leading N番 as seat-number hint, then strip
  const seatMatch = s.match(/^([0-9０-９]+)番/);
  const seatNumberHint = seatMatch
    ? parseInt(toHalfWidthDigits(seatMatch[1]), 10)
    : null;
  s = s.replace(/^[0-9０-９]+番/, "");

  // Pattern: {role}（{name}）
  let m = s.match(/^([^（()]+)（([^（）()]+)）$/);
  if (m) {
    s = m[2];
  } else {
    // Pattern: （{name+role}）
    m = s.match(/^（([^（）()]+)）$/);
    if (m) s = m[1];
  }

  // Strip trailing role token (only the role keyword, not preceding committee name)
  s = s.replace(/(?:副|臨時|仮)?(?:議員|議長|委員長|委員)$/, "");

  // Capture disambiguation bracket content as given-name hint, then strip
  const bracketMatch = s.match(/[［\[]([^］\]]+)[］\]]/);
  const givenNameHint = bracketMatch ? bracketMatch[1].trim() : null;
  s = s.replace(/[［\[][^］\]]*[］\]]/g, "").trim();

  return { candidate: s, givenNameHint, seatNumberHint };
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

function buildMemberIndex(members) {
  // Each entry: { fullname, fullnameCompact, surname, given, seatNumber, faction }
  return members
    .filter((m) => m?.name)
    .map((m) => {
      const fullname = m.name;
      const fullnameCompact = fullname.replace(/[\s　]/g, "");
      const parts = fullname.split(/[\s　]/);
      const surname = parts[0];
      const given = parts.slice(1).join("");
      return {
        fullname,
        fullnameCompact,
        surname,
        given,
        seatNumber: typeof m.seat_number === "number" ? m.seat_number : null,
        faction: m.faction ?? null,
      };
    });
}

function matchMember(speaker, memberIndex) {
  if (!isMemberRoleSpeaker(speaker)) return null;
  const info = extractNameInfo(speaker);
  if (!info?.candidate) return null;
  const { candidate, givenNameHint, seatNumberHint } = info;

  // 1. Disambiguate by seat number + surname (handles "１８番佐々木議員" → 佐々木 雅宏)
  if (seatNumberHint != null) {
    for (const m of memberIndex) {
      if (m.seatNumber !== seatNumberHint) continue;
      if (m.surname && candidate.startsWith(m.surname)) {
        return { name: m.fullname, faction: m.faction };
      }
    }
  }

  // 2. Disambiguate by given-name bracket hint (handles "佐々木［雅宏］委員長")
  if (givenNameHint) {
    for (const m of memberIndex) {
      if (!m.surname) continue;
      if (candidate === m.surname || candidate.startsWith(m.surname)) {
        if (m.given && m.given === givenNameHint) {
          return { name: m.fullname, faction: m.faction };
        }
      }
    }
  }

  // 3. Exact full-name / compact-name match (unambiguous when present)
  for (const m of memberIndex) {
    if (candidate === m.fullname || candidate === m.fullnameCompact) {
      return { name: m.fullname, faction: m.faction };
    }
  }

  // 4. Surname-only / prefix match — only when exactly one member matches.
  // Multiple matches without a disambiguator are left unmatched for accuracy.
  const candidates = memberIndex.filter(
    (m) => m.surname && candidate.startsWith(m.surname)
  );
  if (candidates.length === 1) {
    return { name: candidates[0].fullname, faction: candidates[0].faction };
  }
  return null;
}

async function buildSegmentsForMunicipality(slug) {
  const minutesDir = path.join(PROJECT_ROOT, "data", slug, "minutes");
  const segmentsDir = path.join(PROJECT_ROOT, "data", slug, "segments");

  const members = await loadMembers(slug);
  const memberIndex = buildMemberIndex(members);

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
        const member = matchMember(group.speaker, memberIndex);
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
