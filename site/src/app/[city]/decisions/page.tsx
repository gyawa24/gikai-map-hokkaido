import fs from "fs";
import path from "path";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { Decision } from "@/types/decision";
import { getMunicipality } from "@/lib/municipalities";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string }>;
}): Promise<Metadata> {
  const { city } = await params;
  const municipality = getMunicipality(city);
  const cityName = municipality?.name ?? city;
  return { title: `議決結果 - ${cityName}` };
}

function getDecisions(city: string): Decision[] {
  const fp = path.join(process.cwd(), "data", city, "decisions.json");
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as Decision[];
  } catch {
    return [];
  }
}

function extractPeriod(description: string): string {
  const m = description.match(/（(.{1,4}月)）|\((.{1,4}月)\)/);
  if (m) return m[1] ?? m[2];
  return "";
}

function shortTitle(title: string): string {
  return title
    .replace(/\s*（PDF.+?）/, "")
    .replace(/\s*\(PDF.+?\)/, "")
    .trim();
}

export default async function CityDecisionsPage({
  params,
}: {
  params: Promise<{ city: string }>;
}) {
  const { city } = await params;
  const municipality = getMunicipality(city);
  if (!municipality?.features.includes("decisions")) notFound();

  const decisions = getDecisions(city);

  return (
    <div className="page-shell max-w-6xl">
      <div className="mb-5">
        <h2 className="theme-section-title text-2xl">議決結果</h2>
        <p className="text-sm text-[#4A5568] mt-1">
          直近4回の定例会の議決結果PDFを掲載しています。
        </p>
      </div>

      {decisions.length === 0 ? (
        <div className="theme-card px-6 py-8 text-center text-[#718096]">
          現在、掲載されている議決結果はありません。
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {decisions.map((d) => {
            const period = extractPeriod(d.description);
            return (
              <div
                key={d.session}
                className="theme-card p-6"
              >
                <div className="flex flex-wrap items-center gap-3 mb-4">
                  <h3 className="text-base font-bold text-gray-900">
                    {d.session}
                  </h3>
                  {period && (
                    <span className="theme-pill-soft text-blue-700">
                      {period}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap gap-3">
                  {d.pdf_links.map((link) => (
                    <a
                      key={link.url}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="theme-button theme-button-accent px-4 py-2 text-sm font-medium"
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
                      {shortTitle(link.title)}
                    </a>
                  ))}

                  <a
                    href={d.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="theme-button px-4 py-2 text-sm text-[#718096] hover:text-[#1B3A6B]"
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
            );
          })}
        </div>
      )}
    </div>
  );
}
