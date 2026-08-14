import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import ResearchAccessGate, {
  ResearchLogoutButton,
} from "@/components/research/ResearchAccessGate";
import ResearchBudgetComparisonDemo from "@/components/research/ResearchBudgetComparisonDemo";
import ResearchClient from "@/components/research/ResearchClient";
import ResearchNotice from "@/components/research/ResearchNotice";
import { getBudgetComparisonDemo } from "@/lib/budgetComparisonDemo";
import { getBudgetResearchMunicipalityIds } from "@/lib/budgetResearch";
import { buildPageMetadata } from "@/lib/metadata";
import { getMunicipalities } from "@/lib/municipalities";
import {
  getResearchAuthConfig,
  RESEARCH_SESSION_COOKIE_NAME,
  verifyResearchSessionToken,
} from "@/lib/researchAuth";
import { getResearchCoverageMunicipalityIds } from "@/lib/researchCoverage";

const description =
  "北海道内の地方議会で議論された政策テーマと5市の予算データを、原文根拠付きで調査するパスワード保護された実証用ツールです。";

export const metadata: Metadata = {
  ...buildPageMetadata({
    title: "北海道・議会政策AIリサーチャー",
    description,
    path: "/research",
  }),
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
    },
  },
};

export const dynamic = "force-dynamic";

export default async function ResearchPage() {
  const authConfig = getResearchAuthConfig();
  const sessionToken = (await cookies()).get(RESEARCH_SESSION_COOKIE_NAME)?.value;
  const authenticated = authConfig
    ? await verifyResearchSessionToken(sessionToken, authConfig)
    : false;

  if (!authenticated) {
    return (
      <article className="page-shell max-w-5xl">
        <nav className="mb-5 text-sm font-bold text-[#718096]" aria-label="パンくず">
          <Link href="/" className="text-[#2A5298] hover:underline">
            トップ
          </Link>
          <span className="mx-2" aria-hidden="true">
            /
          </span>
          <span>政策AIリサーチャー</span>
        </nav>
        <header className="mb-6 border-l-4 border-[#F7C948] pl-4">
          <p className="portal-subhead mb-3">POLICY AI RESEARCHER</p>
          <h1 className="text-2xl font-black leading-tight text-[#1B3A6B] sm:text-3xl">
            北海道・議会政策AIリサーチャー
          </h1>
        </header>
        <ResearchAccessGate configured={Boolean(authConfig)} />
      </article>
    );
  }

  const minutesMunicipalities = getResearchCoverageMunicipalityIds();
  const budgetMunicipalities = getBudgetResearchMunicipalityIds();
  const budgetComparisonDemo = getBudgetComparisonDemo();
  const municipalities = getMunicipalities()
    .filter(
      (municipality) =>
        municipality.active &&
        ((municipality.minutes_access !== "restricted" &&
          minutesMunicipalities.has(municipality.slug)) ||
          budgetMunicipalities.has(municipality.slug)),
    )
    .sort((left, right) => {
      const regionOrder = left.region.localeCompare(right.region, "ja");
      return regionOrder !== 0
        ? regionOrder
        : left.furigana.localeCompare(right.furigana, "ja");
    })
    .map(({ slug, name, region, minutes_access: minutesAccess }) => ({
      slug,
      name,
      region,
      sourceTypes: [
        ...(minutesAccess !== "restricted" && minutesMunicipalities.has(slug)
          ? (["plenary_minutes"] as const)
          : []),
        ...(budgetMunicipalities.has(slug) ? (["budget"] as const) : []),
      ],
    }));

  return (
    <article className="page-shell max-w-5xl">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <nav className="text-sm font-bold text-[#718096]" aria-label="パンくず">
          <Link href="/" className="text-[#2A5298] hover:underline">
            トップ
          </Link>
          <span className="mx-2" aria-hidden="true">
            /
          </span>
          <span>政策AIリサーチャー</span>
        </nav>
        <ResearchLogoutButton />
      </div>

      <header className="mb-6 border-l-4 border-[#F7C948] pl-4">
        <p className="portal-subhead mb-3">POLICY AI RESEARCHER</p>
        <h1 className="text-2xl font-black leading-tight text-[#1B3A6B] sm:text-3xl">
          北海道・議会政策AIリサーチャー
        </h1>
        <p className="mt-3 text-base leading-relaxed text-[#1A202C] sm:text-lg">
          北海道の議会で何が議論されたか、5市の予算がどう変化したかを、原文根拠付きで調査します。
        </p>
        <p className="mt-2 text-sm leading-relaxed text-[#4A5568]">
          本会議議事録の検索に加え、5市のR7・R8予算をパスワード保護された限定テストとして確認できます。
        </p>
      </header>

      <ResearchNotice />
      <ResearchBudgetComparisonDemo cities={budgetComparisonDemo} />
      <ResearchClient municipalities={municipalities} />
    </article>
  );
}
