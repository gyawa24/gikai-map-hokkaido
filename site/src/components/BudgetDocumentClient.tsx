"use client";

import { useMemo, useState } from "react";
import type { BudgetPage } from "@/lib/budgets";

function normalizeForSearch(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[ァ-ヶ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60))
    .toLowerCase();
}

function tokenize(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .map(normalizeForSearch)
    .filter(Boolean);
}

function buildSnippet(page: BudgetPage, tokens: string[]): string {
  if (tokens.length === 0) return page.preview;
  const lines = page.text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const hit = lines.find((line) => {
    const normalized = normalizeForSearch(line);
    return tokens.every((token) => normalized.includes(token));
  });
  return (hit ?? page.preview).replace(/\s+/g, " ").trim().slice(0, 180);
}

const BUDGET_SECTION_LABELS = [
  "議会費",
  "総務費",
  "民生費",
  "衛生費",
  "労働費",
  "農林水産業費",
  "商工費",
  "土木費",
  "消防費",
  "教育費",
  "公債費",
  "諸支出金",
  "職員費",
  "予備費",
  "歳入",
  "歳出",
  "目次",
];

function normalizeBudgetLabelText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/贄/g, "費")
    .replace(/上木/g, "土木")
    .replace(/舟几又/g, "一般");
}

function getBudgetSectionLabel(page: BudgetPage): string | null {
  if (page.toc_label) return page.toc_label;

  const footer = normalizeBudgetLabelText(page.text.slice(-1600));
  const footerLabel = BUDGET_SECTION_LABELS.find((label) => footer.includes(label));
  if (footerLabel) return footerLabel;

  const summary = normalizeBudgetLabelText(`${page.title}${page.preview}`);
  return BUDGET_SECTION_LABELS.find((label) => summary.includes(label)) ?? null;
}

export default function BudgetDocumentClient({
  pages,
  pageCount,
}: {
  pages: BudgetPage[];
  pageCount: number;
}) {
  const [query, setQuery] = useState("");
  const [selectedPageNumber, setSelectedPageNumber] = useState(pages[0]?.page ?? 1);
  const [zoom, setZoom] = useState(100);
  const [showOcrText, setShowOcrText] = useState(false);
  const tokens = useMemo(() => tokenize(query), [query]);

  const results = useMemo(() => {
    if (tokens.length === 0) {
      return pages.slice(0, 12).map((page) => ({
        ...page,
        snippet: page.preview,
      }));
    }

    return pages
      .filter((page) => {
        const haystack = normalizeForSearch(`${page.title}\n${page.preview}\n${page.text}`);
        return tokens.every((token) => haystack.includes(token));
      })
      .map((page) => ({
        ...page,
        snippet: buildSnippet(page, tokens),
      }));
  }, [pages, tokens]);

  const effectiveSelectedPageNumber =
    tokens.length > 0 && results.length > 0 && !results.some((page) => page.page === selectedPageNumber)
      ? results[0].page
      : selectedPageNumber;
  const selectedPage = pages.find((page) => page.page === effectiveSelectedPageNumber) ?? pages[0];
  const selectedSectionLabel = selectedPage ? getBudgetSectionLabel(selectedPage) : null;
  const canGoPrev = Boolean(selectedPage && selectedPage.page > 1);
  const canGoNext = Boolean(selectedPage && selectedPage.page < pageCount);
  const popularExamples = ["給食", "除雪", "家庭ごみ", "ラピダス", "保育"];

  function goToPage(page: number) {
    setSelectedPageNumber(Math.min(Math.max(page, 1), pageCount));
  }

  return (
    <div className="space-y-4">
      <section className="theme-card px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end">
          <div className="min-w-0 flex-1">
            <label htmlFor="budget-search" className="block text-sm font-black text-[#1B3A6B]">
              予算書内を検索
            </label>
            <input
              id="budget-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="例: 給食、除雪、家庭ごみ"
              className="theme-input mt-2 px-4 py-3 text-base"
            />
          </div>
          <div className="flex flex-wrap gap-2 xl:max-w-[28rem] xl:justify-end">
            {popularExamples.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setQuery(example)}
                className="theme-button px-3 py-1.5 text-sm"
              >
                {example}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-[#718096]">
          空白を無視して検索します。検索結果は入口として使い、数字・費目名・表の行位置は下の原本画像で確認してください。
        </p>

        <div className="mt-3 flex items-center justify-between border-t border-[#E2E8F0] pt-2">
          <span className="text-sm font-bold text-[#4A5568]">
            {tokens.length > 0 ? `${results.length}件` : `先頭${Math.min(12, pageCount)}ページ`}
          </span>
          <span className="text-xs text-[#718096]">全{pageCount}ページ</span>
        </div>

        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {results.length === 0 ? (
            <div className="w-full rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-4 text-sm text-[#718096]">
              該当するページが見つかりませんでした。
            </div>
          ) : (
            results.map((page) => {
              const active = page.page === selectedPage?.page;
              const sectionLabel = getBudgetSectionLabel(page);
              return (
                <button
                  key={page.page}
                  type="button"
                  onClick={() => setSelectedPageNumber(page.page)}
                  className={`min-h-[3.6rem] w-[10.5rem] shrink-0 rounded-xl border px-3 py-2 text-left transition-colors sm:w-[13rem] ${
                    active
                      ? "border-[#1B3A6B] bg-[#E8EEF7]"
                      : "border-[#E2E8F0] bg-white hover:border-[#9FB1D2]"
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-black text-[#1B3A6B]">p.{page.page}</span>
                    {sectionLabel ? (
                      <span className="truncate rounded-full bg-white px-2 py-0.5 text-[11px] font-black leading-none text-[#2A5298] ring-1 ring-[#C5D0E6]">
                        {sectionLabel}
                      </span>
                    ) : (
                      <span className="text-xs text-[#718096]">{page.text_length.toLocaleString()}字</span>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-xs leading-relaxed text-[#4A5568]">
                    {page.snippet}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </section>

      <section className="theme-card overflow-hidden">
        {selectedPage ? (
          <>
            <div className="border-b border-[#E2E8F0] bg-[#F8FAFC] px-4 py-4 sm:px-5">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div>
                  <p className="text-xs font-bold text-[#718096]">予算書 p.{selectedPage.page}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {selectedSectionLabel && (
                      <span className="inline-flex rounded-full bg-[#E8EEF7] px-2.5 py-1 text-xs font-black leading-none text-[#2A5298] ring-1 ring-[#C5D0E6]">
                        {selectedSectionLabel}
                      </span>
                    )}
                    <h2 className="text-lg font-black leading-snug text-[#1B3A6B]">
                      {selectedPage.title}
                    </h2>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => goToPage(selectedPage.page - 1)}
                    disabled={!canGoPrev}
                    className="theme-button px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    前へ
                  </button>
                  <label className="flex items-center gap-2 text-sm font-bold text-[#4A5568]">
                    <span>ページ</span>
                    <input
                      type="number"
                      min={1}
                      max={pageCount}
                      value={selectedPage.page}
                      onChange={(event) => goToPage(Number(event.target.value))}
                      className="theme-input w-24 px-3 py-2 text-center"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => goToPage(selectedPage.page + 1)}
                    disabled={!canGoNext}
                    className="theme-button px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    次へ
                  </button>
                  <div className="flex rounded-full border border-[#D7DEE8] bg-white p-1">
                    {[90, 100, 110, 130].map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setZoom(value)}
                        className={`rounded-full px-3 py-1 text-xs font-black transition-colors ${
                          zoom === value ? "bg-[#1B3A6B] text-white" : "text-[#4A5568] hover:bg-[#E8EEF7]"
                        }`}
                      >
                        {value}%
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="max-h-[56rem] overflow-auto bg-[#E9EDF3] p-3 sm:p-5">
              {selectedPage.image ? (
                // eslint-disable-next-line @next/next/no-img-element -- WebP pages are pre-rendered, so runtime image optimization would add avoidable cost.
                <img
                  src={selectedPage.image}
                  alt={`${selectedPage.page}ページの原本画像`}
                  className="mx-auto h-auto max-w-none rounded bg-white shadow-[0_8px_24px_rgba(15,37,72,0.18)]"
                  style={{ width: `${zoom}%` }}
                />
              ) : (
                <div className="rounded-2xl border border-[#E2E8F0] bg-white px-6 py-10 text-center text-[#718096]">
                  原本画像を準備中です。
                </div>
              )}
            </div>
            <div className="border-t border-[#E2E8F0] bg-white px-4 py-3 sm:px-5">
              <button
                type="button"
                onClick={() => setShowOcrText((value) => !value)}
                className="text-sm font-black text-[#2A5298] hover:underline"
              >
                {showOcrText ? "OCRテキストを閉じる" : "OCRテキストを見る"}
              </button>
              {showOcrText && (
                <pre className="mt-3 max-h-[22rem] overflow-auto whitespace-pre rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-4 text-xs leading-relaxed text-[#1A202C]">
                  {selectedPage.text}
                </pre>
              )}
            </div>
          </>
        ) : (
          <div className="px-6 py-10 text-center text-[#718096]">ページを読み込めませんでした。</div>
        )}
      </section>
    </div>
  );
}
