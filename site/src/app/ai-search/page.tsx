import Link from "next/link";
import AIDisclaimer from "@/components/AIDisclaimer";
import AiSearch from "@/components/AiSearch";
import {
  AI_SEARCH_BADGE_LABEL,
  AI_SEARCH_LABEL,
  AI_SEARCH_PATH,
  AI_SEARCH_SUMMARY,
  getAiSearchCoverageText,
} from "@/lib/aiSearch";
import { buildPageMetadata } from "@/lib/metadata";

export const metadata = buildPageMetadata({
  title: `${AI_SEARCH_LABEL}（${AI_SEARCH_BADGE_LABEL}）`,
  description:
    "千歳市議会の議事録に対して自然文で質問できる試験版ページ。回答はAIによる自動生成で、参照元の議事録抜粋を併せて表示します。",
  path: AI_SEARCH_PATH,
});

export default function Page() {
  return (
    <div className="page-shell max-w-5xl">
      <nav className="mb-5 flex items-center gap-1.5 text-sm text-[#718096]">
        <Link href="/" className="hover:text-[#1B3A6B] transition-colors">
          トップ
        </Link>
        <span aria-hidden="true">›</span>
        <span className="text-[#1A202C]">{AI_SEARCH_LABEL}</span>
        <span className="theme-pill-soft ml-1 border-[#E6C566] bg-[#FFF3BF] px-2 py-0.5 text-[10px] text-[#6B4C11]">
          {AI_SEARCH_BADGE_LABEL}
        </span>
      </nav>

      <section className="theme-panel mx-auto max-w-4xl rounded-[30px] px-4 py-5 sm:px-6 sm:py-6">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="theme-section-title text-2xl sm:text-3xl">{AI_SEARCH_LABEL}</h1>
          <span className="theme-pill-soft border-[#E6C566] bg-[#FFF3BF] px-3 py-1 text-xs text-[#6B4C11]">
            {AI_SEARCH_BADGE_LABEL}
          </span>
        </div>
        <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-[#475569] sm:text-[16px]">
          {AI_SEARCH_SUMMARY}
        </p>
        <p className="mt-3 text-xs font-bold text-[#6B4C11]">{getAiSearchCoverageText()}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/search" className="theme-button px-4 py-2 text-sm">
            通常検索を見る
          </Link>
        </div>
      </section>

      <div className="mx-auto mt-5 max-w-4xl">
        <AIDisclaimer sourceLabel="議事録原文" />
      </div>

      <div className="mx-auto max-w-4xl">
        <div className="theme-panel rounded-[26px] px-4 py-5 sm:px-6">
          <AiSearch defaultMunicipality="千歳市" />
        </div>
      </div>
    </div>
  );
}
