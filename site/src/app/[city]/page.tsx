import fs from "fs";
import path from "path";
import Link from "next/link";
import type { Metadata } from "next";
import type { Member, MemberActivity } from "@/types/member";
import MemberList from "@/components/MemberList";
import CitySummaryCards from "@/components/CitySummaryCards";
import CityDataStatus from "@/components/CityDataStatus";
import JsonLd from "@/components/JsonLd";
import { getMinutesSummary } from "@/lib/cityStats";
import { getCityCapability, hasCityCapability } from "@/lib/cityCapabilities";
import { withPublicMemberPhotoUrls } from "@/lib/memberPhotos";
import { getMunicipality } from "@/lib/municipalities";
import { absoluteUrl, buildPageMetadata } from "@/lib/metadata";
import { getActiveCityStaticParams } from "@/lib/staticCityParams";
import { buildBreadcrumbList } from "@/lib/structuredData";

export const dynamicParams = false;

export function generateStaticParams() {
  return getActiveCityStaticParams();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string }>;
}): Promise<Metadata> {
  const { city } = await params;
  const municipality = getMunicipality(city);
  const name = municipality?.council_name ?? "市町村議会";
  const cityName = municipality?.name ?? city;
  const featureLabels = hasCityCapability(city, "minutes")
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
    return withPublicMemberPhotoUrls(JSON.parse(fs.readFileSync(fp, "utf-8")) as Member[]);
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

function getMemberActivitySummary(city: string): Record<string, Pick<MemberActivity, "session_count" | "themes">> {
  const activity = getMemberActivity(city);
  return Object.fromEntries(
    Object.entries(activity).map(([key, value]) => [
      key,
      {
        session_count: value.session_count,
        themes: value.themes,
      },
    ])
  );
}

function CityExploreLinks({
  city,
  cityName,
  hasMembers,
  hasMinutes,
  hasThemes,
}: {
  city: string;
  cityName: string;
  hasMembers: boolean;
  hasMinutes: boolean;
  hasThemes: boolean;
}) {
  const links = [
    {
      href: `/${city}#members`,
      label: "議員を見る",
      description: "議員名、会派、委員会から探す",
      enabled: hasMembers,
      icon: (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      ),
    },
    {
      href: `/${city}/minutes`,
      label: "議事録を見る",
      description: "会議名や年度から公式議事録へ",
      enabled: hasMinutes,
      icon: (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
      ),
    },
    {
      href: `/${city}/themes`,
      label: "テーマから探す",
      description: "政策テーマ別に議員の発言を見る",
      enabled: hasThemes,
      icon: (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20.59 13.41 12 22l-8.59-8.59A2 2 0 0 1 3 12V4a1 1 0 0 1 1-1h8a2 2 0 0 1 1.41.59l7.18 7.18a2 2 0 0 1 0 2.83Z" />
          <circle cx="7.5" cy="7.5" r="1.5" />
        </svg>
      ),
    },
    {
      href: `/search?city=${city}&cityName=${encodeURIComponent(cityName)}`,
      label: "この市町村内を検索",
      description: `${cityName}に絞って横断検索する`,
      enabled: true,
      icon: (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      ),
    },
  ].filter((link) => link.enabled);

  if (links.length === 0) return null;

  return (
    <section className="page-shell mb-4 max-w-5xl sm:mb-5">
      <div className="mb-2 sm:mb-3">
        <h2 className="theme-section-title text-lg sm:text-2xl">この市町村で探す</h2>
        <p className="mt-1 hidden text-sm leading-relaxed text-[#4A5568] sm:block">
          まずは入口を選んでください。議員、議事録、テーマ、市町村内検索をここにまとめました。
        </p>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="flex min-h-12 items-center gap-3 rounded-lg border border-[#CBD5E0] bg-white px-3 py-3 transition-colors hover:border-[#9FB1D2] hover:bg-[#F8FBFF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8AA3CF] sm:min-h-[8rem] sm:flex-col sm:items-start sm:justify-between sm:px-4 sm:py-4"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#D7E1F0] bg-[#F4F8FF] text-[#1B3A6B] sm:h-9 sm:w-9">
              {link.icon}
            </span>
            <span className="min-w-0">
              <span className="block text-base font-black text-[#1B3A6B]">{link.label}</span>
              <span className="mt-1 hidden text-xs leading-relaxed text-[#718096] sm:block">{link.description}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

export default async function CityMembersPage({
  params,
}: {
  params: Promise<{ city: string }>;
}) {
  const { city } = await params;
  const members = getMembers(city);
  const activity = getMemberActivitySummary(city);
  const factions = [...new Set(members.map((m) => m.faction).filter(Boolean))];
  const { count: minutesCount, latestYear } = getMinutesSummary(city);
  const municipality = getMunicipality(city);
  const capability = getCityCapability(city);
  const minutesUnavailable = municipality?.minutes_status === "unavailable";
  const minutesUnavailableNote = municipality?.minutes_status_note;
  const minutesVerifiedAt = municipality?.minutes_verified_at;
  const councilName = municipality?.council_name ?? `${municipality?.name ?? city}議会`;
  const cityName = municipality?.name ?? city;
  const hasThemes = Object.keys(activity).length > 0;
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
        <CityExploreLinks
          city={city}
          cityName={cityName}
          hasMembers={false}
          hasMinutes={capability.capabilities.minutes}
          hasThemes={capability.capabilities.themes || hasThemes}
        />
        <CityDataStatus municipality={municipality} />
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
      <CityExploreLinks
        city={city}
        cityName={cityName}
        hasMembers={members.length > 0}
        hasMinutes={capability.capabilities.minutes}
        hasThemes={capability.capabilities.themes || hasThemes}
      />
      <CityDataStatus municipality={municipality} />
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
      <div id="members" className="scroll-mt-24">
        <MemberList
          members={members}
          factions={factions}
          activity={activity}
          memberHrefBase={`/${city}/members`}
        />
      </div>
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
          href={`/generated/open-data/members/${city}.csv`}
          download
          className="underline hover:text-[#1B3A6B] transition-colors"
        >
          議員名簿をCSVでダウンロード
        </a>
      </div>
    </>
  );
}
