import fs from "fs";
import path from "path";
import type { Metadata } from "next";
import JsonLd from "@/components/JsonLd";
import type { MinutesIndexItem, MinutesEnriched } from "@/types/minutes";
import MinutesIndexClient from "@/components/MinutesIndexClient";
import { getMunicipality } from "@/lib/municipalities";
import { absoluteUrl, buildPageMetadata } from "@/lib/metadata";
import { buildBreadcrumbList } from "@/lib/structuredData";
import { hasStructuredMinutes } from "@/lib/structured-minutes/loadStructuredMinutes";

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

function getMinutesIndex(city: string): MinutesIndexItem[] {
  // 自治体によって data/{city}/minutes/index.json または data/{city}/index.json
  const candidates = [
    path.join(/*turbopackIgnore: true*/ process.cwd(), "data", city, "minutes", "index.json"),
    path.join(/*turbopackIgnore: true*/ process.cwd(), "data", city, "index.json"),
  ];
  for (const fp of candidates) {
    try {
      const data = JSON.parse(
        fs.readFileSync(/*turbopackIgnore: true*/ fp, "utf-8")
      ) as MinutesIndexItem[];
      if (Array.isArray(data)) return data;
    } catch {
      // try next
    }
  }
  return [];
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
  const cityName = municipality?.name ?? city;

  const allItems = getMinutesIndex(city);
  const items = await Promise.all(
    allItems.map(async (item) => ({
      ...item,
      enriched: getEnriched(city, item.council_id),
      category: categoryLabel(item.type_label),
      hasStructuredMinutes: await hasStructuredMinutes(city, String(item.council_id)),
    }))
  );

  const enrichedCount = items.filter((i) => i.enriched).length;
  const restricted = municipality?.minutes_access === "restricted";
  const restrictedNote = municipality?.minutes_access_note;
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
      <section className="mb-5">
        <h2 className="theme-section-title mb-1 text-2xl">公式議事録</h2>
        <p className="text-base text-[#4A5568] leading-relaxed">
          {cityName}議会の公式会議録です。本会議・委員会の発言内容をすべて収録しています。
          {enrichedCount > 0 && !restricted && (
            <span className="text-sm text-[#718096]">
              {" "}（{enrichedCount}件にAI要約・タグあり）
            </span>
          )}
        </p>
      </section>

      {restricted && (
        <div className="theme-alert mb-5 px-4 py-3">
          <p className="text-sm font-semibold text-[#7A5A00] mb-1">本サイトでの全文閲覧は一時停止中です</p>
          <p className="text-xs text-[#5A4500] leading-relaxed">
            {restrictedNote ?? `${cityName}公式サイトの著作権ポリシーで複製・転用に事前許可を要する旨が明記されているため、許諾確認が取れるまで本サイトでの全文閲覧を停止しています。データは保管しており、許諾後に公開を再開します。`}
            <br />
            会議録本体は{" "}
            <a
              href="https://github.com/gyawa24/gikai-map-hokkaido/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-[#7A5A00]"
            >
              {cityName}議会事務局
            </a>
            の公式ページからご覧ください。
          </p>
        </div>
      )}

      {items.length === 0 ? (
        <div className="theme-card px-6 py-8 text-center text-[#718096]">
          現在、掲載されている議事録はありません。
        </div>
      ) : (
        <MinutesIndexClient
          items={items}
          minutesBasePath={`/${city}/minutes`}
          restricted={restricted}
        />
      )}
    </div>
  );
}
