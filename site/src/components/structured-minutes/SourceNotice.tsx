import type { SourceDocument, StructuredMinutes } from "@/lib/structured-minutes/types";
import EvidenceLink from "./EvidenceLink";

type SourceNoticeProps = {
  sourceDocument: SourceDocument;
  quality?: StructuredMinutes["read_quality"];
  sourceLabel?: string;
};

export default function SourceNotice({ sourceDocument, quality, sourceLabel = "公式掲載ページを確認" }: SourceNoticeProps) {
  return (
    <section className="mb-5 rounded-2xl border border-[#E6C566] bg-[#FFF7D6] px-4 py-4 text-sm leading-relaxed text-[#6B4C11]">
      <p className="font-bold">公式資料から自動整理した非公式の試験版です</p>
      <p className="mt-1">
        抽出結果の誤認識・発言区切りや、公式資料の最新版との一致は未確認です。正式な内容は公式資料をご確認ください。
      </p>
      {quality && (
        <p className="mt-2">
          {quality.unknown_date_count > 0 && "開催日が未確認の記録があります。"}
          {quality.missing_source_position_count > 0 && "原典の該当ページ・位置は未確認です。"}
          {quality.withheld_topic_count > 0 && `確認者・確認日時の記録がない質問項目 ${quality.withheld_topic_count} 件は保留中です。発言本文と質問者別の表示は利用できます。`}
        </p>
      )}
      <div className="mt-3">
        <EvidenceLink
          sourcePosition={{
            official_url: sourceDocument.official_url,
            search_hint: sourceDocument.title,
          }}
          label={sourceLabel}
        />
      </div>
    </section>
  );
}
