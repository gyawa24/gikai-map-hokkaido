"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { MinutesWordCloudData, MinutesWordCloudOption } from "@/lib/minutesWordCloud";

type PeriodMode = "all" | "year" | "meeting";
type ScopeMode = "all" | "plenary" | "representative" | "general";

type Props = {
  city: string;
  cityName: string;
  modes: Array<MinutesWordCloudOption & { value: PeriodMode }>;
  years: MinutesWordCloudOption[];
  meetings: MinutesWordCloudOption[];
  scopes: Array<MinutesWordCloudOption & { value: ScopeMode }>;
  datasets: Record<string, MinutesWordCloudData>;
};

const SIZE_STYLES = [
  "text-[13px] sm:text-sm px-2.5 py-1.5",
  "text-sm sm:text-base px-3 py-2",
  "text-base sm:text-lg px-3.5 py-2",
  "text-lg sm:text-2xl px-4 py-2.5",
];

const TONE_STYLES = [
  "bg-[#FFF9E1] text-[#6B4C11] border-[#E6C566]",
  "bg-[#EEF6FF] text-[#1B3A6B] border-[#B6CAE8]",
  "bg-[#F2FBF6] text-[#276749] border-[#B9E3C8]",
  "bg-[#FFF1F1] text-[#9B2C2C] border-[#E9B6B6]",
];

function formatNumber(value: number): string {
  return new Intl.NumberFormat("ja-JP").format(value);
}

function datasetKey(mode: PeriodMode, value: string, scope: ScopeMode): string {
  return `${mode}:${value}:${scope}`;
}

function sizeIndex(value: number, min: number, max: number): number {
  if (max <= min) return SIZE_STYLES.length - 1;
  const ratio = (value - min) / (max - min);
  if (ratio >= 0.75) return 3;
  if (ratio >= 0.45) return 2;
  if (ratio >= 0.2) return 1;
  return 0;
}

function FilterPill({
  active,
  label,
  onClick,
  accent = "gold",
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  accent?: "gold" | "blue";
}) {
  const activeClass =
    accent === "blue"
      ? "border-[#1B3A6B] bg-[#EEF6FF] text-[#1B3A6B]"
      : "border-[#E6C566] bg-[#FFF3BF] text-[#6B4C11]";

  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8AA3CF] ${
        active
          ? activeClass
          : "border-[#CBD5E0] bg-white text-[#4A5568] hover:border-[#9FB1D2] hover:text-[#1B3A6B]"
      }`}
    >
      {label}
    </button>
  );
}

export default function MinutesWordCloud({
  city,
  cityName,
  modes,
  years,
  meetings,
  scopes,
  datasets,
}: Props) {
  const [activeMode, setActiveMode] = useState<PeriodMode>("all");
  const [activeYear, setActiveYear] = useState<string>(years[0]?.value ?? "");
  const [activeMeeting, setActiveMeeting] = useState<string>(meetings[0]?.value ?? "");
  const [activeScope, setActiveScope] = useState<ScopeMode>("all");

  const activeValue =
    activeMode === "year" ? activeYear : activeMode === "meeting" ? activeMeeting : "all";

  const current = datasets[datasetKey(activeMode, activeValue, activeScope)] ?? {
    entries: [],
    minutesCount: 0,
    analyzedChars: 0,
    latestYear: null,
  };

  const selectedYearLabel = years.find((year) => year.value === activeYear)?.label ?? "年度";
  const selectedMeetingLabel =
    meetings.find((meeting) => meeting.value === activeMeeting)?.label ?? "定例会";
  const selectedScopeLabel = scopes.find((scope) => scope.value === activeScope)?.label ?? "全体";

  const summaryText = useMemo(() => {
    if (activeMode === "all") return activeScope === "all" ? "全年度・全体" : `全年度 / ${selectedScopeLabel}`;
    if (activeMode === "year") return `${selectedYearLabel} / ${selectedScopeLabel}`;
    return `${selectedMeetingLabel} / ${selectedScopeLabel}`;
  }, [activeMode, activeScope, selectedMeetingLabel, selectedScopeLabel, selectedYearLabel]);

  if (!Object.values(datasets).some((dataset) => dataset.entries.length > 0)) return null;

  const entries = current.entries;
  const counts = entries.map((entry) => entry.count);

  const renderPeriodOptions = () => {
    if (activeMode === "year") {
      return (
        <div className="mb-4 flex flex-wrap gap-2">
          {years.map((year) => (
            <FilterPill
              key={year.value}
              active={activeYear === year.value}
              label={year.label}
              onClick={() => setActiveYear(year.value)}
            />
          ))}
        </div>
      );
    }
    if (activeMode === "meeting") {
      return (
        <div className="mb-4 flex flex-wrap gap-2">
          {meetings.map((meeting) => (
            <FilterPill
              key={meeting.value}
              active={activeMeeting === meeting.value}
              label={meeting.label}
              onClick={() => setActiveMeeting(meeting.value)}
            />
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <section className="page-shell mb-6 max-w-6xl">
      <div className="theme-panel overflow-hidden">
        <div className="border-b border-[#E2E8F0] px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="theme-pill">Minutes Cloud</span>
            <span className="theme-pill-soft">{summaryText}</span>
          </div>
          <h2 className="theme-section-title mt-3 text-xl sm:text-2xl">議会でよく出る言葉</h2>
          <p className="mt-1 text-sm leading-relaxed text-[#4A5568]">
            {cityName}の公式議事録本文から、注目語の出現回数を集計しています。語を押すと全文検索に移動します。
          </p>
        </div>

        <div className="px-4 py-4 sm:px-5 sm:py-5">
          <div className="mb-4 flex flex-wrap gap-2">
            {modes.map((mode) => (
              <FilterPill
                key={mode.value}
                active={activeMode === mode.value}
                label={mode.label}
                onClick={() => setActiveMode(mode.value)}
              />
            ))}
          </div>

          {renderPeriodOptions()}

          <div className="mb-5 flex flex-wrap gap-2">
            {scopes.map((scope) => (
              <FilterPill
                key={scope.value}
                active={activeScope === scope.value}
                label={scope.label}
                accent="blue"
                onClick={() => setActiveScope(scope.value)}
              />
            ))}
          </div>

          {entries.length === 0 ? (
            <p className="text-sm text-[#718096]">この条件では表示できる語がまだありません。</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
                {entries.map((entry, index) => {
                  const min = Math.min(...counts);
                  const max = Math.max(...counts);
                  return (
                    <Link
                      key={entry.term}
                      href={`/search?q=${encodeURIComponent(entry.term)}&city=${city}&source=minutes`}
                      className={`inline-flex items-end gap-2 rounded-full border-2 font-black tracking-[0.01em] shadow-[0_6px_16px_rgba(27,58,107,0.08)] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8AA3CF] ${SIZE_STYLES[sizeIndex(entry.count, min, max)]} ${TONE_STYLES[index % TONE_STYLES.length]}`}
                      title={`${entry.term}: ${formatNumber(entry.count)}回`}
                    >
                      <span>{entry.term}</span>
                      <span className="text-[10px] font-semibold opacity-70 sm:text-xs">
                        {formatNumber(entry.count)}
                      </span>
                    </Link>
                  );
                })}
              </div>

              <p className="mt-4 text-xs leading-relaxed text-[#718096]">
                対象: {formatNumber(current.minutesCount)}件の会議録 / 約{formatNumber(Math.round(current.analyzedChars / 10000))}万字。
                候補語は自治体語彙とAIタグから抽出し、議長進行や名簿などの定型文は除外しています。
                {activeMode === "meeting"
                  ? " 定例会ごとは、本会議の定例会単位で集計しています。"
                  : ""}
                {activeScope === "representative" || activeScope === "general"
                  ? " 代表質問・一般質問は、議題見出しで区切られた該当区間のみを集計しています。"
                  : ""}
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
