import fs from "fs";
import path from "path";
import type { Member } from "@/types/member";
import MemberList from "@/components/MemberList";

function getMembers(): Member[] {
  const filePath = path.join(process.cwd(), "data", "chitose", "members.json");
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as Member[];
}

export default function ChitoseMembersPage() {
  const members = getMembers();
  const factions = [...new Set(members.map((m) => m.faction).filter(Boolean))];

  return <MemberList members={members} factions={factions} />;
}
