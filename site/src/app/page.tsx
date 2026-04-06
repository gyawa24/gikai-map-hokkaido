import Link from "next/link";

const CITIES = [
  {
    id: "chitose",
    name: "千歳市議会",
    furigana: "ちとせし",
    href: "/chitose",
    description: "議員一覧・議決結果・行事予定・議会だより・AI検索",
    color: "border-blue-200 hover:border-blue-400",
    badge: "bg-blue-50 text-blue-700",
  },
  {
    id: "eniwa",
    name: "恵庭市議会",
    furigana: "えにわし",
    href: "/eniwa",
    description: "議員一覧・議決結果・AI検索",
    color: "border-green-200 hover:border-green-400",
    badge: "bg-green-50 text-green-700",
  },
  {
    id: "tomakomai",
    name: "苫小牧市議会",
    furigana: "とまこまいし",
    href: "/tomakomai",
    description: "議員一覧・議決結果・AI検索",
    color: "border-amber-200 hover:border-amber-400",
    badge: "bg-amber-50 text-amber-700",
  },
];

export default function HomePage() {
  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8 text-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          市議会を選択してください
        </h2>
        <p className="text-sm text-gray-500">
          北海道内の市議会情報を横断的に検索・閲覧できます
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {CITIES.map((city) => (
          <Link
            key={city.id}
            href={city.href}
            className={`bg-white rounded-xl border-2 ${city.color} p-6 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-150`}
          >
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${city.badge}`}>
                    北海道
                  </span>
                </div>
                <p className="text-xs text-gray-400 mb-0.5">{city.furigana}</p>
                <h3 className="text-lg font-bold text-gray-900">{city.name}</h3>
                <p className="text-xs text-gray-500 mt-1">{city.description}</p>
              </div>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="w-5 h-5 text-gray-300 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </div>
          </Link>
        ))}
      </div>

      <p className="text-center text-xs text-gray-400 mt-8">
        令和6年〜7年の会議録・議決結果を収録
      </p>
    </div>
  );
}
