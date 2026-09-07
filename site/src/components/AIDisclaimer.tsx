import Link from "next/link";

type Props = {
  /** 原文・正典情報への導線ラベル（例: "YouTubeで視聴"・"議事録原文"） */
  sourceLabel?: string;
};

/**
 * AI生成の要約・タグ・Q&A抽出など、機械的に作られたコンテンツを含むページで
 * 常時表示する注意書き。名誉毀損リスク軽減と、利用者に原典参照を促す役割。
 */
export default function AIDisclaimer({ sourceLabel }: Props) {
  return (
    <div className="theme-alert mb-5 flex items-start gap-3 px-4 py-3">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#FFF1B3]">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="w-4 h-4 text-[#6B4C11]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <div className="flex-1 text-sm leading-relaxed">
        <p className="font-semibold text-[#78451F] mb-0.5">
          このページの要約・抜粋・テーマ分類はAIが自動生成しています
        </p>
        <p className="text-[#78451F]">
          AIによる要約は理解を助けるためのものであり、正確性を保証するものではありません。
          発言内容を引用・共有する際は、必ず
          {sourceLabel ? `「${sourceLabel}」` : "原文"}
          で内容をご確認ください。訂正のご依頼は
          <Link href="/terms" className="underline hover:text-[#1B3A6B]">
            利用規約第4条
          </Link>
          に記載の窓口までご連絡ください。
        </p>
      </div>
    </div>
  );
}
