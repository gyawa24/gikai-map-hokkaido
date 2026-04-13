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
    // members.json がなければ election.json の当選者数で代替
    try {
      const fp = path.join(process.cwd(), "data", cityId, "election.json");
      const data = JSON.parse(fs.readFileSync(fp, "utf-8"));
      return (data.candidates ?? []).filter((c: { result: string }) => c.result === "当選").length;
    } catch {
      return 0;
    }
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

function getDecisionCount(cityId: string): number {
  try {
    const fp = path.join(process.cwd(), "data", cityId, "decisions.json");
    const decisions = JSON.parse(fs.readFileSync(fp, "utf-8")) as Decision[];
    return decisions.length;
  } catch {
    return 0;
  }
}

function getMinutesCount(cityId: string): number {
  try {
    const dir = path.join(process.cwd(), "data", cityId, "minutes");
    const files = fs.readdirSync(dir);
    return files.filter((f) => f.endsWith(".json")).length;
  } catch {
    return 0;
  }
}

const CITIES = [
  {
    id: "chitose",
    name: "千歳市議会",
    furigana: "ちとせし",
    href: "/chitose",
    region: "石狩",
    hasMinutes: true,
    hasSession: true,
  },
  {
    id: "eniwa",
    name: "恵庭市議会",
    furigana: "えにわし",
    href: "/eniwa",
    region: "石狩",
    hasMinutes: true,
    hasSession: false,
  },
  {
    id: "tomakomai",
    name: "苫小牧市議会",
    furigana: "とまこまいし",
    href: "/tomakomai",
    region: "胆振",
    hasMinutes: true,
    hasSession: false,
  },
  {
    id: "asahikawa",
    name: "旭川市議会",
    furigana: "あさひかわし",
    href: "/asahikawa",
    region: "上川",
    hasMinutes: true,
    hasSession: false,
  },
  {
    id: "hakodate",
    name: "函館市議会",
    furigana: "はこだてし",
    href: "/hakodate",
    region: "渡島",
    hasMinutes: true,
    hasSession: false,
  },
  {
    id: "muroran",
    name: "室蘭市議会",
    furigana: "むろらんし",
    href: "/muroran",
    region: "胆振",
    hasMinutes: true,
    hasSession: false,
  },
  {
    id: "kushiro",
    name: "釧路市議会",
    furigana: "くしろし",
    href: "/kushiro",
    region: "釧路",
    hasMinutes: true,
    hasSession: false,
  },
  {
    id: "wakkanai",
    name: "稚内市議会",
    furigana: "わっかないし",
    href: "/wakkanai",
    region: "宗谷",
    hasMinutes: true,
    hasSession: false,
  },
  {
    id: "kitami",
    name: "北見市議会",
    furigana: "きたみし",
    href: "/kitami",
    region: "オホーツク",
    hasMinutes: true,
    hasSession: false,
  },
  {
    id: "obihiro",
    name: "帯広市議会",
    furigana: "おびひろし",
    href: "/obihiro",
    region: "十勝",
    hasMinutes: true,
    hasSession: false,
  },
  {
    id: "nayoro",
    name: "名寄市議会",
    furigana: "なよろし",
    href: "/nayoro",
    region: "上川",
    hasMinutes: true,
    hasSession: false,
  },
  {
    id: "date",
    name: "伊達市議会",
    furigana: "だてし",
    href: "/date",
    region: "胆振",
    hasMinutes: true,
    hasSession: false,
  },
  {
    id: "fukushima",
    name: "福島町議会",
    furigana: "ふくしまちょう",
    href: "/fukushima",
    region: "渡島",
    hasMinutes: true,
    hasSession: false,
  },
  {
    id: "hokuto",
    name: "北斗市議会",
    furigana: "ほくとし",
    href: "/hokuto",
    region: "渡島",
    hasMinutes: true,
    hasSession: false,
  },
  {
    id: "ishikari",
    name: "石狩市議会",
    furigana: "いしかりし",
    href: "/ishikari",
    region: "石狩",
    hasMinutes: true,
    hasSession: false,
  },
  {
    id: "kitahiroshima",
    name: "北広島市議会",
    furigana: "きたひろしまし",
    href: "/kitahiroshima",
    region: "石狩",
    hasMinutes: true,
    hasSession: false,
  },
  {
    id: "nemuro",
    name: "根室市議会",
    furigana: "ねむろし",
    href: "/nemuro",
    region: "根室",
    hasMinutes: true,
    hasSession: false,
  },
  {
    id: "noboribetsu",
    name: "登別市議会",
    furigana: "のぼりべつし",
    href: "/noboribetsu",
    region: "胆振",
    hasMinutes: true,
    hasSession: false,
  },
  {
    id: "ashibetsu",
    name: "芦別市議会",
    furigana: "あしべつし",
    href: "/ashibetsu",
    region: "空知",
    hasMinutes: true,
    hasSession: false,
  },
  {
    id: "memuro",
    name: "芽室町議会",
    furigana: "めむろちょう",
    href: "/memuro",
    region: "十勝",
    hasMinutes: true,
    hasSession: false,
  },
  {
    id: "kamikawa",
    name: "上川町議会",
    furigana: "かみかわちょう",
    href: "/kamikawa",
    region: "上川",
    hasMinutes: true,
    hasSession: false,
  },
  {
    id: "nakagawa",
    name: "中川町議会",
    furigana: "なかがわちょう",
    href: "/nakagawa",
    region: "上川",
    hasMinutes: true,
    hasSession: false,
  },
];

export default function HomePage() {
  const cities = CITIES.map((c) => ({
    ...c,
    memberCount: getMemberCount(c.id),
    latestSession: getLatestSession(c.id),
    decisionCount: getDecisionCount(c.id),
    minutesCount: getMinutesCount(c.id),
  }));

  const totalMembers = cities.reduce((sum, c) => sum + c.memberCount, 0);
  const totalDecisions = cities.reduce((sum, c) => sum + c.decisionCount, 0);

  return (
    <div className="max-w-2xl mx-auto">
      {/* ヒーローセクション */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-[#1B3A6B] leading-snug mb-3">
          北海道の市議会情報を<br className="sm:hidden" />ひとつの場所で
        </h2>
        <p className="text-base text-[#4A5568] leading-relaxed mb-5">
          千歳・恵庭・苫小牧の市議会情報を横断的に収録。議員名簿・議決結果・行事予定・議会だよりをまとめて閲覧できます。
        </p>

        {/* サマリー統計 */}
        {totalMembers > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="bg-white rounded-lg border border-[#CBD5E0] px-4 py-3 text-center shadow-sm">
              <p className="text-2xl font-bold text-[#1B3A6B]">{cities.length}</p>
              <p className="text-xs text-[#718096] mt-0.5">対象市議会</p>
            </div>
            <div className="bg-white rounded-lg border border-[#CBD5E0] px-4 py-3 text-center shadow-sm">
              <p className="text-2xl font-bold text-[#1B3A6B]">{totalMembers}</p>
              <p className="text-xs text-[#718096] mt-0.5">収録議員数</p>
            </div>
            {totalDecisions > 0 && (
              <div className="bg-white rounded-lg border border-[#CBD5E0] px-4 py-3 text-center shadow-sm col-span-2 sm:col-span-1">
                <p className="text-2xl font-bold text-[#1B3A6B]">{totalDecisions.toLocaleString()}</p>
                <p className="text-xs text-[#718096] mt-0.5">収録議決件数</p>
              </div>
            )}
          </div>
        )}
      </section>

      {/* 市選択 */}
      <section className="mb-8">
        <h3 className="text-sm font-semibold text-[#718096] uppercase tracking-wider mb-3">市議会を選ぶ</h3>
        <div className="flex flex-col gap-3">
          {cities.map((city) => (
            <Link
              key={city.id}
              href={city.href}
              className="group bg-white rounded-lg border border-[#CBD5E0] hover:border-[#1B3A6B] p-5 shadow-sm hover:shadow-md transition-all duration-150"
            >
              <div className="flex items-center gap-4">
                <div
                  className="w-1 self-stretch rounded-full shrink-0 bg-[#1B3A6B] opacity-20 group-hover:opacity-100 transition-opacity"
                  aria-hidden="true"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-xs text-[#718096]">{city.furigana}</p>
                    <span className="text-xs text-[#718096]">·</span>
                    <p className="text-xs text-[#718096]">{city.region}</p>
                  </div>
                  <h3 className="text-lg font-bold text-[#1A202C] leading-snug mb-2">
                    {city.name}
                  </h3>
                  <div className="flex flex-wrap gap-3">
                    {city.memberCount > 0 && (
                      <span className="inline-flex items-center gap-1.5 text-sm text-[#4A5568]">
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-[#2A5298]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                          <circle cx="9" cy="7" r="4"/>
                          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                          <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                        </svg>
                        議員 {city.memberCount}名
                      </span>
                    )}
                    {city.latestSession && (
                      <span className="inline-flex items-center gap-1.5 text-sm text-[#4A5568]">
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-[#2A5298]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                          <line x1="16" y1="2" x2="16" y2="6"/>
                          <line x1="8" y1="2" x2="8" y2="6"/>
                          <line x1="3" y1="10" x2="21" y2="10"/>
                        </svg>
                        直近: {city.latestSession}
                      </span>
                    )}
                    {city.minutesCount > 0 && (
                      <span className="inline-flex items-center gap-1.5 text-sm text-[#4A5568]">
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-[#2A5298]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                          <polyline points="14 2 14 8 20 8"/>
                          <line x1="16" y1="13" x2="8" y2="13"/>
                          <line x1="16" y1="17" x2="8" y2="17"/>
                        </svg>
                        議事録 {city.minutesCount}件
                      </span>
                    )}
                  </div>
                  {/* コンテンツバッジ */}
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {city.hasMinutes && (
                      <span className="text-xs px-2 py-0.5 bg-[#E8EEF7] text-[#2A5298] rounded-full font-medium">議事録</span>
                    )}
                    {city.hasSession && (
                      <span className="text-xs px-2 py-0.5 bg-[#E8EEF7] text-[#2A5298] rounded-full font-medium">会議録・速報</span>
                    )}
                  </div>
                </div>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-5 h-5 text-[#CBD5E0] group-hover:text-[#1B3A6B] shrink-0 transition-colors"
                  viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* クイックアクセス */}
      <section className="mb-8">
        <h3 className="text-sm font-semibold text-[#718096] uppercase tracking-wider mb-3">クイックアクセス</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Link
            href="/chitose/minutes"
            className="group flex items-center gap-3 bg-white rounded-lg border border-[#CBD5E0] hover:border-[#1B3A6B] px-4 py-3.5 shadow-sm hover:shadow-md transition-all duration-150"
          >
            <div className="w-9 h-9 rounded-lg bg-[#E8EEF7] flex items-center justify-center shrink-0 group-hover:bg-[#1B3A6B] transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-[#1B3A6B] group-hover:text-white transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[#1A202C]">公式議事録</p>
              <p className="text-xs text-[#4A5568]">千歳市 令和6〜7年</p>
            </div>
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-[#CBD5E0] group-hover:text-[#1B3A6B] shrink-0 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
          </Link>

          <Link
            href="/chitose/sessions"
            className="group flex items-center gap-3 bg-white rounded-lg border border-[#CBD5E0] hover:border-[#1B3A6B] px-4 py-3.5 shadow-sm hover:shadow-md transition-all duration-150"
          >
            <div className="w-9 h-9 rounded-lg bg-[#E8EEF7] flex items-center justify-center shrink-0 group-hover:bg-[#1B3A6B] transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-[#1B3A6B] group-hover:text-white transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polygon points="23 7 16 12 23 17 23 7"/>
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[#1A202C]">会議録・速報</p>
              <p className="text-xs text-[#4A5568]">YouTube文字起こし・要約</p>
            </div>
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-[#CBD5E0] group-hover:text-[#1B3A6B] shrink-0 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
          </Link>

          <Link
            href="/eniwa/minutes"
            className="group flex items-center gap-3 bg-white rounded-lg border border-[#CBD5E0] hover:border-[#1B3A6B] px-4 py-3.5 shadow-sm hover:shadow-md transition-all duration-150"
          >
            <div className="w-9 h-9 rounded-lg bg-[#E8EEF7] flex items-center justify-center shrink-0 group-hover:bg-[#1B3A6B] transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-[#1B3A6B] group-hover:text-white transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[#1A202C]">公式議事録</p>
              <p className="text-xs text-[#4A5568]">恵庭市 令和6〜7年</p>
            </div>
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-[#CBD5E0] group-hover:text-[#1B3A6B] shrink-0 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
          </Link>

          <Link
            href="/tomakomai/minutes"
            className="group flex items-center gap-3 bg-white rounded-lg border border-[#CBD5E0] hover:border-[#1B3A6B] px-4 py-3.5 shadow-sm hover:shadow-md transition-all duration-150"
          >
            <div className="w-9 h-9 rounded-lg bg-[#E8EEF7] flex items-center justify-center shrink-0 group-hover:bg-[#1B3A6B] transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-[#1B3A6B] group-hover:text-white transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[#1A202C]">公式議事録</p>
              <p className="text-xs text-[#4A5568]">苫小牧市 令和6〜7年</p>
            </div>
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-[#CBD5E0] group-hover:text-[#1B3A6B] shrink-0 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
          </Link>

          <Link
            href="/map"
            className="group flex items-center gap-3 bg-white rounded-lg border border-[#CBD5E0] hover:border-[#1B3A6B] px-4 py-3.5 shadow-sm hover:shadow-md transition-all duration-150"
          >
            <div className="w-9 h-9 rounded-lg bg-[#E8EEF7] flex items-center justify-center shrink-0 group-hover:bg-[#1B3A6B] transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-[#1B3A6B] group-hover:text-white transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/>
                <line x1="9" y1="3" x2="9" y2="18"/>
                <line x1="15" y1="6" x2="15" y2="21"/>
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[#1A202C]">地図で探す</p>
              <p className="text-xs text-[#4A5568]">各市の位置を確認</p>
            </div>
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-[#CBD5E0] group-hover:text-[#1B3A6B] shrink-0 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
          </Link>

          <Link
            href="/ai-search"
            className="group flex items-center gap-3 bg-white rounded-lg border border-[#CBD5E0] hover:border-[#1B3A6B] px-4 py-3.5 shadow-sm hover:shadow-md transition-all duration-150"
          >
            <div className="w-9 h-9 rounded-lg bg-[#E8EEF7] flex items-center justify-center shrink-0 group-hover:bg-[#1B3A6B] transition-colors">
              <span className="text-sm text-[#1B3A6B] group-hover:text-white transition-colors font-bold">✦</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[#1A202C]">AI検索</p>
              <p className="text-xs text-[#4A5568]">議決内容を自然言語で検索</p>
            </div>
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-[#CBD5E0] group-hover:text-[#1B3A6B] shrink-0 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
          </Link>
        </div>
      </section>

      {/* このサイトについて */}
      <section className="bg-[#E8EEF7] rounded-lg p-5">
        <h2 className="text-base font-bold text-[#1B3A6B] mb-2">このサイトについて</h2>
        <p className="text-sm text-[#4A5568] leading-relaxed">
          北海道議会情報マップは、北海道内の市議会情報を横断的に収集・整理する
          非公式の情報サイトです。令和6〜7年の会議録・議決結果を収録しています。
          公式情報は各市議会の公式サイトでご確認ください。
        </p>
      </section>
    </div>
  );
}
