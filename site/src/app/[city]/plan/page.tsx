import fs from "fs";
import path from "path";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { hasCityCapability } from "@/lib/cityCapabilities";
import { getMunicipality } from "@/lib/municipalities";
import { buildPageMetadata } from "@/lib/metadata";
import { getCapabilityCityStaticParams } from "@/lib/staticCityParams";

export const dynamicParams = false;

export function generateStaticParams() {
  return getCapabilityCityStaticParams("plan");
}

type Policy = { id: number; title: string };
type BasicGoal = { id: number; title: string; policies: Policy[] };
type BasicStrategy = { id: number; title: string };
type Project = { id: number; title: string; theme: string };
type PopulationVision = {
  name: string;
  period: { start: string; end: string };
  note?: string;
  basic_strategies: BasicStrategy[];
  projects: Project[];
};
type ComprehensivePlan = {
  name: string;
  future_vision: string;
  period: { start: number; end: number };
  basic_goals: BasicGoal[];
  population_vision?: PopulationVision;
};

type GoalActivity = {
  member_count: number;
  topic_count: number;
  topics: { topic: string; member: string }[];
};
type PlanActivity = {
  goals: Record<string, GoalActivity>;
};

function getPlan(city: string): ComprehensivePlan | null {
  const fp = path.join(process.cwd(), "data", city, "comprehensive_plan.json");
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as ComprehensivePlan;
  } catch {
    return null;
  }
}

function getPlanActivity(city: string): PlanActivity | null {
  const fp = path.join(process.cwd(), "data", city, "plan_activity.json");
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as PlanActivity;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string }>;
}): Promise<Metadata> {
  const { city } = await params;
  const municipality = getMunicipality(city);
  const cityName = municipality?.name ?? city;
  return buildPageMetadata({
    title: `総合計画 - ${cityName}議会`,
    description: `${cityName}の総合計画・基本目標と施策一覧を、議会での議論とあわせて確認できます。`,
    path: `/${city}/plan`,
  });
}

export default async function CityPlanPage({
  params,
}: {
  params: Promise<{ city: string }>;
}) {
  const { city } = await params;
  const municipality = getMunicipality(city);
  if (!municipality || !hasCityCapability(city, "plan")) notFound();

  const plan = getPlan(city);
  if (!plan) notFound();

  const activity = getPlanActivity(city);
  const cityName = municipality.name;

  return (
    <div className="max-w-2xl mx-auto">
      {/* ヘッダー */}
      <section className="mb-6">
        <h2 className="text-xl font-bold text-[#1B3A6B] mb-1">総合計画</h2>
        <p className="text-base text-[#4A5568] leading-relaxed">
          {cityName}の将来像と基本目標・施策の一覧です。
        </p>
      </section>

      {/* 計画カード */}
      <div className="bg-white rounded-lg border border-[#CBD5E0] shadow-sm p-6 mb-5">
        <p className="text-xs font-medium text-[#718096] mb-1">{plan.period.start}年〜{plan.period.end}年</p>
        <h3 className="text-lg font-bold text-[#1A202C] mb-3">{plan.name}</h3>
        <div className="bg-[#E8EEF7] rounded-lg px-5 py-4">
          <p className="text-xs font-medium text-[#718096] mb-1">将来像</p>
          <p className="text-base font-bold text-[#1B3A6B] leading-snug">{plan.future_vision}</p>
        </div>
      </div>

      {/* 基本目標 */}
      <section className="mb-6">
        <h3 className="text-sm font-semibold text-[#718096] uppercase tracking-wider mb-3">
          基本目標と施策
        </h3>
        <div className="flex flex-col gap-3">
          {plan.basic_goals.map((goal) => {
            const searchQ = encodeURIComponent(goal.title);
            return (
              <details
                key={goal.id}
                className="group bg-white rounded-lg border border-[#CBD5E0] shadow-sm overflow-hidden"
              >
                <summary className="flex items-center gap-3 px-5 py-4 cursor-pointer select-none hover:bg-[#F4F6F9] transition-colors list-none">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-[#E8EEF7] text-[#2A5298] text-xs font-bold flex items-center justify-center">
                    {goal.id}
                  </span>
                  <span className="flex-1 text-sm font-semibold text-[#1A202C] leading-snug">
                    {goal.title}
                  </span>
                  <span className="text-xs text-[#718096] shrink-0">{goal.policies.length}施策</span>
                  {activity?.goals[String(goal.id)] && activity.goals[String(goal.id)].topic_count > 0 && (
                    <span className="text-[10px] font-medium bg-[#1B3A6B] text-white rounded-full px-2 py-0.5 shrink-0">
                      質問{activity.goals[String(goal.id)].topic_count}件
                    </span>
                  )}
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="w-4 h-4 text-[#A0AEC0] shrink-0 transition-transform group-open:rotate-90"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </summary>
                <div className="px-5 pb-4">
                  <ul className="space-y-1.5 mb-3">
                    {goal.policies.map((p) => (
                      <li key={p.id} className="flex items-start gap-2 text-sm">
                        <span className="text-[#A0AEC0] shrink-0 mt-0.5 text-xs">
                          {p.id}.
                        </span>
                        <span className="text-[#4A5568]">{p.title}</span>
                      </li>
                    ))}
                  </ul>
                  {(() => {
                    const ga = activity?.goals[String(goal.id)];
                    if (!ga || ga.topics.length === 0) return null;
                    return (
                      <div className="mb-3">
                        <p className="text-xs font-medium text-[#718096] mb-1.5">
                          議会での関連質問（{ga.member_count}人の議員が言及）
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {ga.topics.slice(0, 10).map((t) => (
                            <span
                              key={t.topic}
                              className="text-[11px] px-2 py-0.5 bg-[#E8EEF7] text-[#2A5298] rounded"
                              title={`${t.member} 議員`}
                            >
                              {t.topic}
                            </span>
                          ))}
                          {ga.topics.length > 10 && (
                            <span className="text-[11px] px-2 py-0.5 text-[#718096]">
                              ほか{ga.topics.length - 10}件
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                  <Link
                    href={`/search?q=${searchQ}`}
                    className="inline-flex items-center gap-1.5 text-xs text-[#2A5298] hover:text-[#1B3A6B] transition-colors"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                    </svg>
                    この目標に関連する議論を検索
                  </Link>
                </div>
              </details>
            );
          })}
        </div>
      </section>

      {/* 人口ビジョン */}
      {plan.population_vision && (
        <section className="mb-6">
          <h3 className="text-sm font-semibold text-[#718096] uppercase tracking-wider mb-3">
            人口ビジョン・総合戦略
          </h3>
          <div className="bg-white rounded-lg border border-[#CBD5E0] shadow-sm p-5">
            <p className="text-sm font-bold text-[#1A202C] mb-1">{plan.population_vision.name}</p>
            <p className="text-xs text-[#718096] mb-3">
              {plan.population_vision.period.start.replace("-", "年")}月〜{plan.population_vision.period.end.replace("-", "年")}月
            </p>
            {plan.population_vision.note && (
              <p className="text-xs text-[#4A5568] bg-[#F4F6F9] rounded px-3 py-2 mb-3">
                {plan.population_vision.note}
              </p>
            )}
            <div className="mb-3">
              <p className="text-xs font-medium text-[#718096] mb-2">基本戦略</p>
              <div className="flex flex-wrap gap-2">
                {plan.population_vision.basic_strategies.map((s) => (
                  <span
                    key={s.id}
                    className="text-xs px-2 py-0.5 bg-[#E8EEF7] text-[#2A5298] rounded-full"
                  >
                    {s.title}
                  </span>
                ))}
              </div>
            </div>
            {plan.population_vision.projects.length > 0 && (
              <div>
                <p className="text-xs font-medium text-[#718096] mb-2">プロジェクト</p>
                <div className="flex flex-wrap gap-2">
                  {plan.population_vision.projects.map((p) => (
                    <span
                      key={p.id}
                      className="text-xs px-2 py-0.5 bg-[#F4F6F9] text-[#4A5568] border border-[#E2E8F0] rounded-full"
                    >
                      {p.title}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
