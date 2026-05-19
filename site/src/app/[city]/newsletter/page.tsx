import fs from "fs";
import path from "path";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { Newsletter } from "@/types/newsletter";
import { hasCityCapability } from "@/lib/cityCapabilities";
import { getMunicipality } from "@/lib/municipalities";
import { buildPageMetadata } from "@/lib/metadata";
import { getCapabilityCityStaticParams } from "@/lib/staticCityParams";

export const dynamicParams = false;

export function generateStaticParams() {
  return getCapabilityCityStaticParams("newsletter");
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string }>;
}): Promise<Metadata> {
  const { city } = await params;
  const municipality = getMunicipality(city);
  const cityName = municipality?.name ?? city;
  return buildPageMetadata({
    title: `議会だより - ${cityName}`,
    description: `${cityName}議会だよりの最新号と公式PDFへのリンクを掲載しています。議会活動や審議内容の概要を確認できます。`,
    path: `/${city}/newsletter`,
  });
}

function getNewsletter(city: string): Newsletter | null {
  const fp = path.join(process.cwd(), "data", city, "newsletter.json");
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as Newsletter;
  } catch {
    return null;
  }
}

function parsePdfTitle(title: string): { label: string; size: string } {
  const labelMatch = title.match(/(No\.\d+)/);
  const sizeMatch = title.match(/PDF\s*([\d.]+\s*[KMG]B)/i);
  return {
    label: labelMatch ? labelMatch[1] : title,
    size: sizeMatch ? sizeMatch[1] : "",
  };
}

function parseTitle(title: string): { number: string; session: string } {
  const numMatch = title.match(/第(\d+)号/);
  const sessionMatch = title.match(/[（(](.+?)[）)]/);
  return {
    number: numMatch ? `第${numMatch[1]}号` : "",
    session: sessionMatch ? sessionMatch[1] : "",
  };
}

export default async function CityNewsletterPage({
  params,
}: {
  params: Promise<{ city: string }>;
}) {
  const { city } = await params;
  const municipality = getMunicipality(city);
  if (!municipality || !hasCityCapability(city, "newsletter")) notFound();

  const cityName = municipality.name;
  const nl = getNewsletter(city);

  if (!nl) {
    return (
      <div className="page-shell max-w-3xl">
        <div className="mb-6">
          <h2 className="text-lg font-bold text-[#1B3A6B]">議会だより</h2>
          <p className="text-sm text-[#4A5568] mt-1">
            {cityName}議会だよりの最新号を掲載しています。
          </p>
        </div>
        <div className="theme-card px-6 py-8 text-center text-[#718096]">
          現在、掲載されている議会だよりはありません。
        </div>
      </div>
    );
  }

  const { number, session } = parseTitle(nl.title);
  const { label: pdfLabel, size: pdfSize } = parsePdfTitle(nl.pdf_title);

  return (
    <div className="page-shell max-w-3xl">
      <div className="mb-6">
        <h2 className="text-lg font-bold text-[#1B3A6B]">議会だより</h2>
        <p className="text-sm text-[#4A5568] mt-1">
          {cityName}議会だよりの最新号を掲載しています。
        </p>
      </div>

      <div className="theme-panel px-5 py-5 sm:px-6">
        <div className="flex flex-wrap gap-2 mb-4">
          <span className="text-xs font-semibold bg-blue-50 text-blue-700 rounded-full px-3 py-0.5">
            最新号
          </span>
          {session && (
            <span className="text-xs bg-gray-100 text-gray-600 rounded-full px-3 py-0.5">
              {session}
            </span>
          )}
        </div>

        <h3 className="text-xl font-bold text-gray-900 mb-1">
          {cityName}議会だより{number}
        </h3>
        <p className="text-sm text-[#718096] mb-6">発行: {nl.published_date}</p>

        <div className="flex flex-wrap gap-3">
          <a
            href={nl.pdf_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full bg-[#1a3a6c] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#254d8f]"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-4 h-4 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="12" y1="18" x2="12" y2="12" />
              <line x1="9" y1="15" x2="15" y2="15" />
            </svg>
            {pdfLabel} をダウンロード
            {pdfSize && (
              <span className="text-blue-200 text-xs">{pdfSize}</span>
            )}
          </a>

          <a
            href={nl.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full border border-[#CBD5E0] px-4 py-2.5 text-sm text-[#718096] transition-colors hover:text-[#1B3A6B]"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-3.5 h-3.5 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            公式ページ
          </a>
        </div>
      </div>
    </div>
  );
}
