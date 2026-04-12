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
  minutesBasePath?: string;
};

function sessionCategoryLabel(typeLabel: string): string {
  if (typeLabel.includes("定例会") && !typeLabel.includes("補正") && !typeLabel.includes("委員会")) return "本会議・定例会";
  if (typeLabel.includes("臨時会")) return "本会議・臨時会";
  if (typeLabel.includes("予算特別委員会")) return "予算特別委員会";
  if (typeLabel.includes("決算特別委員会")) return "決算特別委員会";
  if (typeLabel.includes("委員会")) return "委員会";
  return "その他";
}

const SESSION_CATEGORY_ORDER = [
  "本会議・定例会",
  "本会議・臨時会",
  "予算特別委員会",
  "決算特別委員会",
  "委員会",
  "その他",
];

// タグのジャンル分類
const TAG_GENRES: { label: string; keywords: string[] }[] = [
  {
    label: "財政・予算",
    keywords: ["予算", "補正予算", "決算", "財政", "基金", "市債", "予算・決算", "予算・財政", "起債", "交付金", "寄附", "ふるさと納税", "給付金", "減税"],
  },
  {
    label: "産業・経済",
    keywords: ["企業誘致", "半導体", "観光", "工業団地", "空港", "地域経済", "商業", "商品券", "宿泊税", "雇用", "地方創生", "ラピダス", "自動運転", "DX", "民間活力"],
  },
  {
    label: "子育て・教育",
    keywords: ["子育て", "教育", "給食", "学力", "不登校", "こども", "保育", "児童", "学校", "知育", "少子化", "ヤングケアラー"],
  },
  {
    label: "福祉・医療",
    keywords: ["福祉", "高齢者", "医療", "障がい", "介護", "認知症", "補聴器", "後見人", "生活保護", "健康", "予防接種", "感染症", "市民病院", "地域医療"],
  },
  {
    label: "環境・防災",
    keywords: ["防災", "環境", "熊", "道路", "下水道", "インフラ", "防衛", "消防", "騒音", "水質", "脱炭素", "LED", "街路灯", "熱中症", "地震", "ヒグマ", "有害鳥獣", "ハンター"],
  },
  {
    label: "まちづくり",
    keywords: ["公共交通", "公共施設", "人口", "観光振興", "バリアフリー", "スポーツ", "図書館", "文化", "国際交流", "地域コミュニティ", "町内会", "中心市街地", "公園", "市民交流", "生活環境"],
  },
];

function classifyTag(tag: string): string {
  for (const genre of TAG_GENRES) {
    if (genre.keywords.some((kw) => tag.includes(kw) || kw.includes(tag))) {
      return genre.label;
    }
  }
  return "その他";
}

// 正規化：似たタグをまとめる（表示用に最も短い/一般的なものを代表とする）
const TAG_NORMALIZE: Record<string, string> = {
  "子育て支援": "子育て",
  "福祉・子育て": "福祉",
  "教育・給食": "教育",
  "給食費": "給食",
  "学校給食": "給食",
  "給食センター": "給食",
  "環境・脱炭素": "環境",
  "環境保全": "環境",
  "環境問題": "環境",
  "環境整備": "環境",
  "環境改善": "環境",
  "道路・インフラ": "道路整備",
  "交通インフラ": "道路整備",
  "インフラ管理": "道路整備",
  "インフラ整備": "道路整備",
  "次世代半導体": "半導体産業",
  "次世代半導体産業": "半導体産業",
  "DX推進": "DX",
  "DX・デジタル化": "DX",
  "DX・情報化": "DX",
  "観光振興": "観光",
  "高齢化対策": "高齢者支援",
  "高齢者": "高齢者支援",
  "医療・病院": "医療",
  "地域医療": "医療",
  "市民病院": "医療",
  "物価高対策": "物価高騰対策",
  "物価対策": "物価高騰対策",
  "人口減少・定住化": "人口増加",
  "熊対策": "熊対策",
  "北海道ヒグマ管理": "熊対策",
  "有害鳥獣対策": "熊対策",
  "緊急銃猟": "熊対策",
  "ハンター育成": "熊対策",
  "農業被害": "熊対策",
  "不登校対応": "不登校対策",
  "補正予算": "予算",
  "予算・決算": "予算",
  "予算・財政": "予算",
  "決算": "予算",
};

function normalizeTag(tag: string): string {
  return TAG_NORMALIZE[tag] ?? tag;
}

export default function MinutesIndexClient({ items, minutesBasePath = "/chitose/minutes" }: Props) {
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [showAllTags, setShowAllTags] = useState(false);
  const [searchText, setSearchText] = useState("");

  // タグ集計（正規化後）
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      const seen = new Set<string>();
      for (const rawTag of item.enriched?.tags ?? []) {
        const tag = normalizeTag(rawTag);
        if (!seen.has(tag)) {
          seen.add(tag);
          counts.set(tag, (counts.get(tag) ?? 0) + 1);
        }
      }
    }
    return counts;
  }, [items]);

  // 頻度順ソート
  const sortedTags = useMemo(
    () => Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1]).map(([t]) => t),
    [tagCounts]
  );

  // よく出るタグ（頻度3以上 or 上位12件）
  const popularTags = useMemo(
    () => sortedTags.filter((t) => (tagCounts.get(t) ?? 0) >= 3).slice(0, 12),
    [sortedTags, tagCounts]
  );

  // ジャンル別タグ
  const genreGroups = useMemo(() => {
    const groups: Record<string, string[]> = {};
    for (const genre of TAG_GENRES) {
      groups[genre.label] = [];
    }
    groups["その他"] = [];
    for (const tag of sortedTags) {
      const genre = classifyTag(tag);
      if (!groups[genre]) groups[genre] = [];
      groups[genre].push(tag);
    }
    return groups;
  }, [sortedTags]);

  // フィルタリング（テキスト検索 AND タグ絞り込み）
  const filtered = useMemo(() => {
    const q = searchText.trim();
    return items.filter((item) => {
      if (activeTag && !(item.enriched?.tags ?? []).some((t) => normalizeTag(t) === activeTag)) return false;
      if (q && !item.name.includes(q) && !item.japanese_year.includes(q)) return false;
      return true;
    });
  }, [items, activeTag, searchText]);

  // セッション種別でグルーピング
  const byYear = useMemo(() => {
    const map: Record<string, MinutesWithEnriched[]> = {};
    for (const item of filtered) {
      if (!map[item.japanese_year]) map[item.japanese_year] = [];
      map[item.japanese_year].push(item);
    }
    return map;
  }, [filtered]);

  const years = Object.keys(byYear).sort((a, b) => b.localeCompare(a));

  const TagButton = ({ tag }: { tag: string }) => (
    <button
      onClick={() => setActiveTag(activeTag === tag ? null : tag)}
      className={`text-xs px-2.5 py-1 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298] ${
        activeTag === tag
          ? "bg-[#1B3A6B] text-white border-[#1B3A6B]"
          : "bg-white text-[#4A5568] border-[#CBD5E0] hover:border-[#1B3A6B] hover:text-[#1B3A6B]"
      }`}
    >
      {tag}
      <span className="ml-1 text-[10px] opacity-60">{tagCounts.get(tag)}</span>
    </button>
  );

  return (
    <>
      {/* テキスト検索 */}
      <div className="mb-4">
        <label htmlFor="minutes-search" className="sr-only">議事録を検索</label>
        <div className="relative">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#A0AEC0] pointer-events-none"
            viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            id="minutes-search"
            type="search"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="会議名・年度で検索…"
            className="w-full pl-9 pr-4 py-2.5 text-sm border border-[#CBD5E0] rounded-lg bg-white text-[#1A202C] placeholder-[#A0AEC0] focus:outline-none focus:ring-2 focus:ring-[#2A5298] focus:border-transparent transition-colors"
          />
          {searchText && (
            <button
              onClick={() => setSearchText("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#A0AEC0] hover:text-[#4A5568] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298] rounded"
              aria-label="検索をクリア"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* タグフィルター */}
      {sortedTags.length > 0 && (
        <div className="mb-6 bg-white rounded-lg border border-[#CBD5E0] shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-[#E2E8F0] flex items-center justify-between">
            <p className="text-sm font-semibold text-[#1B3A6B]">テーマで絞り込む</p>
            {activeTag && (
              <button
                onClick={() => setActiveTag(null)}
                className="text-xs text-[#718096] hover:text-[#1A202C] flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298] rounded"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                絞り込みを解除
              </button>
            )}
          </div>

          <div className="px-4 py-3">
            {/* よく出るタグ */}
            {!showAllTags && (
              <>
                <p className="text-xs text-[#718096] mb-2">よく出るテーマ</p>
                <div className="flex flex-wrap gap-1.5">
                  {popularTags.map((tag) => <TagButton key={tag} tag={tag} />)}
                </div>
              </>
            )}

            {/* すべてのタグ（ジャンル別） */}
            {showAllTags && (
              <div className="space-y-4">
                {TAG_GENRES.map((genre) => {
                  const tags = genreGroups[genre.label];
                  if (!tags || tags.length === 0) return null;
                  return (
                    <div key={genre.label}>
                      <p className="text-xs font-semibold text-[#718096] mb-1.5">{genre.label}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {tags.map((tag) => <TagButton key={tag} tag={tag} />)}
                      </div>
                    </div>
                  );
                })}
                {genreGroups["その他"] && genreGroups["その他"].length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-[#718096] mb-1.5">その他</p>
                    <div className="flex flex-wrap gap-1.5">
                      {genreGroups["その他"].map((tag) => <TagButton key={tag} tag={tag} />)}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* トグルボタン */}
            <button
              onClick={() => setShowAllTags((v) => !v)}
              className="mt-3 flex items-center gap-1 text-xs text-[#2A5298] hover:text-[#1B3A6B] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298] rounded"
              aria-expanded={showAllTags}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className={`w-3.5 h-3.5 transition-transform ${showAllTags ? "rotate-180" : ""}`}
                viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="6 9 12 15 18 9"/>
              </svg>
              {showAllTags ? "閉じる" : `すべてのテーマを見る（${sortedTags.length}件）`}
            </button>
          </div>
        </div>
      )}

      {/* 絞り込み中の表示 */}
      {(activeTag || searchText.trim()) && (
        <p className="text-sm text-[#4A5568] mb-4">
          {activeTag && (
            <>「<span className="font-semibold text-[#1B3A6B]">{activeTag}</span>」</>
          )}
          {activeTag && searchText.trim() && "・"}
          {searchText.trim() && (
            <>「<span className="font-semibold text-[#1B3A6B]">{searchText.trim()}</span>」</>
          )}
          に関連する議事録：{filtered.length}件
        </p>
      )}

      {filtered.length === 0 ? (
        <div className="bg-white rounded-lg border border-[#CBD5E0] p-8 text-center text-[#718096]">
          条件に一致する議事録が見つかりません
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {years.map((year) => {
            const yearItems = byYear[year];
            const byCategory: Record<string, MinutesWithEnriched[]> = {};
            for (const item of yearItems) {
              const cat = sessionCategoryLabel(item.type_label);
              if (!byCategory[cat]) byCategory[cat] = [];
              byCategory[cat].push(item);
            }
            const cats = SESSION_CATEGORY_ORDER.filter((c) => byCategory[c]);

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
                            href={`${minutesBasePath}/${item.council_id}`}
                            className="group bg-white rounded-lg border border-[#CBD5E0] hover:border-[#1B3A6B] px-5 py-4 shadow-sm hover:shadow-md transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298]"
                          >
                            <div className="flex items-start gap-4">
                              <div
                                className="w-1 self-stretch rounded-full shrink-0 bg-[#1B3A6B] opacity-20 group-hover:opacity-100 transition-opacity mt-0.5"
                                aria-hidden="true"
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-base font-semibold text-[#1A202C] leading-snug mb-1">{item.name}</p>
                                {item.enriched && item.enriched.tags.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-2">
                                    {[...new Set(item.enriched.tags.map(normalizeTag))].slice(0, 6).map((tag) => (
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
                                    {new Set(item.enriched.tags.map(normalizeTag)).size > 6 && (
                                      <span className="text-xs text-[#718096]">+{new Set(item.enriched.tags.map(normalizeTag)).size - 6}</span>
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
