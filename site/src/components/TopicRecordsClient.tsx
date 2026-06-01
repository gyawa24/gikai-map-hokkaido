"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { aliasesForTag, canonicalizeTag, normalizeTopic, slugForTag } from "@/lib/topicAliases";

type TopicRecord = {
  city?: string;
  cityId?: string;
  cityName: string;
  council_id: number;
  name: string;
  summary?: string;
  highlights?: string[];
  tags?: string[];
};

type TopicIndex = {
  records?: TopicRecord[];
};

type Props = {
  canonical: string;
  maxRecords?: number;
};

const DEFAULT_MAX_RECORDS = 30;

function matchesTopic(record: TopicRecord, aliases: Set<string>) {
  return (record.tags ?? []).some((tag) => aliases.has(normalizeTopic(tag)));
}

function recordCityId(record: TopicRecord) {
  return record.cityId || record.city || "";
}

export default function TopicRecordsClient({
  canonical,
  maxRecords = DEFAULT_MAX_RECORDS,
}: Props) {
  const [records, setRecords] = useState<TopicRecord[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  const aliases = useMemo(
    () => new Set(aliasesForTag(canonical).map(normalizeTopic)),
    [canonical]
  );

  useEffect(() => {
    let cancelled = false;

    async function loadRecords() {
      setStatus("loading");
      try {
        const response = await fetch("/generated/topics-index.json", {
          cache: "force-cache",
        });
        if (!response.ok) {
          throw new Error(`topics-index ${response.status}`);
        }
        const index = (await response.json()) as TopicIndex;
        if (cancelled) return;
        setRecords((index.records ?? []).filter((record) => matchesTopic(record, aliases)));
        setStatus("ready");
      } catch {
        if (cancelled) return;
        setRecords([]);
        setStatus("error");
      }
    }

    loadRecords();
    return () => {
      cancelled = true;
    };
  }, [aliases]);

  const visibleRecords = records.slice(0, maxRecords);

  if (status === "loading") {
    return (
      <div className="bg-white rounded-lg border border-[#CBD5E0] p-8 text-center text-[#718096]">
        議事録を読み込んでいます。
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="bg-white rounded-lg border border-[#CBD5E0] p-8 text-center text-[#718096]">
        <p className="font-semibold text-[#4A5568]">テーマ別の一覧を読み込めませんでした。</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Link href={`/search?q=${encodeURIComponent(canonical)}`} className="theme-button px-4 py-2 text-sm">
            横断検索で探す
          </Link>
          <Link href="/topics" className="theme-button px-4 py-2 text-sm">
            テーマ一覧へ戻る
          </Link>
        </div>
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-[#CBD5E0] p-8 text-center text-[#718096]">
        <p className="font-semibold text-[#4A5568]">このテーマに該当する議事録はありません。</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Link href={`/search?q=${encodeURIComponent(canonical)}`} className="theme-button px-4 py-2 text-sm">
            横断検索で探す
          </Link>
          <Link href="/topics" className="theme-button px-4 py-2 text-sm">
            テーマ一覧へ戻る
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-[#CBD5E0] bg-white p-4 text-sm leading-relaxed text-[#4A5568]">
        議事録 {records.length}件
        {records.length > visibleRecords.length && (
          <>
            。まず{visibleRecords.length}件を表示しています。
            全件を確認する場合は
            <Link href={`/search?q=${encodeURIComponent(canonical)}`} className="mx-1 font-semibold text-[#2A5298] underline underline-offset-2">
              横断検索
            </Link>
            から絞り込めます。
          </>
        )}
      </div>

      {visibleRecords.map((record) => {
        const cityId = recordCityId(record);
        return (
          <div
            key={`${cityId}-${record.council_id}`}
            className="bg-white rounded-lg border border-[#CBD5E0] hover:border-[#1B3A6B] shadow-sm transition-colors duration-150 overflow-hidden"
          >
            <div className="p-5">
              <div className="flex items-start gap-3 mb-3">
                <span className="text-xs font-semibold px-2 py-0.5 bg-[#E8EEF7] text-[#2A5298] rounded shrink-0 mt-0.5">
                  {record.cityName}
                </span>
                <Link
                  href={`/${cityId}/minutes/${record.council_id}`}
                  className="text-lg font-bold text-[#1A202C] leading-snug hover:text-[#1B3A6B] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298] rounded"
                >
                  {record.name}
                </Link>
              </div>

              {record.summary && (
                <p className="text-base text-[#4A5568] leading-relaxed mb-3">
                  {record.summary}
                </p>
              )}

              {record.highlights && record.highlights.length > 0 && (
                <div className="flex items-start gap-2 text-sm text-[#4A5568] mb-3">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="w-4 h-4 text-[#2A5298] shrink-0 mt-0.5"
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
                  <span>{record.highlights[0]}</span>
                </div>
              )}

              {record.tags && record.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {record.tags.map((tag) => {
                    const displayTag = canonicalizeTag(tag);
                    return (
                      <Link
                        key={tag}
                        href={`/topics/${slugForTag(displayTag)}`}
                        className={`text-xs px-2 py-0.5 border rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298] ${
                          displayTag === canonical
                            ? "bg-[#1B3A6B] text-white border-[#1B3A6B]"
                            : "bg-[#F4F6F9] text-[#4A5568] border-[#E2E8F0] hover:bg-[#E8EEF7] hover:text-[#2A5298]"
                        }`}
                      >
                        {displayTag}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="border-t border-[#E2E8F0] px-5 py-2.5 flex justify-end">
              <Link
                href={`/${cityId}/minutes/${record.council_id}`}
                className="text-sm text-[#2A5298] hover:text-[#1B3A6B] font-medium flex items-center gap-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298] rounded"
              >
                該当箇所を見る
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="w-4 h-4"
                  aria-hidden="true"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}
