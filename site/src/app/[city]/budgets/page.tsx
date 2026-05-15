import Link from "next/link";
import type { Metadata } from "next";
import JsonLd from "@/components/JsonLd";
import { getBudgetDocuments } from "@/lib/budgets";
import { getMunicipality } from "@/lib/municipalities";
import { buildPageMetadata } from "@/lib/metadata";
import { buildBreadcrumbList } from "@/lib/structuredData";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string }>;
}): Promise<Metadata> {
  const { city } = await params;
  const municipality = getMunicipality(city);
  const cityName = municipality?.name ?? city;
  return buildPageMetadata({
    title: `${cityName}の予算書`,
    description: `${cityName}の予算書をページ単位で検索・閲覧できます。`,
    path: `/${city}/budgets`,
  });
}

export default async function BudgetsPage({
  params,
}: {
  params: Promise<{ city: string }>;
}) {
  const { city } = await params;
  const municipality = getMunicipality(city);
  const cityName = municipality?.name ?? city;
  const councilName = municipality?.council_name ?? `${cityName}議会`;
  const documents = getBudgetDocuments(city);
  const breadcrumb = buildBreadcrumbList([
    { name: "地方議会ドットコム", path: "/" },
    { name: councilName, path: `/${city}` },
    { name: "予算書", path: `/${city}/budgets` },
  ]);

  return (
    <div className="page-shell max-w-6xl">
      <JsonLd data={breadcrumb} />
      <nav className="mb-5 flex items-center gap-1.5 text-sm text-[#718096]">
        <Link href={`/${city}`} className="hover:text-[#1B3A6B]">
          {councilName}
        </Link>
        <span>/</span>
        <span>予算書</span>
      </nav>

      <header className="mb-6">
        <h1 className="theme-section-title text-2xl">{cityName}の予算書</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[#4A5568]">
          予算書をページ画像で閲覧しながら、OCRで抽出した文字を検索できる試作ページです。金額や表の正確な確認は原本画像を基準にしてください。
        </p>
      </header>

      {documents.length === 0 ? (
        <div className="theme-card px-6 py-10 text-center text-[#718096]">
          現在、この市町村の予算書データは準備中です。
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {documents.map((document) => (
            <Link
              key={document.year}
              href={`/${city}/budgets/${document.year}`}
              className="theme-card flex min-h-[11rem] flex-col justify-between px-5 py-5 transition-all duration-150 hover:border-[#9FB1D2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8AA3CF]"
            >
              <span>
                <span className="theme-pill-soft mb-3">{document.fiscal_year_label}</span>
                <span className="block text-lg font-black text-[#1B3A6B]">{document.title}</span>
                <span className="mt-2 block text-sm leading-relaxed text-[#4A5568]">
                  {document.page_count.toLocaleString()}ページを検索用テキストとして取り込んでいます。
                </span>
              </span>
              <span className="mt-5 inline-flex text-sm font-black text-[#2A5298]">
                開いて検索する
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
