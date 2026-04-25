import Link from "next/link";
import AIDisclaimer from "@/components/AIDisclaimer";
import AiSearch from "@/components/AiSearch";

export const metadata = {
  title: "AI議事録検索（試験版）",
  description:
    "千歳市議会の議事録に対して自然文で質問できる試験版ページ。回答はAIによる自動生成で、参照元の議事録抜粋を併せて表示します。",
};

export default function Page() {
  return (
    <div className="max-w-2xl mx-auto">
      <nav className="text-sm text-[#718096] mb-5 flex items-center gap-1.5">
        <Link href="/" className="hover:text-[#1B3A6B] transition-colors">
          トップ
        </Link>
        <span aria-hidden="true">›</span>
        <span className="text-[#1A202C]">AI議事録検索</span>
        <span className="ml-1 text-[10px] font-bold bg-[#F7C948] text-[#1B3A6B] rounded px-1.5 py-0.5 tracking-wide">
          試験版
        </span>
      </nav>

      <header className="mb-6">
        <h1 className="text-2xl font-bold text-[#1B3A6B] mb-2">
          AI議事録検索
        </h1>
        <p className="text-base text-[#4A5568] leading-relaxed">
          千歳市議会の議事録に対して自然文で質問できます。
          AIが議事録の抜粋を根拠として回答します。
        </p>
      </header>

      <AIDisclaimer sourceLabel="議事録原文" />

      <AiSearch defaultMunicipality="千歳市" />
    </div>
  );
}
