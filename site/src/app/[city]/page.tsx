import fs from "fs";
import path from "path";
import type { Metadata } from "next";
import type { Member, MemberActivity } from "@/types/member";
import MemberList from "@/components/MemberList";
import CitySummaryCards from "@/components/CitySummaryCards";
import JsonLd from "@/components/JsonLd";
import MinutesWordCloud from "@/components/MinutesWordCloud";
import { getMinutesSummary } from "@/lib/cityStats";
import { getMinutesWordCloud } from "@/lib/minutesWordCloud";
import { getMunicipality } from "@/lib/municipalities";
import { absoluteUrl, buildPageMetadata } from "@/lib/metadata";
import { buildBreadcrumbList } from "@/lib/structuredData";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string }>;
}): Promise<Metadata> {
  const { city } = await params;
  const municipality = getMunicipality(city);
  const name = municipality?.council_name ?? "市町村議会";
  const cityName = municipality?.name ?? city;
  const featureLabels = municipality?.features.includes("minutes")
    ? "議員一覧、議事録"
    : "議員一覧";
  return buildPageMetadata({
    title: name,
    description: `${cityName}議会の${featureLabels}を掲載しています。会派や委員会、話題のテーマも確認できます。`,
    path: `/${city}`,
  });
}

function getMembers(city: string): Member[] {
  try {
    const fp = path.join(process.cwd(), "data", city, "members.json");
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as Member[];
  } catch {
    return [];
  }
}

function getMemberActivity(city: string): Record<string, MemberActivity> {
  try {
    const fp = path.join(process.cwd(), "data", city, "members_activity.json");
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as Record<string, MemberActivity>;
  } catch {
    return {};
  }
}

export default async function CityMembersPage({
  params,
}: {
  params: Promise<{ city: string }>;
}) {
  const { city } = await params;
  const members = getMembers(city);
  const activity = getMemberActivity(city);
  const factions = [...new Set(members.map((m) => m.faction).filter(Boolean))];
  const { count: minutesCount, latestYear } = getMinutesSummary(city);
  const municipality = getMunicipality(city);
  const minutesUnavailable = municipality?.minutes_status === "unavailable";
  const minutesUnavailableNote = municipality?.minutes_status_note;
  const minutesVerifiedAt = municipality?.minutes_verified_at;
  const wordCloud = getMinutesWordCloud(city);
  const councilName = municipality?.council_name ?? `${municipality?.name ?? city}議会`;
  const cityName = municipality?.name ?? city;
  const breadcrumb = buildBreadcrumbList([
    { name: "地方議会ドットコム", path: "/" },
    { name: councilName, path: `/${city}` },
  ]);
  const collectionPage = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${councilName}の議員一覧・議事録`,
    description: `${cityName}議会の議員一覧や議事録の入口ページです。`,
    url: absoluteUrl(`/${city}`),
    isPartOf: {
      "@type": "WebSite",
      name: "地方議会ドットコム",
      url: absoluteUrl("/"),
    },
    about: {
      "@type": "GovernmentOrganization",
      name: councilName,
    },
  };

  if (members.length === 0) {
    return (
      <>
        <JsonLd data={[breadcrumb, collectionPage]} />
        <CitySummaryCards
          memberCount={null}
          minutesCount={minutesCount}
          latestYear={latestYear}
          city={city}
        />
        <div className="page-shell max-w-6xl">
          <section className="mb-4">
            <h2 className="theme-section-title mb-1 text-2xl">議員一覧</h2>
            <p className="text-base text-[#4A5568] leading-relaxed">議員情報は準備中です。</p>
          </section>
          <div className="theme-card px-6 py-8 text-center text-[#718096]">
            現在、議員情報は掲載されていません。
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <JsonLd data={[breadcrumb, collectionPage]} />
      <CitySummaryCards
        memberCount={members.length}
        minutesCount={minutesCount}
        latestYear={latestYear}
        city={city}
      />
      {minutesUnavailable && (
        <div className="theme-alert page-shell mb-5 max-w-6xl px-4 py-3">
          <p className="text-sm font-semibold text-[#1B3A6B] mb-1">議事録未公開（未確認）</p>
          <p className="text-xs text-[#4A5568] leading-relaxed">
            {minutesUnavailableNote ?? "現時点で議会会議録のオンライン公開を確認できていません。"}
            {minutesVerifiedAt && (
              <span className="text-[#718096]">（最終確認: {minutesVerifiedAt}）</span>
            )}
            <br />
            公式サイトで公開されていても確認できていない可能性があります。URLをご存じの方は{" "}
            <a
              href="https://github.com/gyawa24/gikai-map-hokkaido/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-[#1B3A6B]"
            >
              GitHub Issue
            </a>
            でお知らせください。
          </p>
        </div>
      )}
      {!minutesUnavailable && (
        <MinutesWordCloud
          city={city}
          cityName={municipality?.name ?? city}
          modes={wordCloud.modes}
          years={wordCloud.years}
          meetings={wordCloud.meetings}
          scopes={wordCloud.scopes}
          datasets={wordCloud.datasets}
        />
      )}
      <MemberList
        members={members}
        factions={factions}
        activity={activity}
        memberHrefBase={`/${city}/members`}
        minutesHrefBase={`/${city}/minutes`}
      />
      {/* オープンデータ導線（議員名簿 CSV） */}
      <div
        data-no-print="true"
        className="page-shell mt-6 flex max-w-6xl items-center justify-end gap-2 border-t border-[#E2E8F0] pt-4 text-xs text-[#718096]"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        <a
          href={`/api/export/members?city=${city}`}
          download
          className="underline hover:text-[#1B3A6B] transition-colors"
        >
          議員名簿をCSVでダウンロード
        </a>
      </div>
    </>
  );
}
