import fs from "fs";
import path from "path";
import type { Metadata } from "next";
import type { Member, MemberActivity } from "@/types/member";
import MemberList from "@/components/MemberList";
import CitySummaryCards from "@/components/CitySummaryCards";
import { getMinutesSummary } from "@/lib/cityStats";
import { getMunicipality } from "@/lib/municipalities";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string }>;
}): Promise<Metadata> {
  const { city } = await params;
  const municipality = getMunicipality(city);
  const name = municipality?.council_name ?? "市議会";
  return {
    title: name,
    description: `${name}の議員一覧・議事録を掲載しています。`,
    openGraph: {
      title: `${name} | 北海道議会情報マップ`,
      description: `${name}の議員一覧・議事録を掲載しています。`,
    },
  };
}

function getMembers(city: string): Member[] {
  try {
    const fp = path.join(process.cwd(), "data", city, "members.json");
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as Member[];
  } catch {
    return [];
  }
}

function getMemberActivity(city: string): Record<string, MemberActivity> {
  try {
    const fp = path.join(process.cwd(), "data", city, "members_activity.json");
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as Record<string, MemberActivity>;
  } catch {
    return {};
  }
}

export default async function CityMembersPage({
  params,
}: {
  params: Promise<{ city: string }>;
}) {
  const { city } = await params;
  const members = getMembers(city);
  const activity = getMemberActivity(city);
  const factions = [...new Set(members.map((m) => m.faction).filter(Boolean))];
  const { count: minutesCount, latestYear } = getMinutesSummary(city);

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
            <p className="text-base text-[#4A5568] leading-relaxed">議員情報は準備中です。</p>
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
        memberCount={members.length}
        minutesCount={minutesCount}
        latestYear={latestYear}
      />
      <MemberList
        members={members}
        factions={factions}
        activity={activity}
        memberHrefBase={`/${city}/members`}
        minutesHrefBase={`/${city}/minutes`}
      />
    </>
  );
}
