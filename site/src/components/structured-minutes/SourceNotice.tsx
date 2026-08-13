import type { SourceDocument } from "@/lib/structured-minutes/types";
import EvidenceLink from "./EvidenceLink";

type SourceNoticeProps = {
  sourceDocument: SourceDocument;
};

export default function SourceNotice({ sourceDocument }: SourceNoticeProps) {
  return (
    <section className="mb-5 rounded-2xl border border-[#E6C566] bg-[#FFF7D6] px-4 py-4 text-sm leading-relaxed text-[#6B4C11]">
      <p className="font-bold">非公式の構造化ビューです</p>
      <p className="mt-1">
        これは地方議会ドットコムが公式会議録をもとに、発言単位・質問者別・質問項目別に読みやすく整理した試験版ビューです。
        発言本文と原文抜粋は公式会議録の原文を使い、公式原文は変更していません。
      </p>
      <p className="mt-1">
        質問項目名・分類タグは構造化処理で付与した整理情報で、各項目に確認状況を表示しています。
        正式な内容は公式会議録をご確認ください。
      </p>
      <div className="mt-3">
        <EvidenceLink
          sourcePosition={{
            official_url: sourceDocument.official_url,
            search_hint: sourceDocument.title,
          }}
          label="公式会議録（初日・代表ページ）を確認"
        />
      </div>
    </section>
  );
}
