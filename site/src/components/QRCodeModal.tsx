"use client";

import { useEffect, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";

type Props = {
  url: string;
  title: string;
  description?: string;
  onClose: () => void;
};

/**
 * 議員や議事録ページのURLをQRコードで共有するためのモーダル。
 * 紙のチラシ・名刺・議会報告書等に印刷して、読み取ってもらう用途。
 */
export default function QRCodeModal({ url, title, description, onClose }: Props) {
  const svgRef = useRef<HTMLDivElement>(null);

  // ESCで閉じる
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleDownload = () => {
    const svg = svgRef.current?.querySelector("svg");
    if (!svg) return;
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svg);
    const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `qr-${title.replace(/[^\w\u4e00-\u9fff\u3040-\u30ff]/g, "_").slice(0, 40)}.svg`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="qr-modal-title"
    >
      <div
        className="bg-white rounded-xl shadow-xl max-w-sm w-full overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="bg-[#1B3A6B] px-5 py-4 text-white flex items-center justify-between">
          <h3 id="qr-modal-title" className="text-base font-bold truncate pr-2">
            {title}
          </h3>
          <button
            onClick={onClose}
            aria-label="閉じる"
            className="shrink-0 p-1 rounded hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* 本体 */}
        <div className="p-6 flex flex-col items-center">
          {description && (
            <p className="text-xs text-[#4A5568] mb-4 text-center">{description}</p>
          )}
          <div ref={svgRef} className="bg-white p-3 border border-[#E2E8F0] rounded">
            <QRCodeSVG
              value={url}
              size={220}
              level="M"
              marginSize={2}
              fgColor="#1A202C"
              bgColor="#FFFFFF"
            />
          </div>
          <p className="text-xs text-[#718096] mt-3 mb-4 break-all text-center px-2">
            {url}
          </p>

          <div className="flex gap-2 w-full">
            <button
              onClick={handleDownload}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-[#1B3A6B] text-white text-sm font-medium hover:bg-[#2A5298] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298]"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              SVGダウンロード
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-white text-[#4A5568] border border-[#CBD5E0] text-sm font-medium hover:bg-[#F4F6F9] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298]"
            >
              閉じる
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
