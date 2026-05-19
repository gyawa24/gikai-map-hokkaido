import Link from "next/link";

type CitySummaryCardsProps = {
  memberCount: number | null;
  minutesCount: number | null;
  latestYear: string | null;
  city?: string;
};

export default function CitySummaryCards({
  memberCount,
  minutesCount,
  latestYear,
  city,
}: CitySummaryCardsProps) {
  const minutesHref = city ? `/${city}/minutes` : null;
  const stats: Array<{ label: string; value: string; href?: string | null; icon: React.ReactNode }> = [
    {
      label: "議員数",
      value: memberCount !== null ? `${memberCount}名` : "―",
      icon: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="w-5 h-5 text-[#2A5298]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      ),
    },
    {
      label: "議事録件数",
      value: minutesCount !== null ? `${minutesCount}件` : "―",
      href: minutesCount !== null && minutesCount > 0 ? minutesHref : null,
      icon: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="w-5 h-5 text-[#2A5298]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      ),
    },
    {
      label: "最新議事録",
      value: latestYear ?? "―",
      href: latestYear ? minutesHref : null,
      icon: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="w-5 h-5 text-[#2A5298]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      ),
    },
  ];

  return (
    <div className="page-shell mb-4 max-w-5xl sm:mb-5">
      <div className="rounded-lg border border-[#CBD5E0] bg-white px-3 py-2 sm:hidden">
        <dl className="grid grid-cols-3 divide-x divide-[#E2E8F0] text-center">
          {stats.map((stat) => (
            <div key={stat.label} className="px-2">
              <dt className="text-[11px] font-medium text-[#718096]">{stat.label}</dt>
              <dd className="mt-0.5 text-sm font-black leading-tight text-[#1B3A6B]">{stat.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="hidden grid-cols-2 gap-2 sm:grid sm:grid-cols-3 sm:gap-3">
      {stats.map((stat, index) => {
        const inner = (
          <>
            <div className="mb-1 flex justify-center sm:mb-1.5">{stat.icon}</div>
            <div className="text-base font-black text-[#1B3A6B] sm:text-2xl">{stat.value}</div>
            <div className="mt-0.5 text-[11px] text-[#718096] sm:text-sm">{stat.label}</div>
          </>
        );
        if (stat.href) {
          return (
            <Link
              key={stat.label}
              href={stat.href}
              className={`theme-card px-2.5 py-3 text-center transition-all duration-150 hover:border-[#9FB1D2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8AA3CF] sm:px-4 sm:py-5 ${
                index === stats.length - 1 ? "col-span-2 sm:col-span-1" : ""
              }`}
            >
              {inner}
            </Link>
          );
        }
        return (
          <div
            key={stat.label}
            className={`theme-card px-2.5 py-3 text-center sm:px-4 sm:py-5 ${
              index === stats.length - 1 ? "col-span-2 sm:col-span-1" : ""
            }`}
          >
            {inner}
          </div>
        );
      })}
      </div>
    </div>
  );
}
