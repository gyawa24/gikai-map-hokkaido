import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import BudgetDocumentClient from "@/components/BudgetDocumentClient";
import JsonLd from "@/components/JsonLd";
import { getBudgetDocument, getBudgetPages } from "@/lib/budgets";
import { getMunicipality } from "@/lib/municipalities";
import { buildPageMetadata } from "@/lib/metadata";
import { buildBreadcrumbList } from "@/lib/structuredData";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string; year: string }>;
}): Promise<Metadata> {
  const { city, year } = await params;
  const municipality = getMunicipality(city);
  const document = getBudgetDocument(city, year);
  const cityName = municipality?.name ?? city;
  return buildPageMetadata({
    title: document?.title ?? `${cityName}の予算書`,
    description: document
      ? `${document.title}をページ単位で検索・閲覧できます。`
      : `${cityName}の予算書をページ単位で検索・閲覧できます。`,
    path: `/${city}/budgets/${year}`,
  });
}

export default async function BudgetDocumentPage({
  params,
}: {
  params: Promise<{ city: string; year: string }>;
}) {
  const { city, year } = await params;
  const municipality = getMunicipality(city);
  const document = getBudgetDocument(city, year);
  if (!document) notFound();

  const pages = getBudgetPages(city, year);
  const cityName = municipality?.name ?? city;
  const councilName = municipality?.council_name ?? `${cityName}議会`;
  const breadcrumb = buildBreadcrumbList([
    { name: "地方議会ドットコム", path: "/" },
    { name: councilName, path: `/${city}` },
    { name: "予算書", path: `/${city}/budgets` },
    { name: document.title, path: `/${city}/budgets/${year}` },
  ]);

  return (
    <div className="page-shell max-w-7xl">
      <JsonLd data={breadcrumb} />
      <nav className="mb-5 flex flex-wrap items-center gap-1.5 text-sm text-[#718096]">
        <Link href={`/${city}`} className="hover:text-[#1B3A6B]">
          {councilName}
        </Link>
        <span>/</span>
        <Link href={`/${city}/budgets`} className="hover:text-[#1B3A6B]">
          予算書
        </Link>
        <span>/</span>
        <span>{document.fiscal_year_label}</span>
      </nav>

      <header className="mb-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="theme-pill-soft">{document.fiscal_year_label}</span>
          <span className="theme-pill-soft">全{document.page_count.toLocaleString()}ページ</span>
          <span className="theme-pill-soft">OCR検索</span>
        </div>
        <h1 className="theme-section-title text-2xl">{document.title}</h1>
        <p className="mt-2 max-w-4xl text-sm leading-relaxed text-[#4A5568]">
          予算書のページ画像を見ながら、OCRで抽出した文字を検索できます。A3表のOCRなので、検索結果は入口として使い、数字・費目名・表の行位置は原本画像で確認してください。
        </p>
      </header>

      <BudgetDocumentClient pages={pages} pageCount={document.page_count} />
    </div>
  );
}
