import fs from "fs";
import path from "path";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import JsonLd from "@/components/JsonLd";
import type { MinutesIndexItem, MinutesEnriched } from "@/types/minutes";
import MinutesIndexClient from "@/components/MinutesIndexClient";
import MinutesSourceLink from "@/components/MinutesSourceLink";
import { hasCityCapability } from "@/lib/cityCapabilities";
import { getMunicipality } from "@/lib/municipalities";
import { absoluteUrl, buildPageMetadata } from "@/lib/metadata";
import { claimsMinutesBodyIsMissing } from "@/lib/minutesPresentation";
import { getMinutesCatalogSource } from "@/lib/minutesSource";
import { getCapabilityCityStaticParams } from "@/lib/staticCityParams";
import { buildBreadcrumbList } from "@/lib/structuredData";
import { hasStructuredMinutes } from "@/lib/structured-minutes/loadStructuredMinutes";

export const dynamicParams = true;
export const dynamic = "force-dynamic";

const REPO_OWNER = process.env.GIKAI_REPO_OWNER ?? "gyawa24";
const REPO_NAME = process.env.GIKAI_REPO_NAME ?? "gikai-map-hokkaido";
const REPO_BRANCH = process.env.GIKAI_REPO_BRANCH ?? "main";
const RAW_BASE = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${REPO_BRANCH}`;

function rawUrl(remotePath: string): string {
  return `${RAW_BASE}/${remotePath}`;
}

type MinutesIndexResult = {
  items: MinutesIndexItem[];
  source: "local" | "remote" | "empty" | "error";
};

export function generateStaticParams() {
  return getCapabilityCityStaticParams("minutes");
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string }>;
}): Promise<Metadata> {
  const { city } = await params;
  const municipality = getMunicipality(city);
  const cityName = municipality?.name ?? city;
  const title = `議事録 - ${cityName}`;
  const description = `${cityName}議会の公式議事録一覧です。本会議や委員会の会議録を年度別・テーマ別に探せます。`;
  return buildPageMetadata({
    title,
    description,
    path: `/${city}/minutes`,
  });
}

async function getMinutesIndex(city: string): Promise<MinutesIndexResult> {
  // 自治体によって data/{city}/minutes/index.json または data/{city}/index.json
  const candidates = [
    path.join(/*turbopackIgnore: true*/ process.cwd(), "data", city, "minutes", "index.json"),
    path.join(/*turbopackIgnore: true*/ process.cwd(), "data", city, "index.json"),
  ];
  for (const fp of candidates) {
    if (!fs.existsSync(/*turbopackIgnore: true*/ fp)) continue;
    try {
      const data = JSON.parse(
        fs.readFileSync(/*turbopackIgnore: true*/ fp, "utf-8")
      ) as MinutesIndexItem[];
      if (Array.isArray(data)) return { items: data, source: "local" };
      return { items: [], source: "error" };
    } catch {
      return { items: [], source: "error" };
    }
  }

  const remoteCandidates = [
    `site/data/${city}/minutes/index.json`,
    `site/data/${city}/index.json`,
  ];
  for (const remotePath of remoteCandidates) {
    try {
      const response = await fetch(rawUrl(remotePath), { cache: "no-store" });
      if (response.status === 404) continue;
      if (!response.ok) return { items: [], source: "error" };
      const data = (await response.json()) as MinutesIndexItem[];
      return Array.isArray(data)
        ? { items: data, source: "remote" }
        : { items: [], source: "error" };
    } catch {
      return { items: [], source: "error" };
    }
  }

  return { items: [], source: "empty" };
}

function getEnriched(city: string, councilId: number): MinutesEnriched | null {
  const fp = path.join(
    /*turbopackIgnore: true*/ process.cwd(),
    "data",
    city,
    "minutes",
    "enriched",
    `${councilId}.json`
  );
  try {
    return JSON.parse(
      fs.readFileSync(/*turbopackIgnore: true*/ fp, "utf-8")
    ) as MinutesEnriched;
  } catch {
    return null;
  }
}

function categoryLabel(typeLabel: string): string {
  if (
    typeLabel.includes("定例会") &&
    !typeLabel.includes("補正") &&
    !typeLabel.includes("委員会")
  )
    return "本会議・定例会";
  if (typeLabel.includes("臨時会")) return "本会議・臨時会";
  if (typeLabel.includes("予算特別委員会")) return "予算特別委員会";
  if (typeLabel.includes("決算特別委員会")) return "決算特別委員会";
  if (typeLabel.includes("委員会")) return "委員会";
  return "その他";
}

export default async function CityMinutesPage({
  params,
}: {
  params: Promise<{ city: string }>;
}) {
  const { city } = await params;
  const municipality = getMunicipality(city);
  if (!municipality) notFound();
  const cityName = municipality?.name ?? city;
  const councilName = municipality.council_name;
  const officialSource = getMinutesCatalogSource(municipality);

  const { items: allItems, source: indexSource } = await getMinutesIndex(city);
  const hasMinutes = hasCityCapability(city, "minutes");
  if (!hasMinutes && allItems.length === 0 && indexSource !== "error") {
    notFound();
  }
  const indexFailed = indexSource === "error" || (indexSource === "empty" && hasMinutes);
  const restricted = municipality.minutes_access === "restricted";

  const items = await Promise.all(
    allItems.map(async (item) => {
      const hasStructured =
        !restricted && indexSource === "local"
          ? await hasStructuredMinutes(city, String(item.council_id))
          : false;
      const enriched = restricted ? null : getEnriched(city, item.council_id);
      return {
        ...item,
        enriched:
          hasStructured && claimsMinutesBodyIsMissing(enriched) ? null : enriched,
        category: categoryLabel(item.type_label),
        hasStructuredMinutes: hasStructured,
      };
    })
  );

  const enrichedCount = items.filter((i) => i.enriched).length;
  const restrictedNote = municipality.minutes_access_note;
  const breadcrumb = buildBreadcrumbList([
    { name: "地方議会ドットコム", path: "/" },
    { name: `${cityName}議会`, path: `/${city}` },
    { name: "議事録", path: `/${city}/minutes` },
  ]);
  const collectionPage = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${cityName}議会の議事録一覧`,
    description: `${cityName}議会の本会議・委員会の議事録一覧ページです。`,
    url: absoluteUrl(`/${city}/minutes`),
    isPartOf: {
      "@type": "WebSite",
      name: "地方議会ドットコム",
      url: absoluteUrl("/"),
    },
    about: {
      "@type": "GovernmentOrganization",
      name: `${cityName}議会`,
    },
  };

  return (
    <div className="page-shell max-w-6xl">
      <JsonLd data={[breadcrumb, collectionPage]} />
      <nav aria-label="パンくず" className="mb-5 flex flex-wrap items-center gap-2 text-sm text-[#4A5568]">
        <Link href="/" prefetch={false} className="inline-flex min-h-11 items-center underline underline-offset-2 hover:text-[#1B3A6B]">トップ</Link>
        <span aria-hidden="true">›</span>
        <Link href={`/${city}`} prefetch={false} className="inline-flex min-h-11 items-center underline underline-offset-2 hover:text-[#1B3A6B]">{councilName}</Link>
        <span aria-hidden="true">›</span>
        <span aria-current="page">議事録</span>
      </nav>
      <section className="mb-5">
        <h1 className="theme-section-title mb-2 text-2xl">{councilName}の議事録</h1>
        <p className="text-base text-[#4A5568] leading-relaxed">
          {restricted
            ? "公式会議録の一覧です。全文は公式ページで確認してください。"
            : "本サイトに収録した公式会議録を、開催日や会議名から探せます。"}
          {enrichedCount > 0 && !restricted && (
            <span className="text-sm text-[#4A5568]">
              {" "}（{enrichedCount}件にAI要約・タグあり）
            </span>
          )}
        </p>
        {!indexFailed && <p className="mt-2 text-sm text-[#4A5568]">収録 {items.length}件。未収録の会議もあります。開催日は確認できた精度で表示しています。</p>}
        <div className="mt-2"><MinutesSourceLink source={officialSource} /></div>
      </section>

      {restricted && (
        <div className="theme-alert mb-5 px-4 py-3">
          <p className="text-sm font-semibold text-[#7A5A00] mb-1">本サイトでの全文閲覧は一時停止中です</p>
          <p className="text-sm text-[#5A4500] leading-relaxed">
            {restrictedNote ?? `${cityName}公式サイトの著作権ポリシーで複製・転用に事前許可を要する旨が明記されているため、許諾確認が取れるまで本サイトでの全文閲覧を停止しています。データは保管しており、許諾後に公開を再開します。`}
          </p>
        </div>
      )}

      {indexFailed ? (
        <div role="alert" className="rounded-lg border border-[#E6C566] bg-[#FFF7E6] px-5 py-5 text-[#78451F]">
          <p className="font-semibold">議事録一覧を読み込めませんでした</p>
          <p className="mt-2 text-sm leading-relaxed">掲載状況を確認できない状態です。時間をおいて再読み込みするか、公式会議録ページでご確認ください。</p>
          <a href={`/${city}/minutes`} className="mt-3 inline-flex min-h-11 items-center font-medium underline underline-offset-2">一覧を再読み込みする</a>
        </div>
      ) : items.length === 0 ? (
        <div className="theme-card px-6 py-8 text-center text-[#718096]">
          現在、掲載されている議事録はありません。
        </div>
      ) : (
        <MinutesIndexClient
          items={items}
          city={city}
          minutesBasePath={`/${city}/minutes`}
          restricted={restricted}
        />
      )}
    </div>
  );
}
