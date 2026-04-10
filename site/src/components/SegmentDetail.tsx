"use client";

import { useState } from "react";

type QA = { q: string; a: string };
type TopicCard = {
  theme: string;
  icon: string;
  color: string;
  summary: string;
  qa: QA[];
};
type Detail = {
  speaker: string;
  overview: string;
  topics: TopicCard[];
};

export default function SegmentDetail({ detail }: { detail: Detail }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  return (
    <div className="mt-4 flex flex-col gap-4">
      {/* 概要 */}
      <div className="bg-[#F4F6F9] rounded-lg px-4 py-3 border border-[#CBD5E0]">
        <p className="text-xs font-bold text-[#718096] mb-1">質疑全体の概要</p>
        <p className="text-sm text-[#1A202C] leading-relaxed">{detail.overview}</p>
      </div>

      {/* テーマカード */}
      {detail.topics.map((topic, i) => (
        <div
          key={i}
          className="rounded-lg border overflow-hidden"
          style={{ borderColor: topic.color + "44" }}
        >
          {/* カードヘッダー */}
          <div
            className="px-4 py-3 flex items-center gap-3"
            style={{ backgroundColor: topic.color + "18" }}
          >
            <span
              className="text-2xl w-10 h-10 flex items-center justify-center rounded-full flex-shrink-0"
              style={{ backgroundColor: topic.color + "28" }}
            >
              {topic.icon}
            </span>
            <div className="flex-1 min-w-0">
              <p
                className="text-sm font-bold leading-snug"
                style={{ color: topic.color }}
              >
                {topic.theme}
              </p>
              <p className="text-xs text-[#4A5568] mt-0.5 leading-snug">{topic.summary}</p>
            </div>
          </div>

          {/* Q&A トグル */}
          <button
            onClick={() => setOpenIdx(openIdx === i ? null : i)}
            className="w-full px-4 py-2 flex items-center justify-between text-xs text-[#4A5568] hover:bg-[#F4F6F9] transition-colors border-t"
            style={{ borderColor: topic.color + "33" }}
          >
            <span>質疑の詳細を{openIdx === i ? "閉じる" : "見る"}（{topic.qa.length}問）</span>
            <svg
              className={`w-3.5 h-3.5 transition-transform ${openIdx === i ? "rotate-180" : ""}`}
              viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {openIdx === i && (
            <div className="px-4 pb-4 pt-3 flex flex-col gap-3 border-t" style={{ borderColor: topic.color + "33" }}>
              {topic.qa.map((qa, j) => (
                <div key={j} className="flex flex-col gap-1.5">
                  <div className="flex gap-2">
                    <span
                      className="text-xs font-bold px-1.5 py-0.5 rounded flex-shrink-0 h-fit mt-0.5"
                      style={{ backgroundColor: topic.color + "22", color: topic.color }}
                    >
                      Q
                    </span>
                    <p className="text-sm text-[#1A202C] leading-relaxed">{qa.q}</p>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-xs font-bold px-1.5 py-0.5 rounded flex-shrink-0 h-fit mt-0.5 bg-[#E8EEF7] text-[#1B3A6B]">
                      A
                    </span>
                    <p className="text-sm text-[#4A5568] leading-relaxed">{qa.a}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
