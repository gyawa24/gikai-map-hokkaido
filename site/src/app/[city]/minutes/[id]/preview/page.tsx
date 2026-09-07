import { Suspense } from "react";
import { notFound } from "next/navigation";
import MinutesDetailClient from "@/components/MinutesDetailClient";
import MinutesHeading from "@/components/MinutesHeading";
import { loadMinutesV2Preview } from "@/lib/councilRecordV2Preview";
import { getMunicipality } from "@/lib/municipalities";
import { getPublishedMinutesIndexResult } from "@/lib/minutesPublication";
import { getMinutesCatalogSource } from "@/lib/minutesSource";
import { minutesContentLabel, minutesScheduleUnit } from "@/lib/minutesPresentation";

export const dynamic = "force-dynamic";
export const metadata = { title: "議事録データ移行のローカル確認", robots: { index: false, follow: false } };

export default async function MinutesV2PreviewPage({ params }: { params: Promise<{ city: string; id: string }> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const { city, id } = await params;
  const municipality = getMunicipality(city);
  if (!municipality || municipality.minutes_access === "restricted") notFound();
  const publication = await getPublishedMinutesIndexResult(city, id);
  if (publication.status !== "available") notFound();
  const preview = loadMinutesV2Preview(city, id);
  if (preview.status === "disabled") notFound();
  if (preview.status !== "available") {
    return <div className="mx-auto max-w-3xl rounded-lg border border-[#F7C948] bg-[#FFF7E6] p-5 text-[#78451F]" role="status">
      <h1 className="mb-2 text-xl font-bold">データ移行のプレビューを準備してください</h1>
      <p>検証済みの表示用データが見つからないか、ファイルの整合性を確認できませんでした。</p>
    </div>;
  }
  const { artifact } = preview;
  const { minutes, counts } = artifact;
  const scheduleUnit = minutesScheduleUnit(minutes);
  const officialSource = getMinutesCatalogSource(municipality);
  return <div className="mx-auto max-w-3xl">
    <aside className="mb-6 rounded-lg border border-[#F7C948] bg-[#FFF7E6] p-5 text-sm text-[#78451F]">
      <p className="mb-2 font-bold">新しい議事録データ形式のローカル確認</p>
      <p>原文・ID・順序が元データと一致した表示です。公開データの差し替えは行っていません。</p>
      <p className="mt-2 tabular-nums">{scheduleUnit === "資料" && counts.turns === 0
        ? `全文資料 ${counts.document_items}件 · 元記録 ${counts.original_records}件（発言単位への分割は未実施）`
        : `${scheduleUnit} ${counts.sittings}件 · 発言 ${counts.turns}件 · 名簿・議題など ${counts.document_items}件 · 元記録 ${counts.original_records}件`}</p>
      <a href={`/${city}/minutes/${id}`} className="mt-3 inline-flex min-h-11 items-center font-semibold underline">現在のデータによる表示と比較する</a>
    </aside>
    <MinutesHeading name={minutes.name} cityName={municipality.name} japaneseYear={minutes.japanese_year}
      scheduleCount={minutes.schedules.length} scheduleUnit={scheduleUnit} contentLabel={minutesContentLabel(minutes)}
      indexItem={artifact.index_item} officialSource={officialSource} />
    <Suspense>
      <MinutesDetailClient session={minutes} enriched={null} cityName={municipality.name} officialSource={officialSource} />
    </Suspense>
  </div>;
}
