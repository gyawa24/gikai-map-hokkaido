import { RESEARCH_DISCLAIMER } from "@/types/research";

export default function ResearchNotice() {
  return (
    <aside className="theme-alert mb-6 px-5 py-4 text-[#78451F]" aria-label="AI調査結果の注意事項">
      <h2 className="text-lg font-bold">AIによる調査支援について</h2>
      <p className="mt-2 text-base leading-relaxed">{RESEARCH_DISCLAIMER}</p>
    </aside>
  );
}
