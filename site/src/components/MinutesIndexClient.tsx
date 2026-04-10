"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { MinutesIndexItem, MinutesEnriched } from "@/types/minutes";

type MinutesWithEnriched = MinutesIndexItem & {
  enriched: MinutesEnriched | null;
  category: string;
};

type Props = {
  items: MinutesWithEnriched[];
};

function categoryLabel(typeLabel: string): string {
  if (typeLabel.includes("定例会") && !typeLabel.includes("補正") && !typeLabel.includes("委員会")) return "本会議・定例会";
  if (typeLabel.includes("臨時会")) return "本会議・臨時会";
  if (typeLabel.includes("予算特別委員会")) return "予算特別委員会";
  if (typeLabel.includes("決算特別委員会")) return "決算特別委員会";
  if (typeLabel.includes("委員会")) return "委員会";
  return "その他";
}

const CATEGORY_ORDER = [
  "本会議・定例会",
  "本会議・臨時会",
  "予算特別委員会",
  "決算特別委員会",
  "委員会",
  "その他",
];

export default function MinutesIndexClient({ items }: Props) {
  const [activeTag, setActiveTag] = useState<string | null>(null);

  // 全タグ収集
  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      for (const tag of item.enriched?.tags ?? []) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([tag]) => tag);
  }, [items]);

  // フィルタリング
  const filtered = useMemo(() => {
    if (!activeTag) return items;
    return items.filter((item) => item.enriched?.tags.includes(activeTag));
  }, [items, activeTag]);

  // 年 + カテゴリでグルーピング
  const byYear = useMemo(() => {
    const map: Record<string, MinutesWithEnriched[]> = {};
    for (const item of filtered) {
      const y = item.japanese_year;
      if (!map[y]) map[y] = [];
      map[y].push(item);
    }
    return map;
  }, [filtered]);

  const years = Object.keys(byYear).sort((a, b) => b.localeCompare(a));

  return (
    <>
      {/* タグフィルター */}
      {allTags.length > 0 && (
        <div className="mb-6">
          <p className="text-xs font-semibold text-[#718096] mb-2">テーマで絞り込む</p>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setActiveTag(null)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                activeTag === null
                  ? "bg-[#1B3A6B] text-white border-[#1B3A6B]"
                  : "bg-white text-[#4A5568] border-[#CBD5E0] hover:border-[#1B3A6B]"
              }`}
            >
              すべて
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  activeTag === tag
                    ? "bg-[#1B3A6B] text-white border-[#1B3A6B]"
                    : "bg-white text-[#4A5568] border-[#CBD5E0] hover:border-[#1B3A6B]"
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="bg-white rounded-lg border border-[#CBD5E0] p-8 text-center text-[#718096]">
          「{activeTag}」に関連する議事録が見つかりません
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {years.map((year) => {
            const yearItems = byYear[year];
            const byCategory: Record<string, MinutesWithEnriched[]> = {};
            for (const item of yearItems) {
              const cat = categoryLabel(item.type_label);
              if (!byCategory[cat]) byCategory[cat] = [];
              byCategory[cat].push(item);
            }
            const cats = CATEGORY_ORDER.filter((c) => byCategory[c]);

            return (
              <section key={year}>
                <h3 className="text-base font-bold text-[#1B3A6B] mb-3 flex items-center gap-2">
                  <span className="inline-block w-1 h-4 bg-[#1B3A6B] rounded-full" aria-hidden="true" />
                  {year}
                </h3>
                <div className="flex flex-col gap-6">
                  {cats.map((cat) => (
                    <div key={cat}>
                      <p className="text-xs font-semibold text-[#718096] uppercase tracking-wider mb-2 pl-1">{cat}</p>
                      <div className="flex flex-col gap-2">
                        {byCategory[cat].map((item) => (
                          <Link
                            key={item.council_id}
                            href={`/chitose/minutes/${item.council_id}`}
                            className="group bg-white rounded-lg border border-[#CBD5E0] hover:border-[#1B3A6B] px-5 py-4 shadow-sm hover:shadow-md transition-all duration-150"
                          >
                            <div className="flex items-start gap-4">
                              <div
                                className="w-1 self-stretch rounded-full shrink-0 bg-[#1B3A6B] opacity-20 group-hover:opacity-100 transition-opacity mt-0.5"
                                aria-hidden="true"
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-base font-semibold text-[#1A202C] leading-snug mb-1">{item.name}</p>
                                {/* タグ */}
                                {item.enriched && item.enriched.tags.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-2">
                                    {item.enriched.tags.slice(0, 6).map((tag) => (
                                      <span
                                        key={tag}
                                        className={`text-xs px-2 py-0.5 rounded-full border ${
                                          tag === activeTag
                                            ? "bg-[#1B3A6B] text-white border-[#1B3A6B]"
                                            : "bg-[#F4F6F9] text-[#4A5568] border-[#E2E8F0]"
                                        }`}
                                      >
                                        {tag}
                                      </span>
                                    ))}
                                    {item.enriched.tags.length > 6 && (
                                      <span className="text-xs text-[#718096]">+{item.enriched.tags.length - 6}</span>
                                    )}
                                  </div>
                                )}
                              </div>
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                className="w-5 h-5 text-[#CBD5E0] group-hover:text-[#1B3A6B] shrink-0 mt-0.5 transition-colors"
                                viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                                aria-hidden="true"
                              >
                                <polyline points="9 18 15 12 9 6" />
                              </svg>
                            </div>
                          </Link>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
