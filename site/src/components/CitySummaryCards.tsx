type CitySummaryCardsProps = {
  memberCount: number | null;
  minutesCount: number | null;
  latestYear: string | null;
};

export default function CitySummaryCards({
  memberCount,
  minutesCount,
  latestYear,
}: CitySummaryCardsProps) {
  const stats = [
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
    <div className="grid grid-cols-3 gap-3 mb-6">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="bg-white rounded-lg border border-[#CBD5E0] p-4 text-center"
        >
          <div className="flex justify-center mb-2">{stat.icon}</div>
          <div className="text-xl font-bold text-[#1B3A6B]">{stat.value}</div>
          <div className="text-sm text-[#718096] mt-0.5">{stat.label}</div>
        </div>
      ))}
    </div>
  );
}
