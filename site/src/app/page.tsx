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

const CITIES = [
  {
    id: "chitose",
    name: "千歳市議会",
    furigana: "ちとせし",
    href: "/chitose",
    region: "空知・石狩",
  },
  {
    id: "eniwa",
    name: "恵庭市議会",
    furigana: "えにわし",
    href: "/eniwa",
    region: "石狩",
  },
  {
    id: "tomakomai",
    name: "苫小牧市議会",
    furigana: "とまこまいし",
    href: "/tomakomai",
    region: "胆振",
  },
];

export default function HomePage() {
  const cities = CITIES.map((c) => ({
    ...c,
    memberCount: getMemberCount(c.id),
    latestSession: getLatestSession(c.id),
  }));

  return (
    <div className="max-w-2xl mx-auto">
      {/* ページ説明 */}
      <section className="mb-8">
        <h2 className="text-xl font-bold text-[#1B3A6B] mb-2">
          市議会を選んでください
        </h2>
        <p className="text-base text-[#4A5568] leading-relaxed">
          議員情報・議決結果・行事予定・議会だよりを一か所で閲覧できます。
          データは各市議会の公式資料をもとに整理しています。
        </p>
      </section>

      {/* 市選択カード */}
      <div className="flex flex-col gap-4 mb-10">
        {cities.map((city) => (
          <Link
            key={city.id}
            href={city.href}
            className="group bg-white rounded-lg border border-[#CBD5E0] hover:border-[#1B3A6B] p-5 shadow-sm hover:shadow-md transition-all duration-150"
          >
            <div className="flex items-center gap-4">
              {/* 左側: 市名ブロック */}
              <div
                className="w-1 self-stretch rounded-full shrink-0 bg-[#1B3A6B] opacity-20 group-hover:opacity-100 transition-opacity"
                aria-hidden="true"
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-[#718096] mb-0.5">{city.furigana}</p>
                <h3 className="text-lg font-bold text-[#1A202C] leading-snug">
                  {city.name}
                </h3>
                <div className="mt-2 flex flex-wrap gap-3">
                  {city.memberCount > 0 && (
                    <span className="inline-flex items-center gap-1.5 text-sm text-[#4A5568]">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="w-4 h-4 text-[#2A5298]"
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
                      議員 {city.memberCount}名
                    </span>
                  )}
                  {city.latestSession && (
                    <span className="inline-flex items-center gap-1.5 text-sm text-[#4A5568]">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="w-4 h-4 text-[#2A5298]"
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
                      直近: {city.latestSession}
                    </span>
                  )}
                </div>
              </div>

              {/* 右矢印 */}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="w-5 h-5 text-[#CBD5E0] group-hover:text-[#1B3A6B] shrink-0 transition-colors"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </div>
          </Link>
        ))}
      </div>

      {/* このサイトについて */}
      <section className="bg-[#E8EEF7] rounded-lg p-5 mb-6">
        <h2 className="text-base font-bold text-[#1B3A6B] mb-2">このサイトについて</h2>
        <p className="text-sm text-[#4A5568] leading-relaxed mb-3">
          北海道議会情報マップは、北海道内の市議会情報を横断的に収集・整理する
          非公式の情報サイトです。令和6〜7年の会議録・議決結果を収録しています。
          公式情報は各市議会の公式サイトでご確認ください。
        </p>
        <Link
          href="/ai-search"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[#2A5298] hover:text-[#1B3A6B] transition-colors"
        >
          ✦ AI検索で議決内容を調べる
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </Link>
      </section>
    </div>
  );
}
