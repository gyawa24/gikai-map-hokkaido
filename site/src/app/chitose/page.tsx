import fs from "fs";
import path from "path";
import type { Member, MemberActivity } from "@/types/member";
import MemberList from "@/components/MemberList";

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

  return <MemberList members={members} factions={factions} activity={activity} />;
}
