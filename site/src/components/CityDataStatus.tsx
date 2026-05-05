import { formatJaDate, getSearchIndexGeneratedAt } from "@/lib/dataFreshness";
import type { Municipality } from "@/lib/municipalities";

function formatStoredDate(value: string | undefined): string {
  if (!value) return "";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;
  return `${Number(match[1])}年${Number(match[2])}月${Number(match[3])}日`;
}

export default function CityDataStatus({
  municipality,
}: {
  municipality: Municipality | null;
}) {
  const dataUpdatedAt = formatJaDate(getSearchIndexGeneratedAt());
  const minutesVerifiedAt = formatStoredDate(municipality?.minutes_verified_at);

  if (!dataUpdatedAt && !minutesVerifiedAt) return null;

  return (
    <div className="page-shell mb-5 max-w-6xl">
      <dl className="grid gap-1 rounded-lg border border-[#CBD5E0] bg-white px-4 py-3 text-sm shadow-sm sm:flex sm:flex-wrap sm:gap-3">
        {dataUpdatedAt && (
          <div className="flex flex-wrap items-baseline gap-x-2">
            <dt className="font-medium text-[#718096]">データ更新日</dt>
            <dd className="font-semibold tabular-nums text-[#1A202C]">{dataUpdatedAt}</dd>
          </div>
        )}
        {minutesVerifiedAt && (
          <div className="flex flex-wrap items-baseline gap-x-2">
            <dt className="font-medium text-[#718096]">議事録確認日</dt>
            <dd className="font-semibold tabular-nums text-[#1A202C]">{minutesVerifiedAt}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}
