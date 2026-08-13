import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import ResearchAccessGate, {
  ResearchLogoutButton,
} from "@/components/research/ResearchAccessGate";
import ResearchClient from "@/components/research/ResearchClient";
import ResearchNotice from "@/components/research/ResearchNotice";
import { buildPageMetadata } from "@/lib/metadata";
import { getMunicipalities } from "@/lib/municipalities";
import {
  getResearchAuthConfig,
  RESEARCH_SESSION_COOKIE_NAME,
  verifyResearchSessionToken,
} from "@/lib/researchAuth";
import { getResearchCoverageMunicipalityIds } from "@/lib/researchCoverage";

const description =
  "北海道内の地方議会で議論された政策テーマを、収録済みの議事録から原文根拠付きで横断調査する実証用ツールです。";

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

  const searchableMunicipalities = getResearchCoverageMunicipalityIds();
  const municipalities = getMunicipalities()
    .filter(
      (municipality) =>
        municipality.active &&
        municipality.minutes_access !== "restricted" &&
        searchableMunicipalities.has(municipality.slug),
    )
    .sort((left, right) => {
      const regionOrder = left.region.localeCompare(right.region, "ja");
      return regionOrder !== 0
        ? regionOrder
        : left.furigana.localeCompare(right.furigana, "ja");
    })
    .map(({ slug, name, region }) => ({ slug, name, region }));

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
          北海道の議会で、何が、どのように議論されてきたかを、原文根拠付きで横断調査します。
        </p>
        <p className="mt-2 text-sm leading-relaxed text-[#4A5568]">
          現在の実証版は、地方議会ドットコムに収録済みの本会議議事録を対象としています。
        </p>
      </header>

      <ResearchNotice />
      <ResearchClient municipalities={municipalities} />
    </article>
  );
}
