import fs from "fs";
import path from "path";
import type { Member } from "@/types/member";
import MemberList from "@/components/MemberList";

type ElectionCandidate = {
  name: string;
  furigana: string;
  party?: string;
  votes?: number;
  result: string;
  status: string;
};

type ElectionData = {
  candidates: ElectionCandidate[];
};

function getMembers(): Member[] {
  // members.json があれば優先使用
  try {
    const fp = path.join(process.cwd(), "data", "eniwa", "members.json");
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as Member[];
  } catch {
    // なければ election.json の当選者から生成
    const fp = path.join(process.cwd(), "data", "eniwa", "election.json");
    const data = JSON.parse(fs.readFileSync(fp, "utf-8")) as ElectionData;
    return data.candidates
      .filter((c) => c.result === "当選")
      .map((c, i) => ({
        seat_number: i + 1,
        name: c.name,
        furigana: c.furigana,
        party: c.party,
        faction: c.party ?? "",
        committees: [],
        votes: c.votes,
      }));
  }
}

export default function EniwaMembersPage() {
  const members = getMembers();
  const factions = [...new Set(members.map((m) => m.faction).filter(Boolean))];

  return <MemberList members={members} factions={factions} memberHrefBase="/eniwa/members" />;
}
