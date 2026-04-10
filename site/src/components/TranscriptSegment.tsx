"use client";

import { useState } from "react";
import type { SessionSegment } from "@/types/session";
import SegmentDetail from "./SegmentDetail";

export default function TranscriptSegment({ seg }: { seg: SessionSegment }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-white rounded-lg border border-[#CBD5E0] overflow-hidden">
      {/* セグメントヘッダー */}
      <div className="px-5 py-4 border-b border-[#E2E8F0]">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-[#1B3A6B] bg-[#E8EEF7] px-2.5 py-0.5 rounded-full">
              {seg.label}
            </span>
            {seg.start_time && (
              <span className="text-sm text-[#718096]">{seg.start_time}〜</span>
            )}
          </div>
        </div>

        {/* 要約 */}
        {seg.summary ? (
          <p className="mt-3 text-base text-[#1A202C] leading-relaxed">{seg.summary}</p>
        ) : (
          <p className="mt-3 text-sm text-[#718096] italic">要約を生成中...</p>
        )}

        {/* トピックバッジ */}
        {seg.topics && seg.topics.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {seg.topics.map((t) => (
              <span
                key={t}
                className="text-xs px-2 py-0.5 bg-[#F4F6F9] border border-[#CBD5E0] text-[#4A5568] rounded-full"
              >
                {t}
              </span>
            ))}
          </div>
        )}

        {/* 詳細カード */}
        {seg.detail && <SegmentDetail detail={seg.detail} />}
      </div>

      {/* 文字起こしトグル */}
      {seg.transcript && (
        <>
          <button
            onClick={() => setOpen((v) => !v)}
            className="w-full px-5 py-2.5 flex items-center justify-between text-sm text-[#4A5568] hover:bg-[#F4F6F9] transition-colors"
          >
            <span>{open ? "文字起こしを閉じる" : "文字起こしを見る"}</span>
            <svg
              className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`}
              viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {open && (
            <div className="px-5 pb-5 border-t border-[#E2E8F0] pt-4">
              <pre className="text-sm text-[#4A5568] whitespace-pre-wrap leading-relaxed font-sans">
                {seg.transcript}
              </pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}
