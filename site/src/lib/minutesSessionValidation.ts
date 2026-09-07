import type { MinutesSession } from "@/types/minutes";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// 同じ公開台帳にある会議だけを読み、形式不正を「未掲載」に変換しない。
export function isMinutesSession(value: unknown, councilId: string | number): value is MinutesSession {
  if (!record(value) || String(value.council_id) !== String(councilId)
    || !["name", "year", "japanese_year", "type_label"].every((key) => typeof value[key] === "string")
    || !Array.isArray(value.schedules)) return false;
  const scheduleIds = new Set<number>();
  return value.schedules.every((schedule) => {
    if (!record(schedule) || !Number.isSafeInteger(schedule.schedule_id)
      || scheduleIds.has(schedule.schedule_id as number) || typeof schedule.name !== "string"
      || !Array.isArray(schedule.minutes)) return false;
    scheduleIds.add(schedule.schedule_id as number);
    const minuteIds = new Set<number>();
    return schedule.minutes.every((minute) => {
      if (!record(minute) || !Number.isSafeInteger(minute.minute_id)
        || minuteIds.has(minute.minute_id as number)
        || !["title", "minute_type", "text"].every((key) => typeof minute[key] === "string")) return false;
      minuteIds.add(minute.minute_id as number);
      return true;
    });
  });
}
