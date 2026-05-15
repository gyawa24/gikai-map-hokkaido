import fs from "fs";
import path from "path";

export type BudgetDocumentSummary = {
  year: string;
  fiscal_year_label: string;
  title: string;
  page_count: number;
  generated_at: string;
  source_pdf_available?: boolean;
};

export type BudgetDocumentManifest = BudgetDocumentSummary & {
  city: string;
  source_file_name: string;
  source_file_size_bytes: number;
  page_images_available?: boolean;
  page_image_format?: string;
  page_image_dpi?: number;
  toc_sections_source?: string;
  toc_sections?: BudgetTocSection[];
  pages: BudgetPageSummary[];
};

export type BudgetTocSection = {
  label: string;
  pdf_page_start: number;
  pdf_page_end: number;
  printed_page_start?: number | null;
};

export type BudgetPageSummary = {
  page: number;
  file: string;
  title: string;
  preview: string;
  text_length: number;
  image?: string;
  toc_label?: string | null;
  toc_printed_page_start?: number | null;
};

export type BudgetPage = BudgetPageSummary & {
  text: string;
};

type BudgetSource = {
  slug: string;
  year: string;
  status: string;
  source_label?: string;
  source_href?: string;
  note?: string;
};

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

export function getBudgetDocuments(city: string): BudgetDocumentSummary[] {
  const fp = path.join(/*turbopackIgnore: true*/ process.cwd(), "data", city, "budgets", "index.json");
  const documents = readJson<BudgetDocumentSummary[]>(fp);
  return Array.isArray(documents) ? documents : [];
}

export function getBudgetStaticParams(): { city: string; year: string }[] {
  const fp = path.join(process.cwd(), "data", "budget_sources.json");
  const sources = readJson<BudgetSource[]>(fp);
  if (!Array.isArray(sources)) return [];
  return sources
    .filter((source) => source.status === "取込済み")
    .map((source) => ({ city: source.slug, year: source.year }));
}

export function getBudgetDocument(city: string, year: string): BudgetDocumentManifest | null {
  const fp = path.join(/*turbopackIgnore: true*/ process.cwd(), "data", city, "budgets", year, "manifest.json");
  return readJson<BudgetDocumentManifest>(fp);
}

export function getBudgetSource(city: string, year: string): BudgetSource | null {
  const fp = path.join(process.cwd(), "data", "budget_sources.json");
  const sources = readJson<BudgetSource[]>(fp);
  if (!Array.isArray(sources)) return null;
  return sources.find((source) => source.slug === city && source.year === year) ?? null;
}
