"use client";

import { useState } from "react";
import QRCodeModal from "./QRCodeModal";
import { useToast } from "./Toast";

type Props = {
  memberName: string;
  cityName: string;
  factionLabel?: string;
  sessionCount?: number;
  themes?: string[];
};

/**
 * 議員詳細ページを SNS にシェアする導線。
 * シェア先では og-member の名刺ビジュアルが表示される。
 */
export default function MemberShareButtons({
  memberName,
  cityName,
  factionLabel,
  sessionCount,
  themes = [],
}: Props) {
  const [qrOpen, setQrOpen] = useState(false);
  const toast = useToast();

  const buildUrl = () => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}${window.location.pathname}`;
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(buildUrl());
      toast.show("リンクをコピーしました");
    } catch {
      toast.show("コピーに失敗しました", "info");
    }
  };

  const buildShareText = () => {
    const topThemes = themes.slice(0, 3).join("・");
    const parts = [
      `【${cityName}議会】${memberName}${factionLabel ? `（${factionLabel}）` : ""}`,
      sessionCount ? `質問活動${sessionCount}回` : "",
      topThemes ? `主なテーマ: ${topThemes}` : "",
    ].filter(Boolean);
    return parts.join(" / ");
  };

  const xShareHref = (() => {
    const url = buildUrl();
    if (!url) return "#";
    const text = buildShareText();
    return `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  })();

  return (
    <div data-no-print="true" className="flex items-center justify-end gap-1">
      <button
        onClick={() => setQrOpen(true)}
        className="text-xs text-[#718096] hover:text-[#1B3A6B] transition-colors px-2 py-1 rounded hover:bg-[#E8EEF7] inline-flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298]"
        title="この議員ページのQRコードを表示（チラシ・名刺用）"
        aria-label="QRコードを表示"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
          <line x1="14" y1="14" x2="14" y2="17" />
          <line x1="17" y1="14" x2="21" y2="14" />
          <line x1="14" y1="21" x2="21" y2="21" />
          <line x1="17" y1="17" x2="21" y2="17" />
          <line x1="21" y1="17" x2="21" y2="21" />
        </svg>
        <span>QRコード</span>
      </button>
      <button
        onClick={handleCopyLink}
        className="text-xs text-[#718096] hover:text-[#1B3A6B] transition-colors px-2 py-1 rounded hover:bg-[#E8EEF7] inline-flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298]"
        title="この議員ページのリンクをコピー"
        aria-label="この議員ページのリンクをコピー"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
        <span>リンク</span>
      </button>
      <a
        href={xShareHref}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-[#718096] hover:text-[#1B3A6B] transition-colors px-2 py-1 rounded hover:bg-[#E8EEF7] inline-flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298]"
        title="Xで共有"
        aria-label="Xで共有"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
        <span>Xでシェア</span>
      </a>
      {qrOpen && (
        <QRCodeModal
          url={buildUrl()}
          title={`${memberName} 議員ページ`}
          description={`${cityName}議会 ${memberName} 議員`}
          onClose={() => setQrOpen(false)}
        />
      )}
    </div>
  );
}
