"use client";

import { useState } from "react";
import Link from "next/link";
import type { ComprehensivePlan, BasicGoal } from "@/types/comprehensivePlan";
import type { ExcerptItem } from "@/lib/planUtils";

// 基本目標ごとのカラー定義
const GOAL_COLORS: {
  bg: string;
  border: string;
  badgeBg: string;
  badgeText: string;
  barBg: string;
  accent: string;
  light: string;
}[] = [
  { bg: "bg-amber-50",  border: "border-amber-200",  badgeBg: "bg-amber-500",  badgeText: "text-white", barBg: "bg-amber-400",  accent: "text-amber-700",  light: "bg-amber-100"  },
  { bg: "bg-green-50",  border: "border-green-200",  badgeBg: "bg-green-600",  badgeText: "text-white", barBg: "bg-green-500",  accent: "text-green-700",  light: "bg-green-100"  },
  { bg: "bg-red-50",    border: "border-red-200",    badgeBg: "bg-red-500",    badgeText: "text-white", barBg: "bg-red-400",    accent: "text-red-700",    light: "bg-red-100"    },
  { bg: "bg-purple-50", border: "border-purple-200", badgeBg: "bg-purple-600", badgeText: "text-white", barBg: "bg-purple-500", accent: "text-purple-700", light: "bg-purple-100" },
  { bg: "bg-blue-50",   border: "border-blue-200",   badgeBg: "bg-blue-600",   badgeText: "text-white", barBg: "bg-blue-500",   accent: "text-blue-700",   light: "bg-blue-100"   },
  { bg: "bg-slate-50",  border: "border-slate-200",  badgeBg: "bg-slate-600",  badgeText: "text-white", barBg: "bg-slate-500",  accent: "text-slate-700",  light: "bg-slate-100"  },
  { bg: "bg-teal-50",   border: "border-teal-200",   badgeBg: "bg-teal-600",   badgeText: "text-white", barBg: "bg-teal-500",   accent: "text-teal-700",   light: "bg-teal-100"   },
];

// 基本目標の合計議論頻度を計算
function goalTotalCount(goal: BasicGoal, counts: Record<number, number>): number {
  return goal.policies.reduce((s, p) => s + (counts[p.id] ?? 0), 0);
}

// ---------- 議論頻度バーチャート ----------
function DiscussionChart({
  plan,
  counts,
}: {
  plan: ComprehensivePlan;
  counts: Record<number, number>;
}) {
  const goalCounts = plan.basic_goals.map((g) => goalTotalCount(g, counts));
  const max = Math.max(...goalCounts, 1);

  return (
    <div className="bg-white rounded-lg border border-[#CBD5E0] shadow-sm px-6 py-5 mb-8">
      <p className="text-xs font-semibold text-[#4A5568] uppercase tracking-wide mb-4">
        議事録での議論頻度（基本目標別・延べ件数）
      </p>
      <div className="space-y-2.5">
        {plan.basic_goals.map((goal, i) => {
          const color = GOAL_COLORS[i];
          const count = goalCounts[i];
          const pct = Math.round((count / max) * 100);
          return (
            <div key={goal.id} className="flex items-center gap-3">
              {/* 番号 */}
              <span
                className={`shrink-0 w-6 h-6 rounded-full ${color.badgeBg} ${color.badgeText} text-xs font-bold flex items-center justify-center`}
              >
                {goal.id}
              </span>
              {/* ラベル */}
              <span className="text-xs text-[#4A5568] w-40 shrink-0 truncate" title={goal.title}>
                {goal.title}
              </span>
              {/* バー */}
              <div className="flex-1 h-4 bg-[#F4F6F9] rounded-full overflow-hidden">
                <div
                  className={`h-full ${color.barBg} rounded-full transition-all duration-500`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {/* 数値 */}
              <span className="text-xs font-mono text-[#718096] w-8 text-right shrink-0">
                {count}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-[#A0AEC0] mt-3">
        ※ 収録済み議事録 {Object.keys(counts).length > 0 ? "での" : ""}キーワードマッチ件数
      </p>
    </div>
  );
}

// ---------- 施策行（抜粋トグル付き） ----------
function PolicyRow({
  policy,
  cnt,
  excerpts,
  color,
}: {
  policy: { id: number; title: string };
  cnt: number;
  excerpts: ExcerptItem[];
  color: (typeof GOAL_COLORS)[0];
}) {
  const [excerptOpen, setExcerptOpen] = useState(false);
  const searchQ = encodeURIComponent(
    `千歳市議会での「${policy.title}」に関する議論を教えてください`
  );

  return (
    <li className="group">
      <div className="flex items-start gap-3">
        {/* 施策番号 */}
        <span className="shrink-0 text-xs font-mono text-[#A0AEC0] pt-0.5 w-6 text-right">
          {policy.id}
        </span>
        {/* 施策名（抜粋があればクリック可能） */}
        {excerpts.length > 0 ? (
          <button
            onClick={() => setExcerptOpen((v) => !v)}
            className="flex-1 text-left text-sm text-[#2D3748] hover:text-[#1B3A6B] transition-colors"
          >
            {policy.title}
            <svg
              className={`inline-block ml-1 w-3 h-3 text-[#A0AEC0] transition-transform ${excerptOpen ? "rotate-180" : ""}`}
              viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        ) : (
          <span className="flex-1 text-sm text-[#2D3748]">{policy.title}</span>
        )}
        {/* 件数バッジ */}
        {cnt > 0 && (
          <span className={`shrink-0 text-xs px-1.5 py-0.5 rounded ${color.light} ${color.accent} font-medium`}>
            {cnt}件
          </span>
        )}
        {/* AI検索リンク */}
        <Link
          href={`/ai-search?q=${searchQ}`}
          className="shrink-0 text-xs text-[#2A5298] hover:text-[#1B3A6B] opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5"
          title="AI検索で議論を調べる"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          AI
        </Link>
      </div>

      {/* 議事録抜粋 */}
      {excerptOpen && excerpts.length > 0 && (
        <div className="ml-9 mt-2 space-y-2">
          {excerpts.map((ex, i) => (
            <div key={i} className="bg-[#F4F6F9] border border-[#E2E8F0] rounded-lg px-3 py-2">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-xs font-medium text-[#2A5298]">{ex.sessionName}</span>
                {ex.speakerName && (
                  <span className="text-xs text-[#718096]">{ex.speakerName}</span>
                )}
                <Link
                  href={`/chitose/minutes/${ex.councilId}`}
                  className="text-xs text-[#2A5298] hover:text-[#1B3A6B] flex items-center gap-0.5 ml-auto shrink-0 transition-colors"
                >
                  全文
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24"
                    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </Link>
              </div>
              <p className="text-xs text-[#4A5568] leading-relaxed">{ex.text}</p>
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

// ---------- 基本目標カード ----------
function GoalCard({
  goal,
  index,
  counts,
  excerpts,
}: {
  goal: BasicGoal;
  index: number;
  counts: Record<number, number>;
  excerpts: Record<number, ExcerptItem[]>;
}) {
  const [open, setOpen] = useState(false);
  const color = GOAL_COLORS[index] ?? GOAL_COLORS[0];
  const total = goalTotalCount(goal, counts);

  return (
    <div className={`rounded-lg border ${color.border} ${color.bg} overflow-hidden shadow-sm`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-5 py-4 flex items-start gap-4 hover:brightness-95 transition-all"
        aria-expanded={open}
      >
        <span className={`shrink-0 w-8 h-8 rounded-full ${color.badgeBg} ${color.badgeText} text-sm font-bold flex items-center justify-center mt-0.5`}>
          {goal.id}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#1A202C] leading-snug">{goal.title}</p>
          <div className="flex items-center gap-3 mt-1">
            <span className={`text-xs ${color.accent}`}>{goal.policies.length}施策</span>
            {total > 0 && (
              <span className="text-xs text-[#718096]">
                議事録での言及 <span className="font-semibold text-[#4A5568]">{total}</span> 件
              </span>
            )}
          </div>
        </div>
        <svg
          className={`shrink-0 w-4 h-4 text-[#718096] transition-transform mt-1 ${open ? "rotate-180" : ""}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-inherit bg-white px-5 py-4">
          <ol className="space-y-3">
            {goal.policies.map((policy) => (
              <PolicyRow
                key={policy.id}
                policy={policy}
                cnt={counts[policy.id] ?? 0}
                excerpts={excerpts[policy.id] ?? []}
                color={color}
              />
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

// ---------- メインコンポーネント ----------
export default function ComprehensivePlanClient({
  plan,
  discussionCounts,
  policyExcerpts,
}: {
  plan: ComprehensivePlan;
  discussionCounts: Record<number, number>;
  policyExcerpts: Record<number, ExcerptItem[]>;
}) {
  const totalPolicies = plan.basic_goals.reduce((s, g) => s + g.policies.length, 0);
  const totalDiscussions = Object.values(discussionCounts).reduce((s, v) => s + v, 0);

  return (
    <div>
      {/* ヘッダーカード */}
      <div className="bg-white rounded-lg border border-[#CBD5E0] shadow-sm px-6 py-5 mb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-[#2A5298] uppercase tracking-wide mb-1">
              {plan.name}
            </p>
            <h2 className="text-xl font-bold text-[#1B3A6B] leading-snug">
              「{plan.future_vision}」
            </h2>
          </div>
          <span className="shrink-0 text-sm text-[#718096] bg-[#F4F6F9] border border-[#E2E8F0] rounded px-3 py-1">
            {plan.period.start}〜{plan.period.end}年度
          </span>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          {[
            { value: 7, label: "基本目標" },
            { value: totalPolicies, label: "施策" },
            { value: totalDiscussions, label: "議事録での言及" },
          ].map(({ value, label }) => (
            <div
              key={label}
              className="text-center bg-[#F4F6F9] border border-[#E2E8F0] rounded-lg px-4 py-3 min-w-[88px]"
            >
              <p className="text-2xl font-bold text-[#1B3A6B]">{value}</p>
              <p className="text-xs text-[#718096] mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 議論頻度バーチャート */}
      <DiscussionChart plan={plan} counts={discussionCounts} />

      {/* 基本目標一覧 */}
      <h3 className="text-sm font-semibold text-[#4A5568] uppercase tracking-wide mb-3">
        基本目標と施策
        <span className="ml-2 text-xs font-normal text-[#A0AEC0] normal-case">
          — 各施策にカーソルを当てるとAI検索リンクが表示されます
        </span>
      </h3>
      <div className="space-y-3 mb-10">
        {plan.basic_goals.map((goal, i) => (
          <GoalCard
            key={goal.id}
            goal={goal}
            index={i}
            counts={discussionCounts}
            excerpts={policyExcerpts}
          />
        ))}
      </div>

      {/* 人口ビジョン */}
      <h3 className="text-sm font-semibold text-[#4A5568] uppercase tracking-wide mb-3">
        人口ビジョン・人口戦略プロジェクト
      </h3>
      <div className="bg-white rounded-lg border border-[#CBD5E0] shadow-sm px-6 py-5">
        <p className="text-sm font-semibold text-[#1B3A6B] mb-0.5">
          {plan.population_vision.name}
        </p>
        <p className="text-xs text-[#718096] mb-5">{plan.population_vision.note}</p>

        {/* 3つの基本戦略 */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          {plan.population_vision.basic_strategies.map((s) => (
            <div
              key={s.id}
              className="relative bg-[#F4F6F9] border border-[#E2E8F0] rounded-lg px-4 py-3"
            >
              <span className="absolute -top-2 left-3 text-xs font-bold text-white bg-[#2A5298] rounded-full px-2 py-0.5">
                戦略{s.id}
              </span>
              <p className="text-sm font-semibold text-[#1A202C] mt-1">{s.title}</p>
            </div>
          ))}
        </div>

        {/* 7つの重点プロジェクト */}
        <p className="text-xs font-semibold text-[#4A5568] mb-3">重点プロジェクト</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {plan.population_vision.projects.map((p) => {
            const searchQ = encodeURIComponent(
              `千歳市議会での「${p.title}」に関する取り組みや議論を教えてください`
            );
            return (
              <div
                key={p.id}
                className="flex items-center justify-between gap-2 bg-[#E8EEF7] border border-[#C5D0E6] rounded-lg px-3 py-2.5"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="shrink-0 text-xs font-bold text-white bg-[#1B3A6B] rounded-full w-5 h-5 flex items-center justify-center">
                    {p.id}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[#1A202C] truncate">{p.title}</p>
                    <p className="text-xs text-[#718096]">{p.theme}</p>
                  </div>
                </div>
                <Link
                  href={`/ai-search?q=${searchQ}`}
                  className="shrink-0 text-xs text-[#2A5298] hover:text-[#1B3A6B] flex items-center gap-0.5 transition-colors"
                  title="AI検索で議論を調べる"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="w-3.5 h-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  AI
                </Link>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
