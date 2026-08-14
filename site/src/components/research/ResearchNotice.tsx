import { RESEARCH_DISCLAIMER } from "@/types/research";

export default function ResearchNotice() {
  return (
    <aside className="theme-alert mb-6 px-5 py-4 text-[#78451F]" aria-label="AI調査結果の注意事項">
      <h2 className="text-lg font-bold">AIによる調査支援について</h2>
      <p className="mt-2 text-base leading-relaxed">{RESEARCH_DISCLAIMER}</p>
      <p className="mt-3 text-sm leading-relaxed">
        予算検索は5市・R7/R8の限定テストです。数値と参照関係は技術検証済みですが、人による全数承認は未完了です。
        検索結果がない場合も、0円や資料不存在とは扱いません。
      </p>
    </aside>
  );
}
