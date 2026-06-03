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
  "○議長": "議長",
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
  "副町長",
  "町長",
  "副村長",
  "村長",
  "副知事",
  "知事",
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
const SEAT_NUMBER_PREFIX_RE = /^[0-9０-９]+番/;

function isProceduralSpeaker(speaker) {
  if (!speaker) return false;
  return PROCEDURAL_SPEAKER_PATTERNS.some((re) => re.test(speaker));
}

function isMemberRoleSpeaker(speaker) {
  if (!speaker) return false;
  if (ADMIN_ROLE_KEYWORDS.some((kw) => speaker.includes(kw))) return false;
  if (MEMBER_ROLE_KEYWORDS.some((kw) => speaker.includes(kw))) return true;
  // N番 prefix without explicit role keyword still implies a member (e.g., ishikari "５番（神代知花子）")
  return SEAT_NUMBER_PREFIX_RE.test(speaker);
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

  // Some minutes put the member role before the surname (e.g. "議員東出").
  s = s.replace(/^議員/, "");

  // Strip trailing role token (only the role keyword, not preceding committee name)
  s = s.replace(/(?:副|臨時|仮)?(?:議員|議長|委員長|委員)$/, "");

  // Strip honorific suffix (君/氏/殿) used in formal council records
  s = s.replace(/(?:君|氏|殿)$/, "");

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
  const re = new RegExp(`^[◆◎○△◇]?${escapeRegex(speaker)}[\\s　]+`);
  return text.replace(re, "");
}

function stripMemberNamePrefix(text, memberName) {
  if (!text || !memberName) return text;
  const parts = memberName.trim().split(/[\s　]+/).filter(Boolean);
  const compactName = memberName.replace(/[\s　]/g, "");
  const aliases = [compactName];
  if (parts.length > 1) {
    aliases.push(parts.join("[\\s　]*"));
    const given = parts.slice(1).join("");
    if (given.length >= 2) aliases.push(given);
  }
  const pattern = aliases.filter(Boolean).join("|");
  if (!pattern) return text;
  const re = new RegExp(`^[\\s　]*(?:${pattern})(?=$|[\\s　、，:：])[\\s　、，:：]*`);
  return text.replace(re, "").trimStart();
}

function makeExcerpt(text, max = 100) {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

function collapseInlineSpaces(s) {
  return s.replace(/[ \t]+/g, " ").replace(/[　]+/g, " ").trim();
}

function compactJapaneseSpaces(s) {
  return s.replace(/[ 　]/g, "");
}

function normalizeSpeakerLabel(label) {
  const compact = collapseInlineSpaces(label)
    .replace(/^[-－―]+/, "")
    .replace(/（登壇）/g, "")
    .replace(/\(登壇\)/g, "")
    .replace(/^[●○◎◆△◇〇]\s*/, "")
    .replace(/^([0-9０-９]+)\s+番/u, "$1番")
    .replace(/議\s+長/g, "議長")
    .replace(/副\s+議\s+長/g, "副議長")
    .replace(/委\s+員\s+長/g, "委員長")
    .replace(/副\s+委\s+員\s+長/g, "副委員長")
    .replace(/町\s+長/g, "町長")
    .replace(/副\s+町\s+長/g, "副町長")
    .replace(/村\s+長/g, "村長")
    .replace(/副\s+村\s+長/g, "副村長")
    .replace(/市\s+長/g, "市長")
    .replace(/副\s+市\s+長/g, "副市長")
    .replace(/教\s+育\s+長/g, "教育長")
    .replace(/課\s+長/g, "課長")
    .replace(/部\s+長/g, "部長")
    .replace(/局\s+長/g, "局長")
    .trim();

  if (!compact) return "";
  if (/^日程/.test(compact)) return "";
  if (/^質\s*疑/.test(compact)) return "";
  if (/^市長提案説明/.test(compact)) return "";
  if (/^(?:出席|欠席)議員/.test(compact)) return "";

  let m = compact.match(/^(?:[0-9０-９]+、\s*)?([0-9０-９]+)番$/);
  if (m) return `${m[1]}番議員`;

  m = compact.match(/^(?:[0-9０-９]+、\s*)?議員[（(]([^()（）]+)[）)]$/);
  if (m) return `${m[1].replace(/\s+/g, "")}議員`;

  m = compact.match(/^([0-9０-９]+)番[（(]([^()（）]+?)(?:議員)?[）)]$/);
  if (m) return `${m[2].replace(/\s+/g, "").replace(/(?:議員|君|氏|殿)$/, "")}議員`;

  m = compact.match(/^([^（()]+)[（(]([^()（）]+)[）)]$/);
  if (m) {
    const role = m[1].replace(/\s+/g, "");
    const name = m[2].replace(/\s+/g, "").replace(/(?:議員|君|氏|殿)$/, "");
    if (ADMIN_ROLE_KEYWORDS.some((kw) => role.includes(kw)) || /^(議長|副議長|委員長|副委員長|事務局長|書記長?)$/.test(role)) {
      return `${name}${role}`;
    }
    if (MEMBER_ROLE_KEYWORDS.some((kw) => role.includes(kw))) return `${name}議員`;
  }

  m = compact.match(/^(議長|副議長|委員長|副委員長|事務局長|書記長?|市長|副市長|町長|副町長|村長|副村長|知事|副知事|教育長)\s+(.+?)(?:君|氏|殿)?$/);
  if (m) return `${m[2].replace(/\s+/g, "")}${m[1]}`;

  m = compact.match(/^([0-9０-９]+)番\s+(.+?)(?:議員|君|氏|殿)$/);
  if (m) return `${m[2].replace(/\s+/g, "")}議員`;

  m = compact.match(/^(.+?)(?:議員|君|氏|殿)$/);
  if (m) return `${m[1].replace(/\s+/g, "")}議員`;

  return compactJapaneseSpaces(compact);
}

function inferMinuteTypeFromSpeaker(speaker) {
  if (!speaker) return null;
  if (speaker.includes("議長")) return "○議長";
  if (ADMIN_ROLE_KEYWORDS.some((kw) => speaker.includes(kw))) return "◎答弁";
  if (isMemberRoleSpeaker(speaker)) return "◆質問";
  return null;
}

function trimToProceedings(text) {
  const source = String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/^[OＯ0]\s*([〇○])/gmu, "$1")
    .replace(/^([〇○])?\s*議\s+長/gmu, "$1議長")
    .replace(/^([〇○])?\s*副\s+議\s+長/gmu, "$1副議長")
    .replace(/^([〇○])?\s*委\s+員\s+長/gmu, "$1委員長")
    .replace(/^([〇○])?\s*副\s+委\s+員\s+長/gmu, "$1副委員長")
    .replace(/^([〇○])?\s*町\s+長/gmu, "$1町長")
    .replace(/^([〇○])?\s*副\s+町\s+長/gmu, "$1副町長")
    .replace(/^([〇○])?\s*村\s+長/gmu, "$1村長")
    .replace(/^([〇○])?\s*副\s+村\s+長/gmu, "$1副村長")
    .replace(/^([〇○])?\s*市\s+長/gmu, "$1市長")
    .replace(/^([〇○])?\s*副\s+市\s+長/gmu, "$1副市長")
    .replace(/^([〇○])?\s*教\s+育\s+長/gmu, "$1教育長")
    .replace(/^([〇○])?\s*課\s+長/gmu, "$1課長")
    .replace(/^([〇○])?\s*部\s+長/gmu, "$1部長")
    .replace(/^([〇○])?\s*局\s+長/gmu, "$1局長");
  const strongMarker = /\n(?:[（(]?\d{1,2}時\d{2}分[）)]|開会[ 　](?:午前|午後)\d|●\s*開会宣言|◎\s*開会(?:の宣告|宣言)?|開会・挨拶|開会宣告・開議宣告)/gu;
  const strongIndexes = [...source.matchAll(strongMarker)]
    .map((m) => m.index ?? -1)
    .filter((idx) => idx >= 0);
  if (strongIndexes.length > 0) {
    return source.slice(strongIndexes[strongIndexes.length - 1]).trim();
  }

  const weakMarkers = [
    /\n議\s*事\s*の\s*経\s*過/u,
    /\n[〇○◎●◇]\s*議\s*長/u,
    /\n◎\s*議\s*長/u,
    /\n[^\n]{0,80}を\s*開\s*会\s*します/u,
  ];
  const indexes = weakMarkers
    .map((re) => source.search(re))
    .filter((idx) => idx >= 0)
    .sort((a, b) => a - b);
  return indexes.length > 0 ? source.slice(indexes[0]).trim() : source;
}

function extractSpeakerHeader(chunk) {
  const patterns = [
    /^「([^」\n]{1,40})」(?:[（(][^）)\n]{1,30}[）)])?\s*/u,
    /^[●○◎◇〇]\s*([0-9０-９]+\s*番)\s*/u,
    /^([0-9０-９]+\s*番)\s*(?:\n|$)/u,
    /^[●○◎◇〇]\s*((?:[0-9０-９]+番\s*)?[^()\n]{0,20}[（(][^()\n]{1,30}[）)])\s*/u,
    /^[●○◎◇〇]\s*([^\s\n]{1,40}(?:議員|議長|委員長|事務局長|市長|町長|村長|知事|教育長|部長|課長))\s*/u,
    /^(?:[0-9０-９]+、\s*)?([0-9０-９]+\s*番[（(][^()\n]{1,30}[）)])\s*/u,
    /^(?:[0-9０-９]+、\s*)?((?:議長|副議長|委員長|事務局長|市長|副市長|町長|副町長|村長|副村長|知事|教育長|事務局長|部長|課長)(?:[（(][^()\n]{1,30}[）)])?)\s*/u,
    /^(?:[0-9０-９]+、\s*)?(議員[（(][^()\n]{1,30}[）)])\s*/u,
    /^([0-9０-９]+\s*番\s*[^\n]{1,30}(?:君|議員))[。．.]?\s*(?:\n|$)/u,
    /^([^\s\n]{1,20}(?:君|議員))[。．.]?\s*(?:\n|$)/u,
  ];

  for (const re of patterns) {
    const m = chunk.match(re);
    if (m) {
      return {
        label: m[1],
        body: chunk.slice(m[0].length),
      };
    }
  }
  return null;
}

function parseInlineTranscript(text, minuteIdBase = "raw") {
  const normalized = trimToProceedings(text);
  const markerRe = /(?:^|\n)(?:「[^」\n]{1,40}(?:君|議員|議長|副議長|委員長|副委員長|事務局長|市長|副市長|町長|副町長|村長|副村長|知事|副知事|教育長|部長|課長)」(?:[（(][^）)\n]{1,30}[）)])?|[●○◎◇〇]\s*(?:[0-9０-９]+\s*番|[^\n]{0,60}?(?:君|議員|議長|委員長|事務局長|市長|町長|村長|知事|教育長|部長|課長))|(?:[0-9０-９]+、\s*)?(?:[0-9０-９]+\s*番\s*[^\n]{1,30}(?:君|議員)|[0-9０-９]+\s*番[（(][^()\n]{1,30}[）)]|[0-9０-９]+\s*番|議員[（(][^()\n]{1,30}[）)]|(?:議長|副議長|委員長|事務局長|市長|副市長|町長|副町長|村長|副村長|知事|教育長|部長|課長)(?:[（(][^()\n]{1,30}[）)])?)|[^\s\n]{1,20}君(?:\n|$))/gm;
  const matches = [...normalized.matchAll(markerRe)];
  if (matches.length === 0) return [];

  const entries = [];
  for (let i = 0; i < matches.length; i += 1) {
    const start = matches[i].index ?? 0;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? normalized.length) : normalized.length;
    const chunk = normalized.slice(start, end).trim();
    if (!chunk) continue;

    const header = extractSpeakerHeader(chunk);
    if (!header) continue;

    const speaker = normalizeSpeakerLabel(header.label);
    const minuteType = inferMinuteTypeFromSpeaker(speaker);
    if (!speaker || !minuteType) continue;

    const body = collapseInlineSpaces(header.body ?? "")
      .replace(/^[:：]\s*/, "")
      .trim();

    if (body.length < 20) continue;
    if (/[…]{3,}|―{3,}|^\(?\d+\)?$/.test(body)) continue;

    entries.push({
      minute_id: `${minuteIdBase}-inline-${String(entries.length + 1).padStart(3, "0")}`,
      minute_type: minuteType,
      title: speaker,
      text: body,
    });
  }

  return entries;
}

function normalizeTableSpeaker(raw) {
  const compact = compactJapaneseSpaces(String(raw ?? ""));
  if (!compact) return "";
  if (compact === "〃") return "〃";
  if (/^[0-9０-９]+番$/.test(compact)) return `${compact}議員`;
  return compact;
}

function parseTableTranscript(text, minuteIdBase = "raw") {
  const normalized = trimToProceedings(text);
  if (!/議\s*事\s*の\s*経\s*過|議長|町長|副村長|副町長/u.test(normalized)) return [];

  const lines = normalized.split("\n");
  const entries = [];
  let current = null;
  let currentSpeaker = null;

  const flush = () => {
    if (!current || !currentSpeaker) return;
    const body = collapseInlineSpaces(current.join("\n")).trim();
    const speaker = normalizeSpeakerLabel(currentSpeaker);
    const minuteType = inferMinuteTypeFromSpeaker(speaker);
    if (speaker && minuteType && body.length >= 20) {
      entries.push({
        minute_id: `${minuteIdBase}-table-${String(entries.length + 1).padStart(3, "0")}`,
        minute_type: minuteType,
        title: speaker,
        text: body,
      });
    }
    current = null;
  };

  const isSpeakerish = (value) => {
    if (!value) return false;
    if (value === "〃") return true;
    return /議長|議員|市長|町長|村長|副市長|副町長|副村長|教育長|委員長|事務局長|課長|部長|次長|局長/.test(value);
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;

    const tableMatch = line.match(/^(?:(?:\d{1,2}[:：]\d{2})|(?:開会|閉会)|(?:日程\d+)|(?:〃))?\s*([^\s]{1,12}(?:\s*[^\s]{1,12}){0,4})\s+(.+)$/u);
    if (tableMatch) {
      const speakerToken = normalizeTableSpeaker(tableMatch[1]);
      if (isSpeakerish(speakerToken)) {
        flush();
        currentSpeaker = speakerToken === "〃" ? currentSpeaker : speakerToken;
        current = [tableMatch[2]];
        continue;
      }
    }

    const paragraphMatch = line.match(/^(議\s*長|町\s*長|副\s*町\s*長|副\s*村\s*長|副\s*市\s*長|市\s*長|村\s*長|教育長|事務局長|[^\s]{1,12}(?:課長|部長|次長|局長))\s+(.+)$/u);
    if (paragraphMatch) {
      flush();
      currentSpeaker = normalizeTableSpeaker(paragraphMatch[1]);
      current = [paragraphMatch[2]];
      continue;
    }

    if (current) {
      current.push(line.trim());
    }
  }

  flush();
  return entries;
}

function buildSpacedNamePattern(name) {
  const chars = compactJapaneseSpaces(name).split("");
  return chars.map((ch) => escapeRegex(ch)).join("[\\s　]*");
}

function parseQuestionNotice(text, memberIndex, minuteIdBase = "raw") {
  const normalized = String(text ?? "").replace(/\r\n/g, "\n");
  const marker = normalized.search(/一\s*般\s*質\s*問\s*通\s*告\s*表/u);
  if (marker < 0) return [];

  const source = normalized.slice(marker);
  const matches = [];
  for (const member of memberIndex) {
    const re = new RegExp(buildSpacedNamePattern(member.fullname), "gu");
    const m = re.exec(source);
    if (!m) continue;
    matches.push({
      index: m.index,
      length: m[0].length,
      member,
    });
  }

  matches.sort((a, b) => a.index - b.index);
  const deduped = matches.filter((match, index) => {
    if (index === 0) return true;
    return match.index - matches[index - 1].index > 10;
  });

  const entries = [];
  for (let i = 0; i < deduped.length; i += 1) {
    const current = deduped[i];
    const next = deduped[i + 1];
    const start = current.index + current.length;
    const end = next ? next.index : source.length;
    const body = collapseInlineSpaces(source.slice(start, end))
      .replace(/^.*?答\s*弁\s*者/, "")
      .trim();
    if (body.length < 30) continue;

    entries.push({
      minute_id: `${minuteIdBase}-notice-${String(entries.length + 1).padStart(3, "0")}`,
      minute_type: "◆質問",
      title: `${current.member.fullnameCompact}議員`,
      text: body,
    });
  }

  return entries;
}

async function loadMembers(slug, membersPath = null) {
  membersPath ??= path.join(PROJECT_ROOT, "data", slug, "members.json");
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
  if (!info) return null;
  const { candidate, givenNameHint, seatNumberHint } = info;

  if (!candidate && seatNumberHint != null) {
    const bySeatOnly = memberIndex.find((m) => m.seatNumber === seatNumberHint);
    if (bySeatOnly) {
      return { name: bySeatOnly.fullname, faction: bySeatOnly.faction };
    }
    return null;
  }

  if (!candidate) return null;

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

  // 4. Prefix match — bidirectional, only when exactly one member matches.
  //    a) candidate begins with member surname (e.g., "大山総務文教" → 大山)
  //    b) member fullname begins with candidate (handles no-space names like
  //       muroran "滝口紘子": speaker "滝口委員" → candidate "滝口" → match "滝口紘子")
  if (candidate.length < 2) return null;
  const candidates = memberIndex.filter(
    (m) =>
      (m.surname && candidate.startsWith(m.surname)) ||
      (m.fullname && m.fullname.startsWith(candidate))
  );
  if (candidates.length === 1) {
    return { name: candidates[0].fullname, faction: candidates[0].faction };
  }
  return null;
}

function resolvePath(fp) {
  if (!fp) return null;
  return path.isAbsolute(fp) ? fp : path.join(PROJECT_ROOT, fp);
}

export async function buildSegmentsForMunicipality(slug, options = {}) {
  const minutesDir =
    resolvePath(options.minutesDir) ?? path.join(PROJECT_ROOT, "data", slug, "minutes");
  const segmentsDir =
    resolvePath(options.segmentsDir) ?? path.join(PROJECT_ROOT, "data", slug, "segments");
  const membersPath = resolvePath(options.membersPath);

  const members = await loadMembers(slug, membersPath);
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
      const rawMinutes = schedule.minutes ?? [];
      const minutes =
        rawMinutes.some((minute) => KEEP_TYPES.has(minute.minute_type))
          ? rawMinutes
          : rawMinutes.flatMap((minute) => {
              if (KEEP_TYPES.has(minute.minute_type)) return [minute];
              if (minute.minute_type !== "本会議") return [];
              const inline = parseInlineTranscript(minute.text, minute.minute_id ?? scheduleId);
              if (inline.length > 0) return inline;
              const table = parseTableTranscript(minute.text, minute.minute_id ?? scheduleId);
              if (table.length > 0) return table;
              return parseQuestionNotice(minute.text, memberIndex, minute.minute_id ?? scheduleId);
            });

      const flush = () => {
        if (!group) return;
        const ordinal = segments.length + 1;
        const id = `${slug}-${councilId}-${scheduleId}-${String(ordinal).padStart(3, "0")}`;
        const member = matchMember(group.speaker, memberIndex);
        const text = stripMemberNamePrefix(group.texts.join("\n"), member?.name);
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

      for (const minute of minutes) {
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

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
