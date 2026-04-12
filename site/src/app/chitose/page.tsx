import fs from "fs";
import path from "path";
import type { Metadata } from "next";
import type { Member, MemberActivity } from "@/types/member";
import type { ComprehensivePlan } from "@/types/comprehensivePlan";
import type { PolicyTag } from "@/lib/planUtils";
import { matchPoliciesToMember } from "@/lib/planUtils";
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
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as Member[];
}

function getMemberActivity(): Record<string, MemberActivity> {
  try {
    const fp = path.join(process.cwd(), "data", "chitose", "members_activity.json");
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as Record<string, MemberActivity>;
  } catch {
    return {};
  }
}

function getPlan(): ComprehensivePlan | null {
  try {
    const fp = path.join(process.cwd(), "data", "chitose", "comprehensive_plan.json");
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as ComprehensivePlan;
  } catch {
    return null;
  }
}

export default function ChitoseMembersPage() {
  const members = getMembers();
  const activity = getMemberActivity();
  const factions = [...new Set(members.map((m) => m.faction).filter(Boolean))];
  const plan = getPlan();

  const memberPolicies: Record<string, PolicyTag[]> = {};
  if (plan) {
    for (const [name, act] of Object.entries(activity)) {
      memberPolicies[name] = matchPoliciesToMember(
        act.all_topics ?? [],
        act.themes ?? [],
        plan
      );
    }
  }

  return (
    <MemberList
      members={members}
      factions={factions}
      activity={activity}
      memberHrefBase="/chitose/members"
      memberPolicies={memberPolicies}
    />
  );
}
