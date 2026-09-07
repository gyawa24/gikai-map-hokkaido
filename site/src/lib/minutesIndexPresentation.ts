import type { MinutesIndexItem } from "@/types/minutes";

function formatDate(value: string | undefined, precision: MinutesIndexItem["date_precision"]): string | null {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (!match) return null;
  const [, year, month, day] = match;
  if (Number(month) < 1 || Number(month) > 12) return null;
  const monthLabel = `${Number(year)}年${Number(month)}月`;
  if (precision === "month" || !day) return monthLabel;
  const daysInMonth = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  if (Number(day) < 1 || Number(day) > daysInMonth) return null;
  return `${monthLabel}${Number(day)}日`;
}

export function minutesDateLabel(item: Pick<MinutesIndexItem, "start_date" | "end_date" | "date_precision">): string {
  const start = formatDate(item.start_date, item.date_precision);
  const end = formatDate(item.end_date, item.date_precision);
  if (start && end) return start === end ? start : `${start}〜${end}`;
  if (start) return `${start}開始（終了日未確認）`;
  if (end) return `${end}終了（開始日未確認）`;
  return "開催日未確認";
}
