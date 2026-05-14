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

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

function stripMarkdownFrontmatter(text: string): string {
  return text.replace(/^---\n[\s\S]*?\n---\n\n?/, "");
}

export function getBudgetDocuments(city: string): BudgetDocumentSummary[] {
  const fp = path.join(/*turbopackIgnore: true*/ process.cwd(), "data", city, "budgets", "index.json");
  const documents = readJson<BudgetDocumentSummary[]>(fp);
  return Array.isArray(documents) ? documents : [];
}

export function getBudgetDocument(city: string, year: string): BudgetDocumentManifest | null {
  const fp = path.join(/*turbopackIgnore: true*/ process.cwd(), "data", city, "budgets", year, "manifest.json");
  return readJson<BudgetDocumentManifest>(fp);
}

export function getBudgetPages(city: string, year: string): BudgetPage[] {
  const manifest = getBudgetDocument(city, year);
  if (!manifest) return [];
  const baseDir = path.join(/*turbopackIgnore: true*/ process.cwd(), "data", city, "budgets", year);

  return manifest.pages.map((page) => {
    try {
      const text = fs.readFileSync(path.join(baseDir, page.file), "utf-8");
      return {
        ...page,
        text: stripMarkdownFrontmatter(text).trimEnd(),
      };
    } catch {
      return {
        ...page,
        text: "",
      };
    }
  });
}
