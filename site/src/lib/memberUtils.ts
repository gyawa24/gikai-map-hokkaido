import type { Member } from "@/types/member";

/**
 * detail.speaker の姓部分を抽出し、members.json から正しい会派を解決して返す。
 * "〇〇議員（...）" → "〇〇議員（{正しい会派}）"
 * 一致するメンバーが0件または複数件の場合は元の文字列をそのまま返す。
 */
export function resolveSpeaker(speaker: string, members: Member[]): string {
  if (members.length === 0) return speaker;

  const m = speaker.match(/^(.+?)(議員|委員)/);
  if (!m) return speaker;

  const surname = m[1];
  const role = m[2];

  const matched = members.filter((mb) =>
    mb.name.replace(/\s/g, "").startsWith(surname)
  );
  if (matched.length !== 1) return speaker;

  return `${surname}${role}（${matched[0].faction}）`;
}
