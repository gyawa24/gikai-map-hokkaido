"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

type CitySummary = {
  id: string;
  name: string;
  furigana: string;
  href: string;
  region: string;
  hasSession: boolean;
  hasMinutes: boolean;
  hasBudgets: boolean;
  hasThemes: boolean;
  memberCount: number;
  latestSession: string;
  decisionCount: number;
  minutesCount: number;
};

type RegionGroup = {
  region: string;
  cities: CitySummary[];
};

type FilterKey = "minutes" | "budgets" | "sessions" | "themes";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "minutes", label: "議事録あり" },
  { key: "budgets", label: "予算書あり" },
  { key: "sessions", label: "速報あり" },
  { key: "themes", label: "テーマあり" },
];

function normalizeText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

function matchesFilter(city: CitySummary, filter: FilterKey): boolean {
  if (filter === "minutes") return city.hasMinutes;
  if (filter === "budgets") return city.hasBudgets;
  if (filter === "sessions") return city.hasSession;
  return city.hasThemes;
}

export default function HomeMunicipalityExplorer({
  groupedRegions,
}: {
  groupedRegions: RegionGroup[];
}) {
  const [query, setQuery] = useState("");
  const [activeFilters, setActiveFilters] = useState<FilterKey[]>([]);

  const filteredGroups = useMemo(() => {
    const normalizedQuery = normalizeText(query);
    return groupedRegions
      .map((group) => ({
        ...group,
        cities: group.cities.filter((city) => {
          const haystack = normalizeText(`${city.name}${city.furigana}${city.region}`);
          const matchesQuery = !normalizedQuery || haystack.includes(normalizedQuery);
          const matchesFilters = activeFilters.every((filter) => matchesFilter(city, filter));
          return matchesQuery && matchesFilters;
        }),
      }))
      .filter((group) => group.cities.length > 0);
  }, [activeFilters, groupedRegions, query]);

  const total = filteredGroups.reduce((sum, group) => sum + group.cities.length, 0);

  function toggleFilter(filter: FilterKey) {
    setActiveFilters((current) =>
      current.includes(filter)
        ? current.filter((item) => item !== filter)
        : [...current, filter]
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[#CBD5E0] bg-white p-4">
        <label htmlFor="municipality-search" className="block text-sm font-bold text-[#1B3A6B]">
          市町村名で絞り込む
        </label>
        <input
          id="municipality-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="例: 千歳、えにわ、胆振"
          className="theme-input mt-2 min-h-11 px-4 py-3 text-base"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          {FILTERS.map((filter) => {
            const active = activeFilters.includes(filter.key);
            return (
              <button
                key={filter.key}
                type="button"
                onClick={() => toggleFilter(filter.key)}
                aria-pressed={active}
                className={`min-h-11 rounded-full border px-3 py-2 text-sm font-bold transition-colors ${
                  active
                    ? "border-[#1B3A6B] bg-[#E8EEF7] text-[#1B3A6B]"
                    : "border-[#CBD5E0] bg-white text-[#4A5568] hover:border-[#1B3A6B] hover:bg-[#F8FAFC]"
                }`}
              >
                {filter.label}
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-sm text-[#4A5568]">{total}自治体を表示中</p>
      </div>

      {filteredGroups.length === 0 ? (
        <div className="rounded-lg border border-[#CBD5E0] bg-white p-8 text-center text-[#4A5568]">
          条件に合う自治体が見つかりませんでした。
        </div>
      ) : (
        <div className="space-y-3">
          {filteredGroups.map(({ region, cities }) => (
            <details
              key={region}
              open={region === "石狩" || query.trim().length > 0 || activeFilters.length > 0}
              className="overflow-hidden border-b border-[#D8DEE8] bg-transparent pb-3"
            >
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="theme-pill px-4 py-2 text-sm text-[#1B3A6B]">{region}</span>
                  <span className="text-sm font-bold text-[#64748B]">{cities.length}自治体</span>
                </div>
                <span className="text-xl font-black text-[#8AA3CF]">⌄</span>
              </summary>
              <div className="grid gap-3 border-t border-dashed border-[#D8DEE8] pt-4 sm:grid-cols-2 2xl:grid-cols-3">
                {cities.map((city) => {
                  const featured = city.id === "chitose";
                  return (
                    <Link
                      key={city.id}
                      href={city.href}
                      className={`motion-surface rounded-lg border px-4 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298] ${
                        featured
                          ? "border-[#E6C566] bg-[#FFF9DD]"
                          : "border-[#D8DEE8] bg-white"
                      }`}
                    >
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-lg font-black text-[#111827]">{city.name.replace("議会", "")}</p>
                        {featured && <span className="theme-pill-soft px-3 py-1 text-xs text-[#6B4C11]">公開中</span>}
                      </div>
                      <div className="flex flex-wrap gap-1.5 text-sm font-bold text-[#64748B]">
                        {city.memberCount > 0 && <span className="theme-pill-soft">{city.memberCount}名</span>}
                        {city.minutesCount > 0 && <span className="theme-pill-soft">議事録 {city.minutesCount}件</span>}
                        {city.hasBudgets && <span className="theme-pill-soft">予算書あり</span>}
                        {city.decisionCount > 0 && <span className="theme-pill-soft">議決 {city.decisionCount}件</span>}
                        {city.hasSession && <span className="theme-pill-soft bg-[#EEF4FF] text-[#1B3A6B]">速報あり</span>}
                      </div>
                      {city.latestSession && (
                        <p className="mt-3 line-clamp-2 text-sm font-bold text-[#475569]">
                          最新: {city.latestSession}
                        </p>
                      )}
                    </Link>
                  );
                })}
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
