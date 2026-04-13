import fs from "fs";
import path from "path";
import Link from "next/link";
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
  election_name?: string;
  candidates: ElectionCandidate[];
};

function getElectionName(): string {
  try {
    const fp = path.join(process.cwd(), "data", "tomakomai", "election.json");
    const data = JSON.parse(fs.readFileSync(fp, "utf-8")) as ElectionData;
    return data.election_name ?? "苫小牧市議会議員一般選挙";
  } catch {
    return "苫小牧市議会議員一般選挙";
  }
}

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
  const electionName = getElectionName();

  return (
    <>
      <CitySummaryCards
        memberCount={members.length > 0 ? members.length : null}
        minutesCount={minutesCount}
        latestYear={latestYear}
      />
      {/* 選挙結果リンクカード */}
      <div className="mb-6">
        <Link
          href="/tomakomai/election"
          className="block bg-white rounded-lg border border-[#CBD5E0] hover:border-[#1B3A6B] shadow-sm hover:shadow-md transition-all duration-150 p-5"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="w-5 h-5 text-[#2A5298]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="9 11 12 14 22 4" />
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </svg>
              <div>
                <p className="text-base font-bold text-[#1A202C]">選挙結果</p>
                <p className="text-sm text-[#718096] mt-0.5">{electionName}</p>
              </div>
            </div>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-5 h-5 text-[#CBD5E0]"
              aria-hidden="true"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </div>
        </Link>
      </div>
      <MemberList members={members} factions={factions} activity={activity} memberHrefBase="/tomakomai/members" />
    </>
  );
}
