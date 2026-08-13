import type { MinuteItem, MinutesEnriched, MinutesSession } from "@/types/minutes";

function contentMinutes(session: MinutesSession): MinuteItem[] {
  return session.schedules.flatMap((schedule) =>
    schedule.minutes.filter((minute) => minute.minute_type !== "名簿")
  );
}

export function claimsMinutesBodyIsMissing(
  enriched: MinutesEnriched | null
): boolean {
  if (!enriched) return false;
  return /本文(?:データ)?(?:が|は)?[^。]{0,40}(?:含まれていない|収録されていない|取得できていない)/u.test(
    enriched.summary
  );
}

export function countMinutesContent(session: MinutesSession): number {
  return contentMinutes(session).length;
}

export function isWholeDayTranscriptSession(session: MinutesSession): boolean {
  return (
    session.schedules.length > 0 &&
    session.schedules.every((schedule) => {
      const minutes = schedule.minutes.filter((minute) => minute.minute_type !== "名簿");
      return minutes.length === 1 && minutes[0].minute_type === "本会議";
    })
  );
}

export function minutesContentLabel(session: MinutesSession): string {
  if (isWholeDayTranscriptSession(session)) {
    return `${session.schedules.length}日分の会議録`;
  }
  return `${countMinutesContent(session)}件の発言・議題`;
}

export function visibleMinutesEnriched(
  session: MinutesSession,
  enriched: MinutesEnriched | null
): MinutesEnriched | null {
  if (!enriched || !isWholeDayTranscriptSession(session)) return enriched;

  if (claimsMinutesBodyIsMissing(enriched)) return null;

  const contentCount = countMinutesContent(session);
  const recognizedSpeechCount = enriched.speakers.reduce(
    (total, speaker) => total + speaker.speech_count,
    0
  );
  const onlyWrapperSpeakers = enriched.speakers.every(
    (speaker) => speaker.role === "その他"
  );

  // 1日分の本文を1レコードで持つ会議録で、enriched 側もその日別レコードしか
  // 認識できていない場合は、本文に基づく要約・人物抽出とは扱わない。
  if (
    enriched.questioners.length === 0 &&
    onlyWrapperSpeakers &&
    recognizedSpeechCount <= contentCount
  ) {
    return null;
  }

  return enriched;
}
