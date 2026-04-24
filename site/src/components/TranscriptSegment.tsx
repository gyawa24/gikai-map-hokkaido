"use client";

import { useState, useEffect, useRef } from "react";
import type { SessionSegment } from "@/types/session";
import type { Member } from "@/types/member";
import SegmentDetail from "./SegmentDetail";
import QRCodeModal from "./QRCodeModal";
import { useToast } from "./Toast";
import { resolveSpeaker } from "@/lib/memberUtils";

type Props = {
  seg: SessionSegment;
  members?: Member[];
  city: string;
  sessionId: string;
  cityName: string;
  sessionTitle: string;
};

export default function TranscriptSegment({
  seg,
  members = [],
  city,
  sessionId,
  cityName,
  sessionTitle,
}: Props) {
  const [open, setOpen] = useState(false);
  const [bodyOpen, setBodyOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const toast = useToast();
  const ref = useRef<HTMLDivElement>(null);
  const anchorId = `seg-${seg.index}`;
  const speakerLabel = seg.detail ? resolveSpeaker(seg.detail.speaker, members) : seg.label;

  // #seg-N で直接来たら該当セグメントを開いてスクロール
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash === `#${anchorId}`) {
      setBodyOpen(true);
      requestAnimationFrame(() => {
        ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }, [anchorId]);

  const buildPermalink = () => {
    if (typeof window === "undefined") return "";
    // SNS プレビューで seg 別 OG が出るように /s 短縮ルートを返す。
    // クリック時は /s 側が canonical (/${city}/sessions/${id}#${anchorId}) に
    // 即リダイレクトするため、利用者が辿る実体は同じ。
    return `${window.location.origin}/s/${city}/${sessionId}/${seg.index}`;
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(buildPermalink());
      toast.show("発言リンクをコピーしました");
    } catch {
      toast.show("コピーに失敗しました", "info");
    }
  };

  const handleCopyCitation = async () => {
    const body = seg.summary ?? seg.detail?.overview ?? "";
    if (!body) return;
    const header = `${speakerLabel}（${cityName}議会 ${sessionTitle} ${seg.label}）`;
    const block = `${header}\n\n${body}\n\n出典: ${buildPermalink()}`;
    try {
      await navigator.clipboard.writeText(block);
      toast.show("出典つきの本文をコピーしました");
    } catch {
      toast.show("コピーに失敗しました", "info");
    }
  };

  const buildShareText = () => {
    const topicLabel =
      seg.detail?.topics?.slice(0, 2).map((t) => t.theme).join("・") ??
      seg.topics?.slice(0, 2).join("・") ??
      "";
    const parts = [
      `【${cityName}議会】${speakerLabel}`,
      topicLabel ? `テーマ: ${topicLabel}` : "",
      sessionTitle,
    ].filter(Boolean);
    return parts.join(" / ");
  };

  const xShareHref = (() => {
    const url = buildPermalink();
    if (!url) return "#";
    const text = buildShareText();
    return `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  })();

  return (
    <div
      id={anchorId}
      ref={ref}
      className="bg-white rounded-lg border border-[#CBD5E0] overflow-hidden scroll-mt-20"
    >
      {/* セグメントヘッダー（タップで折りたたみ） */}
      <button
        onClick={() => setBodyOpen((v) => !v)}
        className="w-full px-5 py-3 border-b border-[#E2E8F0] flex items-center justify-between gap-2 hover:bg-[#F4F6F9] transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-[#1B3A6B] bg-[#E8EEF7] px-2.5 py-0.5 rounded-full">
            {seg.label}
          </span>
          {seg.start_time && (
            <span className="text-sm text-[#718096]">{seg.start_time}〜</span>
          )}
          {seg.detail && (
            <span className="text-xs text-[#718096]">{speakerLabel}</span>
          )}
        </div>
        <svg
          className={`w-4 h-4 flex-shrink-0 text-[#718096] transition-transform ${bodyOpen ? "" : "-rotate-90"}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {bodyOpen && (
        <div className="px-5 py-4 flex flex-col gap-4">
          {/* 1. ビジュアルカード（detail がある場合） */}
          {seg.detail && <SegmentDetail detail={seg.detail} members={members} />}

          {/* 2. 要約 */}
          {seg.summary ? (
            <p className="text-base text-[#1A202C] leading-relaxed">{seg.summary}</p>
          ) : (
            <p className="text-sm text-[#718096] italic">要約を生成中...</p>
          )}

          {/* トピックバッジ */}
          {seg.topics && seg.topics.length > 0 && (
            <div className="flex flex-wrap gap-1.5 -mt-2">
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

          {/* 3. 全文トグル */}
          {seg.transcript && (
            <div className="border border-[#E2E8F0] rounded-lg overflow-hidden">
              <button
                onClick={() => setOpen((v) => !v)}
                className="w-full px-4 py-2.5 flex items-center justify-between text-sm text-[#4A5568] hover:bg-[#F4F6F9] transition-colors"
              >
                <span>{open ? "全文を閉じる" : "全文を見る"}</span>
                <svg
                  className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`}
                  viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {open && (
                <div className="px-4 pb-4 pt-3 border-t border-[#E2E8F0]">
                  <pre className="text-sm text-[#4A5568] whitespace-pre-wrap leading-relaxed font-sans">
                    {seg.transcript}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* 4. シェア動線 */}
          <div data-no-print="true" className="flex items-center justify-end gap-1 pt-1 border-t border-[#E2E8F0]">
            <button
              onClick={() => setQrOpen(true)}
              className="text-xs text-[#718096] hover:text-[#1B3A6B] transition-colors px-1.5 py-1 rounded hover:bg-[#E8EEF7] inline-flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298]"
              title="この発言のQRコードを表示（議会報告書・チラシ用）"
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
              <span>QR</span>
            </button>
            <button
              onClick={handleCopyLink}
              className="text-xs text-[#718096] hover:text-[#1B3A6B] transition-colors px-1.5 py-1 rounded hover:bg-[#E8EEF7] inline-flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298]"
              title="この発言へのリンクをコピー"
              aria-label="この発言へのリンクをコピー"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
              <span>リンク</span>
            </button>
            {(seg.summary || seg.detail?.overview) && (
              <button
                onClick={handleCopyCitation}
                className="text-xs text-[#718096] hover:text-[#1B3A6B] transition-colors px-1.5 py-1 rounded hover:bg-[#E8EEF7] inline-flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298]"
                title="出典付きで本文をコピー（議員の発信用）"
                aria-label="出典付きで本文をコピー"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                <span>引用</span>
              </button>
            )}
            <a
              href={xShareHref}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[#718096] hover:text-[#1B3A6B] transition-colors px-1.5 py-1 rounded hover:bg-[#E8EEF7] inline-flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298]"
              title="X（旧Twitter）で共有"
              aria-label="Xで共有"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              <span>Xでシェア</span>
            </a>
          </div>
        </div>
      )}
      {qrOpen && (
        <QRCodeModal
          url={buildPermalink()}
          title={`${speakerLabel} の発言`}
          description={`${cityName}議会 ${sessionTitle} ${seg.label}`}
          onClose={() => setQrOpen(false)}
        />
      )}
    </div>
  );
}
