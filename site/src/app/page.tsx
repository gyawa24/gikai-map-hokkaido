import fs from "fs";
import path from "path";
import Link from "next/link";
import type { Member } from "@/types/member";
import type { Decision } from "@/types/decision";

function getMemberCount(cityId: string): number {
  try {
    const fp = path.join(process.cwd(), "data", cityId, "members.json");
    const members = JSON.parse(fs.readFileSync(fp, "utf-8")) as Member[];
    return members.length;
  } catch {
    return 0;
  }
}

function getLatestSession(cityId: string): string {
  try {
    const fp = path.join(process.cwd(), "data", cityId, "decisions.json");
    const decisions = JSON.parse(fs.readFileSync(fp, "utf-8")) as Decision[];
    return decisions[0]?.session ?? "";
  } catch {
    return "";
  }
}

const CITY_STYLES = [
  {
    id: "chitose",
    name: "千歳市議会",
    furigana: "ちとせし",
    href: "/chitose",
    border: "border-blue-200 hover:border-blue-400",
    badge: "bg-blue-50 text-blue-700",
    dot: "bg-blue-500",
  },
  {
    id: "eniwa",
    name: "恵庭市議会",
    furigana: "えにわし",
    href: "/eniwa",
    border: "border-green-200 hover:border-green-400",
    badge: "bg-green-50 text-green-700",
    dot: "bg-green-500",
  },
  {
    id: "tomakomai",
    name: "苫小牧市議会",
    furigana: "とまこまいし",
    href: "/tomakomai",
    border: "border-amber-200 hover:border-amber-400",
    badge: "bg-amber-50 text-amber-700",
    dot: "bg-amber-500",
  },
];

export default function HomePage() {
  const cities = CITY_STYLES.map((c) => ({
    ...c,
    memberCount: getMemberCount(c.id),
    latestSession: getLatestSession(c.id),
  }));

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
        {cities.map((city) => (
          <Link
            key={city.id}
            href={city.href}
            className={`bg-white rounded-xl border-2 ${city.border} p-6 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-150`}
          >
            <div className="flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-400 mb-0.5">{city.furigana}</p>
                <h3 className="text-lg font-bold text-gray-900 mb-2">
                  {city.name}
                </h3>
                <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                  {city.memberCount > 0 && (
                    <span className="flex items-center gap-1">
                      <span
                        className={`inline-block w-1.5 h-1.5 rounded-full ${city.dot}`}
                      />
                      議員 {city.memberCount}名
                    </span>
                  )}
                  {city.latestSession && (
                    <span className="flex items-center gap-1">
                      <span
                        className={`inline-block w-1.5 h-1.5 rounded-full ${city.dot}`}
                      />
                      直近: {city.latestSession}
                    </span>
                  )}
                </div>
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
        令和6年〜7年の会議録・議決結果を収録 ·{" "}
        <Link href="/ai-search" className="underline hover:text-gray-600">
          ✦ AI検索
        </Link>
      </p>
    </div>
  );
}
