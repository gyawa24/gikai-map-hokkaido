import type { SourcePosition } from "@/lib/structured-minutes/types";

type EvidenceLinkProps = {
  sourcePosition: SourcePosition;
  label?: string;
};

export default function EvidenceLink({
  sourcePosition,
  label = "公式ページを開く",
}: EvidenceLinkProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs leading-relaxed text-[#718096]">
      <a
        href={sourcePosition.official_url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex rounded-full border border-[#CBD5E0] bg-white px-3 py-1 font-bold text-[#1B3A6B] transition-colors hover:bg-[#E8EEF7]"
      >
        {label}
      </a>
      {sourcePosition.local_anchor && (
        <a
          href={`#${sourcePosition.local_anchor}`}
          className="inline-flex rounded-full border border-[#E2E8F0] bg-white px-3 py-1 font-bold text-[#4A5568] transition-colors hover:bg-[#F4F6F9]"
        >
          このページ内の原文
        </a>
      )}
      {sourcePosition.search_hint && (
        <span className="min-w-0 break-words">
          公式ページ内検索語: {sourcePosition.search_hint}
        </span>
      )}
    </div>
  );
}
