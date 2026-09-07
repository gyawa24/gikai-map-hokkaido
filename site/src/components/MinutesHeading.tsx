import type { MinutesIndexItem } from "@/types/minutes";
import type { MinutesSource } from "@/lib/minutesSource";
import { minutesDateLabel } from "@/lib/minutesIndexPresentation";
import MinutesSourceLink from "./MinutesSourceLink";

export default function MinutesHeading({ name, cityName, japaneseYear, scheduleCount, scheduleUnit = "日程・資料", contentLabel, indexItem, officialSource }: {
  name: string;
  cityName: string;
  japaneseYear?: string;
  scheduleCount?: number;
  scheduleUnit?: "日程" | "資料" | "日程・資料";
  contentLabel?: string;
  indexItem?: MinutesIndexItem;
  officialSource?: MinutesSource | null;
}) {
  return (
    <section className="mb-6 border-b border-[#CBD5E0] pb-5">
      <p className="mb-2 text-sm font-medium text-[#4A5568]">{cityName}議会 · 公式会議録に基づく掲載</p>
      <h1 className="mb-4 text-2xl font-bold leading-snug text-[#1B3A6B]">{name}</h1>
      <dl className="flex flex-wrap gap-x-6 gap-y-3 text-sm text-[#4A5568]">
        <div><dt className="mb-1">開催期間</dt><dd className="font-semibold tabular-nums text-[#1A202C]">{minutesDateLabel(indexItem ?? {})}</dd></div>
        <div><dt className="mb-1">収録範囲</dt><dd className="font-semibold tabular-nums text-[#1A202C]">{scheduleCount === undefined ? "確認中" : `${scheduleUnit} ${scheduleCount}件`}{contentLabel ? ` · ${contentLabel}` : ""}</dd></div>
        {japaneseYear && <div><dt className="mb-1">開催年</dt><dd className="font-semibold tabular-nums text-[#1A202C]">{japaneseYear}</dd></div>}
      </dl>
      {officialSource && <div className="mt-3"><MinutesSourceLink source={officialSource} /></div>}
    </section>
  );
}
