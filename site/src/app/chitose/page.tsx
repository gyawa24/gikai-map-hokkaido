import fs from "fs";
import path from "path";
import type { Metadata } from "next";
import type { Member, MemberActivity } from "@/types/member";
import MemberList from "@/components/MemberList";

export const metadata: Metadata = {
  title: "千歳市議会",
  description: "千歳市議会の議員一覧・議事録・議決結果を掲載しています。",
  openGraph: {
    title: "千歳市議会 | 北海道議会情報マップ",
    description: "千歳市議会の議員一覧・議事録・議決結果を掲載しています。",
  },
};

function getMembers(): Member[] {
  const filePath = path.join(process.cwd(), "data", "chitose", "members.json");
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as Member[];
}

function getMemberActivity(): Record<string, MemberActivity> {
  try {
    const fp = path.join(process.cwd(), "data", "chitose", "members_activity.json");
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as Record<string, MemberActivity>;
  } catch {
    return {};
  }
}

export default function ChitoseMembersPage() {
  const members = getMembers();
  const activity = getMemberActivity();
  const factions = [...new Set(members.map((m) => m.faction).filter(Boolean))];

  return <MemberList members={members} factions={factions} activity={activity} memberHrefBase="/chitose/members" />;
}
