import fs from "fs";
import path from "path";
import type { Metadata } from "next";
import type { Member, MemberActivity } from "@/types/member";
import MemberList from "@/components/MemberList";
import CitySummaryCards from "@/components/CitySummaryCards";
import { getMinutesSummary } from "@/lib/cityStats";

export const metadata: Metadata = {
  title: "苫小牧市議会",
  description: "苫小牧市議会の議員一覧・議事録・議決結果を掲載しています。",
  openGraph: {
    title: "苫小牧市議会 | 北海道議会情報マップ",
    description: "苫小牧市議会の議員一覧・議事録・議決結果を掲載しています。",
  },
};

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
    const fp = path.join(process.cwd(), "data", "tomakomai", "members.json");
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as Member[];
  } catch {
    // なければ election.json の当選者から生成
    const fp = path.join(process.cwd(), "data", "tomakomai", "election.json");
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

function getMemberActivity(): Record<string, MemberActivity> {
  try {
    const fp = path.join(process.cwd(), "data", "tomakomai", "members_activity.json");
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as Record<string, MemberActivity>;
  } catch {
    return {};
  }
}

export default function TomakomaiMembersPage() {
  const members = getMembers();
  const activity = getMemberActivity();
  const factions = [...new Set(members.map((m) => m.faction).filter(Boolean))];
  const { count: minutesCount, latestYear } = getMinutesSummary("tomakomai");

  return (
    <>
      <CitySummaryCards
        memberCount={members.length > 0 ? members.length : null}
        minutesCount={minutesCount}
        latestYear={latestYear}
      />
      <MemberList members={members} factions={factions} activity={activity} memberHrefBase="/tomakomai/members" />
    </>
  );
}
