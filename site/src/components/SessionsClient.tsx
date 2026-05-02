"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { SessionSummary } from "@/types/session";
import { getSessionSourceLabel, getSessionThumbnailUrl } from "@/lib/sessionSources";

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function isRecent(dateStr: string, days = 45): boolean {
  const d = new Date(dateStr);
  const now = new Date();
  return now.getTime() - d.getTime() < days * 24 * 60 * 60 * 1000;
}

function isOngoing(dateStr: string): boolean {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  return diff >= 0 && diff < 7 * 24 * 60 * 60 * 1000;
}

type Props = {
  sessions: SessionSummary[];
  city: string;
  allSpeakers: string[];
};

export default function SessionsClient({ sessions, city, allSpeakers }: Props) {
  const [selectedSpeaker, setSelectedSpeaker] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!selectedSpeaker) return sessions;
    return sessions.filter((s) => s.speakers?.includes(selectedSpeaker));
  }, [sessions, selectedSpeaker]);

  // 最新セッションの状態
  const latestDate = sessions[0]?.date ?? "";
  const ongoing = isOngoing(latestDate);
  const recent = isRecent(latestDate);

  return (
    <div>
      {/* 進行中 / 最新バナー */}
      {recent && (
        <div className={`rounded-lg px-4 py-3 mb-5 flex items-center gap-3 ${
          ongoing
            ? "bg-[#1B3A6B] text-white"
            : "bg-[#E8EEF7] border border-[#C5D0E6]"
        }`}>
          <span className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded-full ${
            ongoing
              ? "bg-white text-[#1B3A6B]"
              : "bg-[#1B3A6B] text-white"
          }`}>
            {ongoing ? "開催中" : "最新"}
          </span>
          <span className={`text-sm font-medium ${ongoing ? "text-white" : "text-[#1B3A6B]"}`}>
            {sessions[0]?.title}
          </span>
          <span className={`text-xs ml-auto shrink-0 ${ongoing ? "text-blue-200" : "text-[#718096]"}`}>
            {formatDate(latestDate)}
          </span>
        </div>
      )}

      {/* 議員フィルタ */}
      {allSpeakers.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-medium text-[#718096] mb-2">発言議員で絞り込む</p>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setSelectedSpeaker(null)}
              className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                selectedSpeaker === null
                  ? "bg-[#1B3A6B] text-white border-[#1B3A6B]"
                  : "bg-white text-[#4A5568] border-[#CBD5E0] hover:border-[#1B3A6B]"
              }`}
            >
              すべて
            </button>
            {allSpeakers.map((name) => (
              <button
                key={name}
                onClick={() => setSelectedSpeaker(selectedSpeaker === name ? null : name)}
                className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                  selectedSpeaker === name
                    ? "bg-[#1B3A6B] text-white border-[#1B3A6B]"
                    : "bg-white text-[#4A5568] border-[#CBD5E0] hover:border-[#1B3A6B]"
                }`}
              >
                {name}
              </button>
            ))}
          </div>
          {selectedSpeaker && (
            <p className="text-xs text-[#718096] mt-2">
              {filtered.length}件のセッションで発言あり
            </p>
          )}
        </div>
      )}

      {/* セッション一覧 */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-lg border border-[#CBD5E0] p-8 text-center text-[#718096]">
          該当するセッションはありません。
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((s) => (
            <Link
              key={s.id}
              href={`/${city}/sessions/${s.id}`}
              className="group bg-white rounded-lg border border-[#CBD5E0] hover:border-[#1B3A6B] p-5 shadow-sm hover:shadow-md transition-all duration-150"
            >
              <div className="flex items-start gap-4">
                <div className="shrink-0 w-24 h-16 rounded overflow-hidden bg-[#E8EEF7] relative">
                  {getSessionThumbnailUrl(s) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={getSessionThumbnailUrl(s) ?? ""}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-[linear-gradient(135deg,#E8EEF7,#C5D0E6)]" />
                  )}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-7 h-7 bg-black/60 rounded-full flex items-center justify-center">
                      <svg className="w-3 h-3 text-white ml-0.5" viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="5,3 19,12 5,21" />
                      </svg>
                    </div>
                  </div>
                </div>

                <div className="flex-1 min-w-0">
                  {s.committee && (
                    <p className="text-xs text-[#718096] mb-0.5">{s.committee}</p>
                  )}
                  <h3 className="text-base font-bold text-[#1A202C] leading-snug mb-1">
                    {s.title}
                  </h3>
                  <p className="text-sm text-[#4A5568]">{formatDate(s.date)}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {s.has_summary ? (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-[#E8EEF7] text-[#2A5298] rounded-full font-medium">
                        ✦ 要約あり
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-[#F4F6F9] text-[#718096] rounded-full">
                        要約準備中
                      </span>
                    )}
                    {s.segment_count > 0 && (
                      <span className="text-xs px-2 py-0.5 bg-[#F4F6F9] text-[#718096] rounded-full">
                        {s.segment_count}部構成
                      </span>
                    )}
                    <span className="text-xs px-2 py-0.5 bg-[#F4F6F9] text-[#718096] rounded-full">
                      {getSessionSourceLabel(s).replace("で視聴", "")}
                    </span>
                    {selectedSpeaker && s.speakers?.includes(selectedSpeaker) && (
                      <span className="text-xs px-2 py-0.5 bg-[#FFF3CD] text-[#856404] rounded-full font-medium">
                        {selectedSpeaker}議員 発言あり
                      </span>
                    )}
                  </div>
                </div>

                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-5 h-5 text-[#CBD5E0] group-hover:text-[#1B3A6B] shrink-0 mt-0.5 transition-colors"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
