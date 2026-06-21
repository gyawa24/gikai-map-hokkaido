"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

const FACTION_STYLES: Record<string, string> = {
  自民党議員会: "bg-amber-50 text-amber-800 border border-amber-200",
  自民の会: "bg-amber-50 text-amber-800 border border-amber-200",
  公明党議員団: "bg-sky-50 text-sky-800 border border-sky-200",
  ちとせ未来クラブ: "bg-green-50 text-green-800 border border-green-200",
  日本共産党: "bg-red-50 text-red-800 border border-red-200",
  日本共産党市議団: "bg-red-50 text-red-800 border border-red-200",
  参政党: "bg-purple-50 text-purple-800 border border-purple-200",
  "無所属クラブ（維新・市民）": "bg-cyan-50 text-cyan-800 border border-cyan-200",
  "自由民主党議員団（翡翠会）": "bg-amber-50 text-amber-800 border border-amber-200",
  "民主・春風の会": "bg-sky-50 text-sky-800 border border-sky-200",
  市民と歩む会: "bg-teal-50 text-teal-800 border border-teal-200",
  諸派: "bg-gray-50 text-gray-700 border border-gray-200",
  新緑: "bg-lime-50 text-lime-800 border border-lime-200",
  民主クラブ: "bg-sky-50 text-sky-800 border border-sky-200",
  改革フォーラム: "bg-orange-50 text-orange-800 border border-orange-200",
  会派市民: "bg-teal-50 text-teal-800 border border-teal-200",
  無所属: "bg-gray-50 text-gray-600 border border-gray-200",
};

export type CityThemeMemberRow = {
  name: string;
  seat_number: number;
  faction: string;
  photo_url?: string;
  session_count: number;
  summary_topics?: string[];
  top_topics: string[];
  themes: string[];
};

type Props = {
  city: string;
  rows: CityThemeMemberRow[];
  allThemes: string[];
  themeCounts: Record<string, number>;
};

function factionBadgeClass(faction: string): string {
  return FACTION_STYLES[faction] ?? "bg-gray-50 text-gray-600 border border-gray-200";
}

function getDisplayTopics(row: CityThemeMemberRow): string[] {
  const topics = row.summary_topics?.length
    ? row.summary_topics
    : row.themes.length
      ? row.themes
      : row.top_topics;
  return topics.slice(0, 4);
}

export default function CityThemesClient({ city, rows, allThemes, themeCounts }: Props) {
  const searchParams = useSearchParams();
  const selectedTheme = searchParams.get("theme") ?? "";

  const filtered = useMemo(
    () =>
      (selectedTheme ? rows.filter((row) => row.themes.includes(selectedTheme)) : rows).sort(
        (a, b) => b.session_count - a.session_count || a.seat_number - b.seat_number
      ),
    [rows, selectedTheme]
  );

  return (
    <>
      <div className="mb-6 rounded-lg border border-[#CBD5E0] bg-white p-4 shadow-sm">
        <p className="mb-3 text-xs font-medium text-[#718096]">テーマで絞り込む</p>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/${city}/themes`}
            className={`rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298] ${
              !selectedTheme
                ? "border-[#1B3A6B] bg-[#1B3A6B] font-semibold text-white"
                : "border-[#CBD5E0] bg-white text-[#4A5568] hover:border-[#2A5298] hover:bg-[#E8EEF7] hover:text-[#1B3A6B]"
            }`}
            aria-current={!selectedTheme ? "page" : undefined}
          >
            すべて
            <span className="ml-1.5 text-xs opacity-70">{rows.length}</span>
          </Link>

          {allThemes.map((theme) => {
            const isActive = selectedTheme === theme;
            const count = themeCounts[theme] ?? 0;
            return (
              <Link
                key={theme}
                href={`/${city}/themes?theme=${encodeURIComponent(theme)}`}
                className={`rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298] ${
                  isActive
                    ? "border-[#1B3A6B] bg-[#1B3A6B] font-semibold text-white"
                    : "border-[#CBD5E0] bg-white text-[#4A5568] hover:border-[#2A5298] hover:bg-[#E8EEF7] hover:text-[#1B3A6B]"
                }`}
                aria-current={isActive ? "page" : undefined}
              >
                {theme}
                <span className="ml-1.5 text-xs opacity-70">{count}</span>
              </Link>
            );
          })}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-[#CBD5E0] bg-white p-8 text-center text-[#718096]">
          該当する議員が見つかりません。
        </div>
      ) : (
        <>
          <p className="mb-4 text-sm text-[#718096]">
            {selectedTheme ? (
              <>
                <span className="font-medium text-[#1B3A6B]">「{selectedTheme}」</span>
                {" "}テーマの議員 — {filtered.length}名（発言回数順）
              </>
            ) : (
              <>全議員 — {filtered.length}名（発言回数順）</>
            )}
          </p>

          <div className="space-y-3">
            {filtered.map((row, rank) => (
              <div
                key={row.name}
                className="overflow-hidden rounded-lg border border-[#CBD5E0] bg-white shadow-sm transition-colors hover:border-[#1B3A6B]"
              >
                <div className="p-5">
                  <div className="flex items-start gap-4">
                    <div className="w-8 shrink-0 text-center">
                      <span
                        className={`text-sm font-bold ${
                          rank === 0
                            ? "text-[#B8860B]"
                            : rank === 1
                              ? "text-[#708090]"
                              : rank === 2
                                ? "text-[#8B4513]"
                                : "text-[#A0AEC0]"
                        }`}
                      >
                        {rank + 1}
                      </span>
                    </div>

                    {row.photo_url && (
                      <div className="shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={row.photo_url}
                          alt={`${row.name}議員`}
                          width={56}
                          height={80}
                          loading="lazy"
                          decoding="async"
                          className="h-20 w-14 rounded border border-[#E2E8F0] object-cover shadow-sm"
                        />
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        {row.seat_number > 0 && (
                          <span className="rounded bg-[#E8EEF7] px-2 py-0.5 text-xs font-medium text-[#2A5298]">
                            {row.seat_number}番
                          </span>
                        )}
                        <span className="rounded-full bg-[#E8EEF7] px-2 py-0.5 text-xs font-medium text-[#2A5298]">
                          質問 {row.session_count}回
                        </span>
                        {row.faction && (
                          <span className={`rounded px-2 py-0.5 text-xs font-medium ${factionBadgeClass(row.faction)}`}>
                            {row.faction}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <Link
                          href={`/${city}/members/${row.seat_number}`}
                          className="rounded text-lg font-bold leading-snug text-[#1B3A6B] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298]"
                        >
                          {row.name}
                        </Link>
                        <Link
                          href={`/${city}/members/${row.seat_number}`}
                          className="flex shrink-0 items-center gap-0.5 rounded text-xs text-[#2A5298] transition-colors hover:text-[#1B3A6B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298]"
                        >
                          議員詳細
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="h-3 w-3"
                            aria-hidden="true"
                          >
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                        </Link>
                      </div>

                      {getDisplayTopics(row).length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {getDisplayTopics(row).map((topic) => (
                            <span
                              key={topic}
                              className="rounded-full border border-[#E2E8F0] bg-[#F4F6F9] px-2 py-0.5 text-xs text-[#4A5568]"
                            >
                              {topic}
                            </span>
                          ))}
                        </div>
                      )}

                      {!selectedTheme && row.themes.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {row.themes.slice(0, 5).map((theme) => (
                            <Link
                              key={theme}
                              href={`/${city}/themes?theme=${encodeURIComponent(theme)}`}
                              className="rounded border border-[#C5D0E6] bg-[#E8EEF7] px-2 py-0.5 text-xs text-[#2A5298] transition-colors hover:border-[#1B3A6B] hover:bg-[#1B3A6B] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298]"
                            >
                              {theme}
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
