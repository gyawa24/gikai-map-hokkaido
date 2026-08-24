#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const cityArgIndex = process.argv.indexOf("--city");
const city = cityArgIndex >= 0 ? process.argv[cityArgIndex + 1] : "chitose";
if (!city) throw new Error("--city requires a value");

const dataDir = path.join(ROOT, "data", city);
const siteDataDir = path.join(ROOT, "site", "data", city);

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function normalizeName(raw) {
  return String(raw ?? "")
    .replace(/[　\s]/g, "")
    .replace(/^[0-9０-９]+番/, "")
    .replace(/[［[]([^］\]]+)[］\]]/g, "$1")
    .replace(/^.*?[（(]([^）)]+)[）)]$/, "$1")
    .replace(/(?:総務文教|厚生環境|産業建設|議会運営)(?:常任)?委員長$/, "")
    .replace(/(?:補正予算|予算|決算)(?:特別)?委員長$/, "")
    .replace(/(委員|議員|議長|副議長)$/, "")
    .replace(/(君|氏|殿)$/, "")
    .trim();
}

const members = readJson(path.join(dataDir, "members.json"), []);
const memberNames = members.map((member) => normalizeName(member.name));

function seatNumber(raw) {
  const normalized = String(raw ?? "").replace(/[０-９]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xfee0)
  );
  return Number(normalized.match(/^(\d+)番/)?.[1] ?? 0) || null;
}

function resolveMember(raw, { useSeat = false } = {}) {
  const normalized = normalizeName(raw);
  if (!normalized) return null;
  if (memberNames.includes(normalized)) return normalized;

  if (useSeat) {
    const member = members.find((item) => Number(item.seat_number) === seatNumber(raw));
    const bySeat = normalizeName(member?.name);
    if (bySeat && bySeat.startsWith(normalized)) return bySeat;
  }

  const contained = memberNames.filter(
    (name) => name.includes(normalized) || normalized.includes(name)
  );
  if (contained.length === 1) return contained[0];
  const prefixed = memberNames.filter((name) => name.startsWith(normalized));
  return prefixed.length === 1 ? prefixed[0] : null;
}

function rawText(minute) {
  return String(minute?.text ?? minute?.title ?? "");
}

function chairSpeechText(minute) {
  const source = rawText(minute);
  const heading = String(minute?.title ?? "").trim();
  if (heading && source.startsWith(`○${heading}`)) {
    return source.slice(heading.length + 1).trimStart();
  }
  if (heading && source.startsWith(heading)) return source.slice(heading.length).trimStart();
  return source;
}

function isChair(minute) {
  return minute?.minute_type === "○議長" || String(minute?.title ?? "").endsWith("議長");
}

function explicitPersonalMarker(minute) {
  if (minute?.minute_type !== "△議題") return null;
  const match = rawText(minute)
    .replace(/[　\s]/g, "")
    .match(/^△?(.+?)(?:議員|委員)の(一般質問|代表質問)/u);
  if (!match) return null;
  return {
    memberName: resolveMember(match[1]),
    kind: match[2] === "代表質問" ? "representative_question" : "general_question",
  };
}

function genericAgendaKind(minute) {
  const compact = rawText(minute).replace(/[　\s]/g, "");
  if (minute?.minute_type === "△議題") {
    if (/代表質問/u.test(compact)) return "representative_question";
    if (/一般質問|個人質問/u.test(compact)) return "general_question";
    return null;
  }
  if (!isChair(minute)) return null;
  if (/代表質問(?:の議事)?(?:を)?(?:行います|続行(?:いた)?します|継続(?:いた)?します|続けたいと思います)/u.test(compact)) {
    return "representative_question";
  }
  if (/(?:一般|個人)質問(?:の議事)?(?:を)?(?:行います|続行(?:いた)?します|継続(?:いた)?します|続けたいと思います)/u.test(compact)) {
    return "general_question";
  }
  return null;
}

function endsIndependentPersonalAgenda(minute) {
  if (genericAgendaKind(minute)) return false;
  if (minute?.minute_type === "△議題") {
    const heading = String(minute?.title ?? rawText(minute)).replace(/[　\s]/g, "");
    if (/^(?:(?:再開|休憩)(?:宣告)?|発言の訂正|議事進行の動議|会議時間の延長(?:について)?)$/u.test(heading)) return false;
    return !/(?:議員|委員|君|氏)$/u.test(heading);
  }
  if (!isChair(minute)) return false;
  const speech = chairSpeechText(minute).replace(/[　\s]/g, "");
  if (/^(?:引き続き、?|次に、?)?日程第/u.test(speech)) {
    return !/^(?:引き続き、?|次に、?)?日程第[^。]{0,24}(?:一般|代表|個人)質問/u.test(speech);
  }
  return /^(?:引き続き、?)?(?:議案|報告|意見書案|請願|陳情)第?[0-9０-９一二三四五六七八九十]+[^。]{0,80}(?:一括)?議題/u.test(speech);
}

function announcedPersonalMarker(minute, activeKind) {
  if (!activeKind || !isChair(minute)) return null;
  const compact = chairSpeechText(minute).replace(/[　\s]/g, "");
  const candidates = [...compact.matchAll(
    /([\p{Script=Han}々ぁ-んァ-ヿA-Za-z・]{1,24})(?:議員|委員|君|氏)の質問を(?:許します|許可します|許可いたします)/gu
  )];
  const rawName = candidates.at(-1)?.[1];
  return rawName ? { memberName: resolveEndingName(rawName), kind: activeKind } : null;
}

function personalMarker(minute, activeKind = null) {
  return explicitPersonalMarker(minute)
    ?? announcedPersonalMarker(minute, genericAgendaKind(minute) ?? activeKind);
}

function independentPersonalEndMatches(minute) {
  if (!isChair(minute)) return [];
  const body = chairSpeechText(minute).replace(/[　\s]/g, "");
  return [...body.matchAll(
    /(?:(?<person>[\p{Script=Han}々ぁ-んァ-ヿA-Za-z0-9０-９（）()・]{1,36}?)(?:議員|委員|議|君|氏)(?:の)?|(?<seat>[0-9０-９]+番)(?:の)?)(?:(?<type>代表|一般|個人|再)?(?:質問|質疑)|発言)(?:が|は|を)?(?:これで)?(?:(?:終わ?り|終え)(?:ます|ました)|(?:終了|終結)(?:し|いたし)(?:ます|ました)|了(?:し|いたし)?ました)/gu
  )];
}

function isPersonalEnd(minute) {
  return independentPersonalEndMatches(minute).length > 0;
}

function compactEndingLabel(raw) {
  return String(raw ?? "")
    .replace(/[\s　]/g, "")
    .replace(/^[0-9０-９]+番[、，]?/u, "")
    .replace(/[()（）]/g, "")
    .replace(/[、，。・]/g, "");
}

function endingLabelCanName(raw, memberName) {
  const label = compactEndingLabel(raw);
  for (let start = 0; start < label.length; start += 1) {
    const tail = label.substring(start);
    if (tail.length < 2) continue;
    if (
      tail === memberName
      || tail.startsWith(memberName)
      || memberName.startsWith(tail)
    ) return true;
  }
  return false;
}

function resolveEndingName(raw) {
  const normalized = normalizeName(raw);
  for (let index = 0; index < normalized.length; index += 1) {
    const memberName = resolveMember(normalized.slice(index));
    if (memberName) return memberName;
  }
  return null;
}

function independentEndingDeclarations(minute, agendaKind) {
  const declarations = [];
  for (const match of independentPersonalEndMatches(minute)) {
    const rawName = match.groups.person ?? match.groups.seat;
    const memberName = resolveEndingName(rawName);
    const kind = match.groups.type === "代表"
      ? "representative_question"
      : match.groups.type === "一般" || match.groups.type === "個人"
        ? "general_question"
        : agendaKind;
    if (kind) declarations.push({ rawName, memberName, kind });
  }
  return declarations;
}

function declarationMemberInWindow(declaration, minutes, start, end) {
  const hasTurn = (memberName) => minutes.slice(start, end).some((minute, offset) =>
    minute?.minute_type === "◆質問"
    && belongsToMember(minute.title, memberName)
    && !isIndependentNonQuestionAt(minutes, start + offset)
  );
  if (declaration.memberName && hasTurn(declaration.memberName)) {
    return declaration.memberName;
  }
  const supported = memberNames.filter((memberName) =>
    endingLabelCanName(declaration.rawName, memberName)
    && hasTurn(memberName)
  );
  if (supported.length === 1) return supported[0];
  if (/^[0-9０-９]+番$/u.test(declaration.rawName)) {
    const speakers = memberNames.filter(hasTurn);
    if (speakers.length === 1) return speakers[0];
  }
  return null;
}

function isPersonalProgramEnd(minute) {
  if (!isChair(minute)) return false;
  const clauses = chairSpeechText(minute)
    .replace(/[\s　]/g, "")
    .split(/[。！？]/u)
    .filter((clause) => clause.length > 0);
  return clauses.some((clause) => {
    if (/(?:全て|すべて)の議員の(?:一般|代表)質問/u.test(clause)) return true;
    if (/(?:これにて|これをもちまして|以上をもって|以上で)(?:(?!(?:氏|君|委員|議員)).){0,100}(?:代表|一般|個人)質問(?:を|は)?(?:すべて|全て)?(?:終わ|終結|終了)/u.test(clause)) {
      return true;
    }
    const occurrences = [...clause.matchAll(/(?:代表|一般|個人)質問/gu)];
    return occurrences.some((marker) => {
      const before = clause.substring(0, marker.index);
      if (/(?:議員|委員|君|氏)/u.test(before)) return false;
      return /(?:代表|一般|個人)質問(?:を|は)?(?:すべて|全て)?(?:終わ|終結|終了)/u.test(
        clause.substring(marker.index)
      );
    });
  });
}

function belongsToMember(rawSpeaker, memberName) {
  const normalized = normalizeName(rawSpeaker);
  return Boolean(
    normalized
    && (normalized === memberName
      || (normalized.length >= 2 && memberName.startsWith(normalized))
      || normalized.startsWith(memberName))
  );
}

function uniqueNumbers(values) {
  return [...new Set(values.map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
}

function sameValues(left, right) {
  return JSON.stringify([...left].map(String).sort()) === JSON.stringify([...right].map(String).sort());
}

function expectedPersonalMarkers(minutes) {
  const markers = new Map();
  let activeKind = null;
  for (let index = 0; index < minutes.length; index += 1) {
    if (activeKind && endsIndependentPersonalAgenda(minutes[index])) activeKind = null;
    activeKind = genericAgendaKind(minutes[index]) ?? activeKind;
    const marker = personalMarker(minutes[index], activeKind);
    if (marker) markers.set(index, marker);
    if (isPersonalProgramEnd(minutes[index])) activeKind = null;
  }
  return markers;
}

function parsePersonalBlocks(meeting) {
  const blocks = [];
  const occupied = new Map();
  for (const schedule of meeting.schedules ?? []) {
    const minutes = schedule.minutes ?? [];
    const used = new Set();
    const markers = expectedPersonalMarkers(minutes);
    occupied.set(Number(schedule.schedule_id), used);

    let agendaKind = null;
    let agendaFloor = 0;
    let lastPersonalEnding = -1;
    for (let endingIndex = 0; endingIndex < minutes.length; endingIndex += 1) {
      if (agendaKind && endsIndependentPersonalAgenda(minutes[endingIndex])) {
        agendaKind = null;
        agendaFloor = endingIndex + 1;
        lastPersonalEnding = -1;
      }
      const detectedKind = genericAgendaKind(minutes[endingIndex]);
      if (detectedKind) {
        if (detectedKind !== agendaKind) {
          lastPersonalEnding = -1;
          agendaFloor = endingIndex;
        }
        agendaKind = detectedKind;
      }
      const declarations = independentEndingDeclarations(minutes[endingIndex], agendaKind);
      const emitted = new Set();
      for (const declaration of declarations) {
        const lowerBound = Math.max(
          agendaFloor,
          lastPersonalEnding >= 0 ? lastPersonalEnding : agendaFloor
        );
        const memberName = declarationMemberInWindow(
          declaration,
          minutes,
          lowerBound,
          endingIndex
        );
        if (!memberName) continue;
        const declarationKey = `${declaration.kind}:${memberName}`;
        if (emitted.has(declarationKey)) continue;
        emitted.add(declarationKey);

        const speakerTurns = [];
        const matchingTurns = [];
        for (let index = lowerBound; index < endingIndex; index += 1) {
          if (
            minutes[index]?.minute_type === "◆質問"
            && belongsToMember(minutes[index].title, memberName)
          ) {
            speakerTurns.push(index);
            if (!isIndependentNonQuestionAt(minutes, index)) matchingTurns.push(index);
          }
        }
        if (matchingTurns.length === 0) continue;

        const firstTurn = speakerTurns[0];
        let blockStart = firstTurn;
        for (const [candidateIndex, marker] of markers) {
          if (candidateIndex < lowerBound || candidateIndex > firstTurn) continue;
          if (
            marker.memberName === memberName
            && marker.kind === declaration.kind
          ) {
            blockStart = candidateIndex;
          }
        }
        for (let index = blockStart; index < endingIndex; index += 1) used.add(index);
        blocks.push({
          councilId: Number(meeting.council_id),
          scheduleId: Number(schedule.schedule_id),
          blockId: `s${schedule.schedule_id}-m${minutes[blockStart].minute_id}`,
          kind: declaration.kind,
          memberName,
          minuteIds: uniqueNumbers(matchingTurns.map((index) => minutes[index].minute_id)),
        });
      }
      if (isPersonalEnd(minutes[endingIndex])) lastPersonalEnding = endingIndex;
      if (isPersonalProgramEnd(minutes[endingIndex])) {
        agendaKind = null;
        agendaFloor = endingIndex + 1;
        lastPersonalEnding = -1;
      }
    }

    for (let start = 0; start < minutes.length; start += 1) {
      const marker = markers.get(start);
      if (!marker || used.has(start)) continue;
      const memberName = marker.memberName;
      let end = minutes.length - 1;
      let reachedProgramEnd = false;
      for (let index = start + 1; index < minutes.length; index += 1) {
        if (isPersonalProgramEnd(minutes[index])) {
          end = index;
          reachedProgramEnd = true;
          break;
        }
        if (markers.has(index)) {
          end = index - 1;
          break;
        }
        if (isPersonalEnd(minutes[index])) {
          end = index;
          break;
        }
        const followingMember = minutes[index]?.minute_type === "◆質問"
          && !isIndependentNonQuestionAt(minutes, index)
          ? resolveMember(minutes[index].title, { useSeat: true })
          : null;
        if (followingMember && followingMember !== memberName) {
          end = index - 1;
          break;
        }
      }
      for (let index = start; index <= end; index += 1) used.add(index);
      if (memberName) {
        const minuteIds = minutes.slice(start + 1, end + 1)
          .filter((minute, offset) =>
            minute.minute_type === "◆質問"
            && belongsToMember(minute.title, memberName)
            && !isIndependentNonQuestionAt(minutes, start + 1 + offset)
          )
          .map((minute) => minute.minute_id);
        if (minuteIds.length > 0) {
          blocks.push({
            councilId: Number(meeting.council_id),
            scheduleId: Number(schedule.schedule_id),
            blockId: `s${schedule.schedule_id}-m${minutes[start].minute_id}`,
            kind: marker.kind,
            memberName,
            minuteIds: uniqueNumbers(minuteIds),
          });
        }
      }
      if (reachedProgramEnd) agendaKind = null;
      start = end;
    }

    // 個人△見出しが欠けても、一般/代表質問の議題中で、議長の終了宣言まで
    // 同一議員の◆turnが続く場合は独立blockとして期待する。
    let activeKind = null;
    for (let start = 0; start < minutes.length; start += 1) {
      if (activeKind && endsIndependentPersonalAgenda(minutes[start])) activeKind = null;
      activeKind = genericAgendaKind(minutes[start]) ?? activeKind;
      if (isPersonalProgramEnd(minutes[start])) {
        activeKind = null;
        continue;
      }
      if (isPersonalEnd(minutes[start])) continue;
      if (
        !activeKind
        || used.has(start)
        || minutes[start]?.minute_type !== "◆質問"
        || isIndependentNonQuestionAt(minutes, start)
      ) continue;
      const memberName = resolveMember(minutes[start].title, { useSeat: true });
      if (!memberName) continue;
      let end = minutes.length - 1;
      let reachedProgramEnd = false;
      for (let index = start + 1; index < minutes.length; index += 1) {
        if (isPersonalProgramEnd(minutes[index])) {
          end = index;
          reachedProgramEnd = true;
          break;
        }
        if (markers.has(index)) {
          end = index - 1;
          break;
        }
        if (isPersonalEnd(minutes[index])) {
          end = index;
          break;
        }
        const followingMember = minutes[index]?.minute_type === "◆質問"
          && !isIndependentNonQuestionAt(minutes, index)
          ? resolveMember(minutes[index].title, { useSeat: true })
          : null;
        if (followingMember && followingMember !== memberName) {
          end = index - 1;
          break;
        }
      }
      const minuteIds = [];
      for (let index = start; index <= end; index += 1) {
        used.add(index);
        if (
          minutes[index]?.minute_type === "◆質問"
          && belongsToMember(minutes[index].title, memberName)
          && !isIndependentNonQuestionAt(minutes, index)
        ) {
          minuteIds.push(minutes[index].minute_id);
        }
      }
      if (minuteIds.length > 0) {
        blocks.push({
          councilId: Number(meeting.council_id),
          scheduleId: Number(schedule.schedule_id),
          blockId: `s${schedule.schedule_id}-m${minutes[start].minute_id}`,
          kind: activeKind,
          memberName,
          minuteIds: uniqueNumbers(minuteIds),
        });
      }
      if (reachedProgramEnd) activeKind = null;
      start = end;
    }
  }
  const consolidated = new Map();
  for (const block of blocks) {
    const key = [block.councilId, block.scheduleId, block.kind, block.memberName].join(":");
    const prior = consolidated.get(key);
    if (!prior) {
      consolidated.set(key, block);
      continue;
    }
    const blockMinute = Number(block.blockId.match(/-m([0-9]+)/u)?.[1]);
    const priorMinute = Number(prior.blockId.match(/-m([0-9]+)/u)?.[1]);
    const first = blockMinute < priorMinute ? block : prior;
    consolidated.set(key, {
      ...first,
      minuteIds: uniqueNumbers([...prior.minuteIds, ...block.minuteIds]),
    });
  }
  return { blocks: [...consolidated.values()], occupied };
}

function isPlenaryStart(minute) {
  if (!isChair(minute)) return false;
  const text = rawText(minute);
  return /ただいまから[^。\n]*質疑を行います/u.test(text)
    || /(?:第[0-9０-９一二三四五六七八九十]+款|同款)[^。\n]{0,80}質疑(?:に付します|を続行(?:いた)?します)/u.test(text);
}

function independentPlenaryScopeKind(minute) {
  const compact = rawText(minute).normalize("NFKC").replace(/[　\s]/g, "");
  if (/第[0-9一二三四五六七八九十]+款/u.test(compact)) return "new_scope";
  if (/同款[^。\n]{0,80}質疑を続行(?:いた)?します/u.test(compact)) return "same_scope";
  return "unscoped";
}

function isPlenaryEnd(minute) {
  const text = rawText(minute);
  return isChair(minute)
    && (
      /質疑終結(?:いた)?しました/u.test(text)
      || (
        /質疑を終わります/u.test(text)
        && !/[一-龠々ぁ-んァ-ヶ]+議員の質疑を終わります/u.test(text)
      )
    );
}

function isRawQuestionCapableMeeting(meeting) {
  return (meeting.schedules ?? []).some((schedule) =>
    (schedule.minutes ?? []).some((minute) =>
      explicitPersonalMarker(minute)
      || genericAgendaKind(minute)
      || isPlenaryStart(minute)
    )
  );
}

function isIndependentCorrectionOnlySpeech(text) {
  if (text.length > 240) return false;
  const match = text.match(
    /(?:訂正(?:とおわびを申し上げます?|します|いたします|させていただきます)|(?:発言|質問|質疑)[\s\S]{0,220}?(?:撤回(?:したい|します|いたします)|(?:取|取り)消し(?:たい|ます|いたします)|却下(?:します|いたします)))/u
  );
  if (!match) return false;
  const remainder = text
    .substring((match.index ?? 0) + match[0].length)
    .replace(/^[。！？、，\s　]+/u, "");
  return !/(?:伺(?:い|います)?|聞かせ|尋ね|教えて|知らせ|説明.{0,8}(?:願|ください|いただ)|お願いしたい|いかが|どうです|どうでしょう|ですか|ますか)/u.test(remainder);
}

function containsIndependentQuestionIntent(text) {
  const prose = String(text ?? "")
    .replace(/質問(?:は|を)?(?:しません|いたしません|しない|いたさない|するつもりはありません)/gu, "")
    .replace(/(?:(?:私|以上|これ)の)?(?:質問|質疑)(?:を|は)?(?:終わ(?:ります|りたいと思います|らせていただきます)|終了(?:します|いたします))/gu, "");
  const interrogativeWords = /(?:質問|質疑|伺|聞|尋|問(?:い|う|え|わせ|われ)|答(?:え|弁)|見解|所見|説明|教|知らせ|示|確認|いかが|どう|どの(?:よう|程度|くらい|ぐらい)|何(?:件|人|割|点|回|年|月|日|円|％)|[?？])/u;
  const interrogativeEnding = /(?:の|なの|なのです|です|ます|ません|でしょう)か(?:[、。？！]|$)/u;
  return interrogativeWords.test(prose) || interrogativeEnding.test(prose);
}

function independentlyDeclaresNoQuestionAndCloses(text) {
  const declaration = String(text ?? "").match(
    /質問(?:は|を)?(?:しません|いたしません|しない|いたさない|するつもりはありません)/u
  );
  if (!declaration) return false;
  const following = text.substring((declaration.index ?? 0) + declaration[0].length);
  const laterQuestion = /(?:質問(?:します|いたします|があります)|質疑(?:します|いたします)|伺|聞(?:き|かせ)|尋ね|問(?:い|う|わせ)|答(?:え|弁)|見解|所見|いかが|どう|どの(?:よう|程度|くらい|ぐらい)|何(?:件|人|割|点|回|年|月|日|円|％)|[?？]|(?:の|なの|です|ます|ません|でしょう)か(?:[、。？！]|$))/u.test(following);
  return !laterQuestion
    && /(?:終わ(?:ります|りたい)|以上(?:です|であります))[^。]*[。！]?$/u.test(
      text.replace(/[\s　]+/g, "")
    );
}

function independentlyHasTerminalNoAnswerClosing(text) {
  const compact = String(text ?? "").replace(/[\s　]+/g, "");
  const questionClose = /(?:(?:私|以上|これ)(?:から)?の)?(?:質問|質疑)(?:を|は)?[、，]?(?:これで)?(?:終わ(?:ります|りたい(?:と思います)?|らせていただき(?:ます|たいと思います))|終え(?:ます|たい(?:と思います)?)|終了(?:します|いたします|させていただき(?:ます|たいと思います)))(?:[。！]*(?:どうも)?ありがとうございました)?(?:[。！]*以上です)?[。！]*$/u;
  const bareClose = /(?:これで)?終わ(?:ります|りたい(?:と思います)?|らせていただき(?:ます|たいと思います))[。！]*(?:ありがとうございました[。！]*)?(?:以上です[。！]*)?$/u;
  return questionClose.test(compact) || bareClose.test(compact);
}

function independentlyHasResponseBeforeBoundary(minutes, index) {
  for (let cursor = index + 1; cursor < minutes.length; cursor += 1) {
    const minute = minutes[cursor];
    const text = rawText(minute);
    if (minute?.minute_type === "◎答弁" || /^◎/u.test(text)) return true;
    if (
      isChair(minute)
      && /(?:答弁を求め|答弁願|御?答弁(?:を|願)|お答え(?:を|願)|説明を求め)/u.test(text)
    ) {
      return true;
    }
    if (minute?.minute_type === "◆質問" || minute?.minute_type === "△議題") return false;
    if (
      isChair(minute)
      && /(?:他に|次に|質疑終結|質疑を(?:保留|終わ)|暫時休憩|散会|質問(?:は|を)?(?:終了|終結|終わ)|議員(?:の質問)?を許)/u.test(text)
    ) {
      return false;
    }
  }
  return false;
}

function isRoleTurn(minute) {
  const text = rawText(minute).replace(/^[◆△◎○][^　\s]*[　\s]*/, "").trim();
  if (isIndependentCorrectionOnlySpeech(text)) return true;
  if (/^(?:これで|以上です)?終わります[。！]?$/u.test(text)) return true;
  if (/^(?:御異議なしと認め|本日はこれをもちまして散会)/u.test(text)) return true;
  if (text.length <= 80 && !/(?:質問|質疑|お尋ね|お聞き|伺)/u.test(text) && /^(?:了解しました|分かりました|ありがとうございます)[^。]*(?:以上|結構|よろしく)/u.test(text)) {
    return true;
  }
  if (/(?:反対|賛成)(?:する)?立場から討論|討論を(?:行|させて)|動議を(?:提出|かけ|発議)|議会運営委員会を開いて(?:調査|協議)|指名いたします|御説明申し上げます|^少数意見報告書|^(?:御)?報告(?:いた|申し上げ)ます/u.test(text)) {
    return true;
  }
  if (independentlyDeclaresNoQuestionAndCloses(text)) return true;
  const hasQuestionSignal = containsIndependentQuestionIntent(text);
  const compact = text.replace(/[\s　]+/g, "");
  if (!hasQuestionSignal) {
    const terminalClose = /(?:以上(?:です|で(?:、)?(?:終わ|終わり)|であります)|(?:(?:私|以上|これ)の)?(?:質問|質疑)(?:を|は)?終わ(?:ります|りたいと思います|らせていただきます)|終わ(?:ります|りたいと思います|らせていただきます)|ありがとうございました|よろしく(?:お願い(?:いた)?します|頼みます)|お願い(?:いた)?します)[。！]*(?:ありがとうございました[。！]*)?(?:以上です[。！]*)?$/u;
    if (text.length <= 220 && terminalClose.test(compact)) return true;
    const declaredRequestEnd = /(?:要望|指摘)(?:を)?(?:して|させていただいて|いたしまして)[^。]{0,55}(?:(?:(?:私|以上|これ)の)?(?:質問|質疑)(?:を|は)?)?(?:終わ(?:ります|りたい)|以上(?:です|であります))(?:ありがとうございました[。！]*)?(?:以上です[。！]*)?$/su;
    if (declaredRequestEnd.test(compact)) return true;
  }
  return !hasQuestionSignal && (
    /自己紹介(?:を|させて|いたし)/u.test(text)
    || /(?:委員長報告|委員会[^\n。]*(?:経過|結果)[^\n。]*報告)/u.test(text)
  );
}

function isIndependentNonQuestionAt(minutes, index) {
  const current = minutes[index];
  if (isRoleTurn(current)) return true;
  if (current?.minute_type !== "◆質問") return false;
  const lower = Math.max(0, index - 8);
  for (let priorIndex = index - 1; priorIndex >= lower; priorIndex -= 1) {
    const prior = minutes[priorIndex];
    if (/(?:議事進行|訂正の申出|発言の訂正)/u.test(rawText(prior))) return true;
    if (genericAgendaKind(prior) || personalMarker(prior)) return false;
    if (prior?.minute_type === "△議題" && endsIndependentPersonalAgenda(prior)) return false;
  }
  return false;
}

function isIndependentNonQuestionPlenaryAt(minutes, index) {
  if (isIndependentNonQuestionAt(minutes, index)) return true;
  const current = minutes[index];
  if (current?.minute_type !== "◆質問") return false;
  const text = rawText(current).replace(/^[◆△◎○][^　\s]*[　\s]*/, "").trim();
  return independentlyHasTerminalNoAnswerClosing(text)
    && !independentlyHasResponseBeforeBoundary(minutes, index);
}

function expectedRespondents(minutes, start) {
  const qualifier = rawText(minutes[start]).match(/(?:提出者|委員長)に対する/u)?.[0]
    ?.replace("に対する", "") ?? "";
  let boundary = 0;
  for (let index = start - 1; index >= 0; index -= 1) {
    if (minutes[index]?.minute_type === "△議題" || isPlenaryEnd(minutes[index])) {
      boundary = index;
      break;
    }
  }
  const prior = minutes.slice(boundary, start).filter((minute) => minute.minute_type === "◆質問");
  const respondents = new Set();
  for (const minute of prior) {
    if (/報告いたします|御説明申し上げます|少数意見報告書|提案(?:の)?理由/u.test(rawText(minute))) {
      const memberName = resolveMember(minute.title, { useSeat: true });
      if (memberName) respondents.add(memberName);
    }
  }
  if (qualifier) {
    const respondent = [...prior].reverse().find((minute) =>
      qualifier !== "委員長" || String(minute.title ?? "").includes("委員長")
    ) ?? prior.at(-1);
    const memberName = resolveMember(respondent?.title, { useSeat: true });
    if (memberName) respondents.add(memberName);
  }
  return respondents;
}

function parsePlenaryBlocks(meeting, occupied) {
  const consolidated = new Map();
  for (const schedule of meeting.schedules ?? []) {
    const minutes = schedule.minutes ?? [];
    const used = occupied.get(Number(schedule.schedule_id)) ?? new Set();
    let openScopeBlockId = null;
    for (let start = 0; start < minutes.length; start += 1) {
      if (used.has(start) || !isPlenaryStart(minutes[start])) continue;
      const defaultBlockId = `s${schedule.schedule_id}-m${minutes[start].minute_id}`;
      const scopeKind = independentPlenaryScopeKind(minutes[start]);
      let blockId = defaultBlockId;
      if (scopeKind === "new_scope") {
        openScopeBlockId = defaultBlockId;
      } else if (scopeKind === "same_scope" && openScopeBlockId) {
        blockId = openScopeBlockId;
      } else {
        openScopeBlockId = null;
      }
      let end = minutes.length - 1;
      let endedByDeclaration = false;
      for (let index = start + 1; index < minutes.length; index += 1) {
        if (isPlenaryStart(minutes[index])) {
          end = index - 1;
          break;
        }
        if (isPlenaryEnd(minutes[index])) {
          end = index;
          endedByDeclaration = true;
          break;
        }
      }
      const respondents = expectedRespondents(minutes, start);
      const byMember = new Map();
      for (let index = start + 1; index <= end; index += 1) {
        const minute = minutes[index];
        if (minute?.minute_type !== "◆質問" || isIndependentNonQuestionPlenaryAt(minutes, index)) continue;
        const memberName = resolveMember(minute.title, { useSeat: true });
        if (!memberName || respondents.has(memberName)) continue;
        const ids = byMember.get(memberName) ?? [];
        ids.push(minute.minute_id);
        byMember.set(memberName, ids);
      }
      for (const [memberName, minuteIds] of byMember) {
        const recordKey = `${blockId}:${memberName}`;
        const current = consolidated.get(recordKey);
        const block = {
          councilId: Number(meeting.council_id),
          scheduleId: Number(schedule.schedule_id),
          blockId,
          kind: "plenary_question",
          memberName,
          minuteIds: uniqueNumbers(minuteIds),
        };
        consolidated.set(recordKey, current
          ? { ...current, minuteIds: uniqueNumbers([...current.minuteIds, ...block.minuteIds]) }
          : block);
      }
      if (endedByDeclaration) openScopeBlockId = null;
      start = end;
    }
  }
  return [...consolidated.values()];
}

function declaredPersonalEndings(meeting) {
  const endings = [];
  for (const schedule of meeting.schedules ?? []) {
    const minutes = schedule.minutes ?? [];
    let activeKind = null;
    let lastEndingIndex = -1;
    for (let minuteIndex = 0; minuteIndex < minutes.length; minuteIndex += 1) {
      const minute = minutes[minuteIndex];
      if (activeKind && endsIndependentPersonalAgenda(minute)) {
        activeKind = null;
        lastEndingIndex = minuteIndex;
      }
      const nextKind = genericAgendaKind(minute);
      if (nextKind && nextKind !== activeKind) lastEndingIndex = minuteIndex;
      activeKind = nextKind ?? activeKind;
      const seen = new Set();
      for (const declaration of independentEndingDeclarations(minute, activeKind)) {
        const memberName = declarationMemberInWindow(
          declaration,
          minutes,
          lastEndingIndex + 1,
          minuteIndex
        );
        if (!memberName) continue;
        const key = `${declaration.kind}:${memberName}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const hasCanonicalQuestionTurn = minutes
          .slice(lastEndingIndex + 1, minuteIndex)
          .some((candidate, offset) =>
            candidate.minute_type === "◆質問"
            && belongsToMember(candidate.title, memberName)
            && !isIndependentNonQuestionAt(minutes, lastEndingIndex + 1 + offset)
          );
        if (!hasCanonicalQuestionTurn) continue;
        endings.push({
          councilId: Number(meeting.council_id),
          scheduleId: Number(schedule.schedule_id),
          kind: declaration.kind,
          memberName,
          minuteId: Number(minute.minute_id),
        });
      }
      if (isPersonalEnd(minute)) lastEndingIndex = minuteIndex;
      if (isPersonalProgramEnd(minute)) {
        activeKind = null;
        lastEndingIndex = minuteIndex;
      }
    }
  }
  return endings;
}

const errors = [];
const rootPath = path.join(dataDir, "members_activity.json");
const sitePath = path.join(siteDataDir, "members_activity.json");
const rootText = fs.readFileSync(rootPath, "utf8");
const siteText = fs.readFileSync(sitePath, "utf8");
if (rootText !== siteText) errors.push("root/site members_activity.json are not identical");

const activity = JSON.parse(rootText);
const minutesIndex = readJson(path.join(dataDir, "minutes", "index.json"), []);
const publishedCouncilIds = new Set(
  (Array.isArray(minutesIndex) ? minutesIndex : [])
    .map((item) => Number(item.council_id))
    .filter(Number.isFinite)
);
const actualById = new Map();
let sessionCount = 0;
for (const [memberName, entry] of Object.entries(activity)) {
  if (!memberNames.includes(normalizeName(memberName))) {
    errors.push(`${memberName}: member is not present in members.json`);
  }
  if (normalizeName(entry.name) !== normalizeName(memberName)) {
    errors.push(`${memberName}: entry.name does not match its object key`);
  }
  const sessions = Array.isArray(entry.sessions) ? entry.sessions : [];
  sessionCount += sessions.length;
  const legacySessionCount = sessions.filter((session) =>
    ["legacy-segments", "legacy-enriched"].includes(session.block_id)
  ).length;
  if (legacySessionCount > 0) {
    errors.push(`${memberName}: unclassified legacy records must not be published`);
  }
  if (entry.classification_status !== "classified") {
    errors.push(`${memberName}: classification_status is incorrect`);
  }
  if (entry.session_count !== sessions.length) {
    errors.push(`${memberName}: session_count does not match sessions.length`);
  }
  const memberGeneratedTopics = Array.isArray(entry.generated_topics)
    ? entry.generated_topics
    : [];
  if (entry.generated_topics !== undefined && !Array.isArray(entry.generated_topics)) {
    errors.push(`${memberName}: generated_topics is not an array`);
  }
  if (memberGeneratedTopics.length > 80) {
    errors.push(`${memberName}: generated_topics exceeds 80 items`);
  }
  if (memberGeneratedTopics.some((topic) => !String(topic ?? "").trim())) {
    errors.push(`${memberName}: generated_topics contains an empty item`);
  }
  if (new Set(memberGeneratedTopics).size !== memberGeneratedTopics.length) {
    errors.push(`${memberName}: generated_topics contains duplicates`);
  }
  const officialCount = sessions.filter((session) => session.source_status !== "preliminary").length;
  const preliminaryCount = sessions.filter((session) => session.source_status === "preliminary").length;
  if (entry.official_session_count !== officialCount) errors.push(`${memberName}: official_session_count is incorrect`);
  if (entry.preliminary_session_count !== preliminaryCount) errors.push(`${memberName}: preliminary_session_count is incorrect`);
  for (const [field, kind] of [
    ["general_question_count", "general_question"],
    ["representative_question_count", "representative_question"],
    ["committee_question_count", "committee_question"],
    ["plenary_question_count", "plenary_question"],
    ["other_question_count", "other_question"],
  ]) {
    const expected = sessions.filter((session) => session.question_kind === kind).length;
    if (entry[field] !== expected) errors.push(`${memberName}: ${field} is incorrect`);
  }

  for (const session of sessions) {
    if (!session.record_id) errors.push(`${memberName}: record_id is missing`);
    if (actualById.has(session.record_id)) errors.push(`duplicate record_id: ${session.record_id}`);
    actualById.set(session.record_id, { ...session, memberName });
    if (!session.href) errors.push(`${session.record_id}: href is missing`);
    if (!session.source_type || !session.source_status) errors.push(`${session.record_id}: source metadata is missing`);
    if (session.date && !/^\d{4}-\d{2}-\d{2}$/.test(session.date)) errors.push(`${session.record_id}: date is not ISO format`);
    const canonicalTopics = Array.isArray(session.canonical_topics)
      ? session.canonical_topics
      : [];
    const generatedTopics = Array.isArray(session.generated_topics)
      ? session.generated_topics
      : [];
    if (session.canonical_topics !== undefined && !Array.isArray(session.canonical_topics)) {
      errors.push(`${session.record_id}: canonical_topics is not an array`);
    }
    if (canonicalTopics.length > 24) {
      errors.push(`${session.record_id}: canonical_topics exceeds 24 items`);
    }
    if (canonicalTopics.some((topic) => !String(topic ?? "").trim())) {
      errors.push(`${session.record_id}: canonical_topics contains an empty item`);
    }
    if (new Set(canonicalTopics).size !== canonicalTopics.length) {
      errors.push(`${session.record_id}: canonical_topics contains duplicates`);
    }
    if (canonicalTopics.length > 0) {
      if (session.source_status !== "official") {
        errors.push(`${session.record_id}: canonical_topics requires official evidence`);
      }
      const expectedSummaryPrefix = canonicalTopics.slice(0, 12);
      const actualSummaryPrefix = (session.summary_topics ?? []).slice(0, expectedSummaryPrefix.length);
      if (JSON.stringify(actualSummaryPrefix) !== JSON.stringify(expectedSummaryPrefix)) {
        errors.push(`${session.record_id}: canonical_topics must lead summary_topics`);
      }
    }
    if (session.generated_topics !== undefined && !Array.isArray(session.generated_topics)) {
      errors.push(`${session.record_id}: generated_topics is not an array`);
    }
    if (generatedTopics.length > 24) {
      errors.push(`${session.record_id}: generated_topics exceeds 24 items`);
    }
    if (generatedTopics.some((topic) => !String(topic ?? "").trim())) {
      errors.push(`${session.record_id}: generated_topics contains an empty item`);
    }
    if (new Set(generatedTopics).size !== generatedTopics.length) {
      errors.push(`${session.record_id}: generated_topics contains duplicates`);
    }
    if (generatedTopics.some((topic) => canonicalTopics.includes(topic))) {
      errors.push(`${session.record_id}: generated_topics overlaps canonical_topics`);
    }
    if (session.source_status === "official") {
      if (!(session.council_id > 0)) errors.push(`${session.record_id}: official record has no council_id`);
      if (!publishedCouncilIds.has(Number(session.council_id))) {
        errors.push(`${session.record_id}: official record is not listed in minutes/index.json`);
      }
      const hrefPath = String(session.href ?? "").split(/[?#]/u, 1)[0];
      if (hrefPath !== `/${city}/minutes/${session.council_id}`) {
        errors.push(`${session.record_id}: official href does not match council_id`);
      }
      if (!session.block_id) errors.push(`${session.record_id}: official record has no block_id`);
      if (!Object.hasOwn(session, "agenda_title")) errors.push(`${session.record_id}: official record has no agenda_title`);
      const evidenceMinuteIds = Array.isArray(session.evidence_minute_ids)
        ? session.evidence_minute_ids
        : [];
      const evidenceSegmentIds = Array.isArray(session.evidence_segment_ids)
        ? session.evidence_segment_ids
        : [];
      if (evidenceMinuteIds.length === 0 && evidenceSegmentIds.length === 0) {
        errors.push(`${session.record_id}: official record has no raw evidence`);
      }
      const expectedId = `${city}:official:${session.council_id}:${session.question_kind}:${session.block_id}:${memberName}`;
      if (session.record_id !== expectedId) errors.push(`${session.record_id}: record_id does not encode city/council/kind/block/member`);
    }
    if (session.source_status === "preliminary" && session.source_type !== "video_transcript") {
      errors.push(`${session.record_id}: preliminary record must be a video transcript`);
    }
  }
}

const meetings = (Array.isArray(minutesIndex) ? minutesIndex : []).flatMap((item) => {
  const meeting = readJson(path.join(dataDir, "minutes", `${item.council_id}.json`), null);
  return meeting?.schedules ? [meeting] : [];
});
const meetingByCouncil = new Map(meetings.map((meeting) => [Number(meeting.council_id), meeting]));

const actualPersonalByBoundary = new Map();
for (const record of actualById.values()) {
  if (
    record.source_status !== "official"
    || !["general_question", "representative_question"].includes(record.question_kind)
    || !Number.isFinite(Number(record.schedule_id))
  ) {
    continue;
  }
  const key = [record.council_id, record.schedule_id, record.question_kind, record.memberName].join(":");
  if (actualPersonalByBoundary.has(key)) {
    errors.push(`duplicate personal question boundary: ${key}`);
  }
  actualPersonalByBoundary.set(key, record);
}

const declaredEndings = meetings
  .filter((meeting) => !String(meeting.name ?? "").includes("委員会"))
  .flatMap(declaredPersonalEndings);
for (const ending of declaredEndings) {
  const key = [ending.councilId, ending.scheduleId, ending.kind, ending.memberName].join(":");
  if (!actualPersonalByBoundary.has(key)) {
    errors.push(`declared personal question ending has no activity record: ${key} at minute ${ending.minuteId}`);
  }
}

for (const record of actualById.values()) {
  if (
    record.source_status !== "official"
    || !["general_question", "representative_question", "plenary_question"].includes(record.question_kind)
    || !Number.isFinite(Number(record.schedule_id))
  ) {
    continue;
  }
  const meeting = meetingByCouncil.get(Number(record.council_id));
  const schedule = (meeting?.schedules ?? []).find((item) =>
    Number(item.schedule_id) === Number(record.schedule_id)
  );
  const minuteById = new Map(
    (schedule?.minutes ?? []).map((minute) => [Number(minute.minute_id), minute])
  );
  const minuteIndexById = new Map(
    (schedule?.minutes ?? []).map((minute, index) => [Number(minute.minute_id), index])
  );
  for (const minuteId of record.evidence_minute_ids ?? []) {
    const minute = minuteById.get(Number(minuteId));
    const minuteIndex = minuteIndexById.get(Number(minuteId));
    if (
      minute
      && Number.isFinite(minuteIndex)
      && (
        record.question_kind === "plenary_question"
          ? isIndependentNonQuestionPlenaryAt(schedule.minutes, minuteIndex)
          : isIndependentNonQuestionAt(schedule.minutes, minuteIndex)
      )
    ) {
      errors.push(`${record.record_id}: non-question role turn remains in evidence minute ${minuteId}`);
    }
  }
}

const segmentsByCouncil = new Map();
const segmentIndex = readJson(path.join(dataDir, "segments", "_index.json"), []);
for (const councilId of new Set(
  (Array.isArray(segmentIndex) ? segmentIndex : [])
    .map((item) => Number(item.council_id))
    .filter((councilId) => Number.isFinite(councilId) && publishedCouncilIds.has(councilId))
)) {
  segmentsByCouncil.set(councilId, readJson(path.join(dataDir, "segments", `${councilId}.json`), []));
}

function compactEvidenceText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}々ヶヵー]+/gu, "");
}

function canonicalEvidenceText(record) {
  const segmentIds = new Set(record.evidence_segment_ids ?? []);
  const chunks = (segmentsByCouncil.get(Number(record.council_id)) ?? [])
    .filter((segment) => segmentIds.has(segment.id))
    .map((segment) => segment.text ?? segment.excerpt ?? "");

  if (Number.isFinite(Number(record.schedule_id))) {
    const minuteIds = new Set((record.evidence_minute_ids ?? []).map(Number));
    const meeting = meetingByCouncil.get(Number(record.council_id));
    chunks.push(
      ...(meeting?.schedules ?? [])
        .filter((schedule) => Number(schedule.schedule_id) === Number(record.schedule_id))
        .flatMap((schedule) => schedule.minutes ?? [])
        .filter((minute) => minuteIds.has(Number(minute.minute_id)))
        .map(rawText)
    );
  }
  const deduplicated = new Map();
  for (const chunk of chunks) {
    const key = compactEvidenceText(chunk);
    if (key && !deduplicated.has(key)) deduplicated.set(key, chunk);
  }
  return compactEvidenceText([...deduplicated.values()].join(" "));
}

for (const record of actualById.values()) {
  const evidenceText = canonicalEvidenceText(record);
  for (const topic of record.canonical_topics ?? []) {
    const compactTopic = compactEvidenceText(topic);
    if (!compactTopic || !evidenceText.includes(compactTopic)) {
      errors.push(`${record.record_id}: canonical topic has no exact raw evidence: ${topic}`);
    }
  }
}

const expectedById = new Map();
function expectedSegments(block) {
  const minuteIds = new Set(block.minuteIds.map(String));
  return (segmentsByCouncil.get(block.councilId) ?? []).filter((segment) =>
    String(segment.source?.schedule_id ?? segment.schedule_id) === String(block.scheduleId)
    && (segment.source?.minute_ids ?? []).some((minuteId) => minuteIds.has(String(minuteId)))
  );
}

function addExpectedBlock(block) {
  const recordId = `${city}:official:${block.councilId}:${block.kind}:${block.blockId}:${block.memberName}`;
  const segments = expectedSegments(block);
  expectedById.set(recordId, { ...block, recordId, evidenceSegmentIds: segments.map((segment) => segment.id) });
}

for (const meeting of meetings) {
  const councilId = Number(meeting.council_id);
  if (String(meeting.name ?? "").includes("委員会")) {
    continue;
  }
  if (!isRawQuestionCapableMeeting(meeting)) continue;
  const { blocks, occupied } = parsePersonalBlocks(meeting);
  for (const block of blocks) addExpectedBlock(block);
  for (const block of parsePlenaryBlocks(meeting, occupied)) addExpectedBlock(block);
}

const enrichedMembers = new Map();
const enrichedDir = path.join(dataDir, "minutes", "enriched");
if (fs.existsSync(enrichedDir)) {
  for (const file of fs.readdirSync(enrichedDir).filter((name) => name.endsWith(".json"))) {
    const document = readJson(path.join(enrichedDir, file), null);
    if (!document) continue;
    if (!publishedCouncilIds.has(Number(document.council_id))) continue;
    const names = enrichedMembers.get(String(document.council_id)) ?? new Set();
    for (const questioner of document.questioners ?? []) {
      const memberName = resolveMember(questioner.name);
      if (memberName) names.add(memberName);
    }
    enrichedMembers.set(String(document.council_id), names);
  }
}

for (const meeting of meetings.filter((item) => String(item.name ?? "").includes("委員会"))) {
  const councilId = Number(meeting.council_id);
  const groups = new Map();
  for (const segment of segmentsByCouncil.get(councilId) ?? []) {
    if (segment.speaker_role !== "質問" || segment.is_procedural) continue;
    const memberName = resolveMember(segment.member_name ?? segment.speaker);
    if (!memberName) continue;
    const current = groups.get(memberName) ?? [];
    current.push(segment);
    groups.set(memberName, current);
  }
  for (const [memberName, segments] of groups) {
    const text = segments.map((segment) => segment.text ?? segment.excerpt ?? "").join(" ");
    const accepted = enrichedMembers.get(String(councilId))?.has(memberName)
      || /(?:質問|質疑)(?:を|させて|いたし)|お伺い|お聞かせ|御説明いただ/u.test(text);
    if (!accepted) continue;
    const evidence = segments.filter((segment) => !isRoleTurn(segment));
    const block = {
      councilId,
      scheduleId: null,
      blockId: "committee",
      kind: "committee_question",
      memberName,
      minuteIds: uniqueNumbers(evidence.flatMap((segment) => segment.source?.minute_ids ?? [])),
    };
    const recordId = `${city}:official:${councilId}:${block.kind}:${block.blockId}:${memberName}`;
    expectedById.set(recordId, { ...block, recordId, evidenceSegmentIds: evidence.map((segment) => segment.id) });
  }
}

const actualOfficialIds = new Set(
  [...actualById].filter(([, record]) => record.source_status === "official").map(([recordId]) => recordId)
);
if (expectedById.size > 0 && actualOfficialIds.size === 0) {
  errors.push(`discoverable official activity exists (${expectedById.size}) but output has no official records`);
}
for (const [recordId, expected] of expectedById) {
  const actual = actualById.get(recordId);
  if (!actual) {
    errors.push(`expected activity record is missing: ${recordId}`);
    continue;
  }
  if (!sameValues(actual.evidence_minute_ids ?? [], expected.minuteIds)) {
    errors.push(`${recordId}: evidence_minute_ids do not match raw question turns`);
  }
  if (!sameValues(actual.evidence_segment_ids ?? [], expected.evidenceSegmentIds)) {
    errors.push(`${recordId}: evidence_segment_ids do not match raw question turns`);
  }
}
for (const recordId of actualOfficialIds) {
  if (!expectedById.has(recordId)) {
    errors.push(`activity has no authoritative raw question evidence: ${recordId}`);
  }
}

const sessionsIndex = readJson(path.join(dataDir, "sessions", "index.json"), []);
for (const indexEntry of Array.isArray(sessionsIndex) ? sessionsIndex : []) {
  const session = readJson(path.join(dataDir, "sessions", `${indexEntry.id}.json`), null);
  if (!session) continue;
  for (const segment of session.segments ?? []) {
    const memberName = resolveMember(segment.detail?.speaker ?? segment.label);
    if (!memberName) continue;
    const evidenceId = `session:${session.id}:${segment.index}`;
    const found = [...actualById.values()].some((record) =>
      record.memberName === memberName && (record.evidence_segment_ids ?? []).includes(evidenceId)
    );
    if (!found) errors.push(`${memberName}: video segment ${evidenceId} is missing from activity`);
  }
}

if (city === "chitose") {
  const official = [...actualById.values()].filter((record) => record.source_status === "official");
  const preliminary = [...actualById.values()].filter((record) => record.source_status === "preliminary");
  const expectedKinds = {
    general_question: 192,
    representative_question: 17,
    committee_question: 135,
    plenary_question: 16,
  };
  if (sessionCount !== 373 || official.length !== 360 || preliminary.length !== 13) {
    errors.push(`chitose regression count: expected 373 = 360 official + 13 preliminary, got ${sessionCount} = ${official.length} + ${preliminary.length}`);
  }
  for (const [kind, expected] of Object.entries(expectedKinds)) {
    const actual = official.filter((record) => record.question_kind === kind).length;
    if (actual !== expected) errors.push(`chitose ${kind}: expected ${expected}, got ${actual}`);
  }

  const expectedMemberCounts = new Map(Object.entries({
    松倉美加: 15, 今井ひろみ: 5, 小川陽平: 5, 佐々木昭: 7, 相沢晶子: 28,
    北山敬太: 28, 吉谷徹: 43, 渡部謙太郎: 19, 北原偉男: 19, 岩満順郎: 23,
    大山益巳: 13, 今野正恵: 18, 平川美由紀: 19, 宮原伸哉: 17, 仲山正人: 18,
    山口康弘: 13, 山崎昌則: 11, 佐々木雅宏: 7, 古川昌俊: 8, 落野章一: 26,
    丸岡伸幸: 21, 坂野智: 5, 梅尾要一: 5,
  }));
  for (const [memberName, expected] of expectedMemberCounts) {
    const actual = activity[memberName]?.sessions?.length ?? 0;
    if (actual !== expected) errors.push(`${memberName}: expected ${expected} records, got ${actual}`);
  }

  const splitCases = [
    [557, "松倉美加"], [557, "北山敬太"], [557, "吉谷徹"],
    [526, "吉谷徹"], [522, "吉谷徹"], [504, "吉谷徹"],
  ];
  for (const [councilId, memberName] of splitCases) {
    const kinds = new Set(official
      .filter((record) => record.council_id === councilId && record.memberName === memberName)
      .map((record) => record.question_kind));
    if (!kinds.has("general_question") || !kinds.has("plenary_question")) {
      errors.push(`${councilId}/${memberName}: general and plenary records are not split`);
    }
  }

  if (official.some((record) => record.council_id === 546 && record.memberName === "北山敬太")) {
    errors.push("chitose 546 北山敬太 false positive remains");
  }
  const forbiddenEvidence = new Set(`
    chitose-560-7-699 chitose-546-7-062 chitose-546-7-064 chitose-546-7-066
    chitose-545-7-752 chitose-495-2-013 chitose-580-7-630 chitose-571-6-590
    chitose-571-6-591 chitose-560-7-697 chitose-554-6-469 chitose-545-7-750
    chitose-538-6-428 chitose-525-7-452 chitose-525-7-453 chitose-518-6-479
    chitose-513-7-516 chitose-504-2-016 chitose-497-6-554 chitose-489-7-664
    chitose-580-7-631 chitose-567-2-004 chitose-567-2-010 chitose-567-2-011
    chitose-567-2-013 chitose-531-4-033 chitose-526-8-105
  `.trim().split(/\s+/));
  for (const record of official) {
    for (const evidenceId of record.evidence_segment_ids ?? []) {
      if (forbiddenEvidence.has(evidenceId)) {
        errors.push(`${record.record_id}: forbidden non-question evidence ${evidenceId}`);
      }
    }
  }

  const sasakiEvidence = new Set(official
    .filter((record) => record.memberName === "佐々木雅宏")
    .flatMap((record) => record.evidence_segment_ids ?? []));
  for (const evidenceId of ["chitose-500-7-089", "chitose-526-4-018", "chitose-526-4-020"]) {
    if (!sasakiEvidence.has(evidenceId)) errors.push(`佐々木雅宏: inherited-name evidence is missing: ${evidenceId}`);
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(`error: ${error}`);
  process.exit(1);
}

console.log(
  `ok ${city}: ${Object.keys(activity).length} members / ${sessionCount} records / ${actualById.size} unique record ids / ${expectedById.size} expected official records / ${declaredEndings.length} declared personal endings`
);
