import fs from "fs";
import path from "path";
import type { ComprehensivePlan } from "@/types/comprehensivePlan";
import { extractKeywords, computePolicyExcerpts } from "@/lib/planUtils";
import type { ExcerptItem } from "@/lib/planUtils";
import ComprehensivePlanClient from "@/components/ComprehensivePlanClient";

function getPlan(): ComprehensivePlan {
  const filePath = path.join(process.cwd(), "data", "chitose", "comprehensive_plan.json");
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as ComprehensivePlan;
}

function loadMinutesFiles() {
  const minutesDir = path.join(process.cwd(), "data", "chitose", "minutes");
  const files = fs.readdirSync(minutesDir).filter(
    (f) => f.endsWith(".json") && f !== "index.json"
  );
  return files.map((file) => {
    const raw = JSON.parse(fs.readFileSync(path.join(minutesDir, file), "utf-8"));
    return {
      councilId: raw.council_id as number,
      sessionName: (raw.name as string) ?? file,
      data: raw,
    };
  });
}

/** 全議事録をスキャンして施策ごとの言及回数を返す */
function computeDiscussionCounts(
  plan: ComprehensivePlan,
  minutesFiles: { data: unknown }[]
): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const goal of plan.basic_goals)
    for (const policy of goal.policies) counts[policy.id] = 0;

  for (const { data } of minutesFiles) {
    const text = JSON.stringify(data);
    for (const goal of plan.basic_goals) {
      for (const policy of goal.policies) {
        const kws = extractKeywords(policy.title);
        if (kws.some((kw) => text.includes(kw))) counts[policy.id]++;
      }
    }
  }
  return counts;
}

export default function ChitosePlanPage() {
  const plan = getPlan();
  const minutesFiles = loadMinutesFiles();
  const counts = computeDiscussionCounts(plan, minutesFiles);
  const excerpts: Record<number, ExcerptItem[]> = computePolicyExcerpts(plan, minutesFiles);

  return (
    <ComprehensivePlanClient
      plan={plan}
      discussionCounts={counts}
      policyExcerpts={excerpts}
    />
  );
}
