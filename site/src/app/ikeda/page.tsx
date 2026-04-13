import fs from "fs";
import path from "path";
import type { Metadata } from "next";
import type { Member } from "@/types/member";
import MemberList from "@/components/MemberList";
import CitySummaryCards from "@/components/CitySummaryCards";
import { getMinutesSummary } from "@/lib/cityStats";

export const metadata: Metadata = {
  title: "池田町議会",
  description: "池田町議会の議員一覧・議事録を掲載しています。",
  openGraph: {
    title: "池田町議会 | 北海道議会情報マップ",
    description: "池田町議会の議員一覧・議事録を掲載しています。",
  },
};

function getMembers(): Member[] {
  try {
    const fp = path.join(process.cwd(), "data", "ikeda", "members.json");
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as Member[];
  } catch {
    return [];
  }
}

export default function IkedaMembersPage() {
  const members = getMembers();
  const factions = [...new Set(members.map((m) => m.faction).filter(Boolean))];
  const { count: minutesCount, latestYear } = getMinutesSummary("ikeda");

  if (members.length === 0) {
    return (
      <>
        <CitySummaryCards
          memberCount={null}
          minutesCount={minutesCount}
          latestYear={latestYear}
        />
        <div className="max-w-2xl mx-auto">
          <section className="mb-6">
            <h2 className="text-xl font-bold text-[#1B3A6B] mb-1">議員一覧</h2>
            <p className="text-base text-[#4A5568] leading-relaxed">池田町議会の議員情報です。</p>
          </section>
          <div className="bg-white rounded-lg border border-[#CBD5E0] p-8 text-center text-[#718096]">
            現在、議員情報は掲載されていません。
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <CitySummaryCards
        memberCount={members.length > 0 ? members.length : null}
        minutesCount={minutesCount}
        latestYear={latestYear}
      />
      <MemberList members={members} factions={factions} activity={{}} memberHrefBase="/ikeda/members" />
    </>
  );
}
