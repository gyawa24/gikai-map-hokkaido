export function formatMeetingDate(value: string): string {
  const dashed = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dashed) {
    return `${Number(dashed[1])}年${Number(dashed[2])}月${Number(dashed[3])}日`;
  }

  return value;
}
