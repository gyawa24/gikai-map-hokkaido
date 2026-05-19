import Link from "next/link";

type CitySummary = {
  id: string;
  name: string;
  furigana: string;
  href: string;
  region: string;
  hasSession: boolean;
  hasMinutes: boolean;
  hasBudgets: boolean;
  hasThemes: boolean;
  memberCount: number;
  latestSession: string;
  decisionCount: number;
  minutesCount: number;
};

type RegionGroup = {
  region: string;
  cities: CitySummary[];
};

export default function HomeMunicipalityExplorer({
  groupedRegions,
}: {
  groupedRegions: RegionGroup[];
}) {
  return (
    <div className="space-y-3">
      {groupedRegions.map(({ region, cities }) => (
        <details
          key={region}
          open={region === "石狩"}
          className="overflow-hidden border-b border-[#D8DEE8] bg-transparent pb-3"
        >
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="theme-pill px-4 py-2 text-sm text-[#1B3A6B]">{region}</span>
              <span className="text-sm font-bold text-[#64748B]">{cities.length}自治体</span>
            </div>
            <span className="text-xl font-black text-[#8AA3CF]">⌄</span>
          </summary>
          <div className="grid gap-3 border-t border-dashed border-[#D8DEE8] pt-4 sm:grid-cols-2 2xl:grid-cols-3">
            {cities.map((city) => {
              const featured = city.id === "chitose";
              return (
                <Link
                  key={city.id}
                  href={city.href}
                  className={`motion-surface rounded-lg border px-4 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298] ${
                    featured
                      ? "border-[#E6C566] bg-[#FFF9DD]"
                      : "border-[#D8DEE8] bg-white"
                  }`}
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-lg font-black text-[#111827]">{city.name.replace("議会", "")}</p>
                    {featured && <span className="theme-pill-soft px-3 py-1 text-xs text-[#6B4C11]">公開中</span>}
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-sm font-bold text-[#64748B]">
                    {city.memberCount > 0 && <span className="theme-pill-soft">{city.memberCount}名</span>}
                    {city.minutesCount > 0 && <span className="theme-pill-soft">議事録 {city.minutesCount}件</span>}
                    {city.hasBudgets && <span className="theme-pill-soft">予算書あり</span>}
                    {city.decisionCount > 0 && <span className="theme-pill-soft">議決 {city.decisionCount}件</span>}
                    {city.hasSession && <span className="theme-pill-soft bg-[#EEF4FF] text-[#1B3A6B]">速報あり</span>}
                  </div>
                  {city.latestSession && (
                    <p className="mt-3 line-clamp-2 text-sm font-bold text-[#475569]">
                      最新: {city.latestSession}
                    </p>
                  )}
                </Link>
              );
            })}
          </div>
        </details>
      ))}
    </div>
  );
}
