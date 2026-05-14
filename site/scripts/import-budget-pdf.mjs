import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [pdfPath, city, year, fiscalYearLabel, titleArg] = process.argv.slice(2);

if (!pdfPath || !city || !year || !fiscalYearLabel) {
  console.error("Usage: node scripts/import-budget-pdf.mjs <pdfPath> <city> <year> <fiscalYearLabel> [title]");
  process.exit(1);
}

const siteRoot = process.cwd();
const outDir = path.join(siteRoot, "data", city, "budgets", year);
const pagesDir = path.join(outDir, "pages");
const indexPath = path.join(siteRoot, "data", city, "budgets", "index.json");

fs.mkdirSync(pagesDir, { recursive: true });

function getCityName(slug) {
  try {
    const municipalities = JSON.parse(
      fs.readFileSync(path.join(siteRoot, "data", "municipalities.json"), "utf-8")
    );
    const entry = municipalities.find((item) => item.slug === slug);
    return entry?.name ?? slug;
  } catch {
    return slug;
  }
}

const text = execFileSync("pdftotext", ["-layout", pdfPath, "-"], {
  encoding: "utf-8",
  maxBuffer: 50 * 1024 * 1024,
});

const pages = text
  .split("\f")
  .map((pageText) => pageText.replace(/\s+$/g, ""));

if (pages.length > 0 && pages[pages.length - 1].trim().length === 0) {
  pages.pop();
}

for (const file of fs.readdirSync(pagesDir)) {
  if (file.endsWith(".md")) fs.rmSync(path.join(pagesDir, file));
}

const pageSummaries = pages.map((pageText, index) => {
  const page = index + 1;
  const fileName = `page-${String(page).padStart(3, "0")}.md`;
  const normalized = pageText
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+$/gm, "");
  const firstUsefulLine = normalized
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length >= 3 && !/^-?\d+-?$/.test(line));
  const preview = normalized.replace(/\s+/g, " ").trim().slice(0, 180);

  fs.writeFileSync(
    path.join(pagesDir, fileName),
    `---\npage: ${page}\nsource: ${path.basename(pdfPath)}\n---\n\n${normalized}\n`,
    "utf-8"
  );

  return {
    page,
    file: `pages/${fileName}`,
    title: firstUsefulLine ?? `${page}ページ`,
    preview,
    text_length: normalized.length,
  };
});

const stat = fs.statSync(pdfPath);
const manifest = {
  city,
  year,
  fiscal_year_label: fiscalYearLabel,
  title: titleArg ?? `${fiscalYearLabel} ${getCityName(city)} 予算書`,
  source_file_name: path.basename(pdfPath),
  source_file_size_bytes: stat.size,
  source_pdf_available: false,
  page_count: pageSummaries.length,
  generated_at: new Date().toISOString(),
  pages: pageSummaries,
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf-8");

let index = [];
try {
  index = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
  if (!Array.isArray(index)) index = [];
} catch {}

const indexItem = {
  year,
  fiscal_year_label: fiscalYearLabel,
  title: manifest.title,
  page_count: manifest.page_count,
  generated_at: manifest.generated_at,
  source_pdf_available: manifest.source_pdf_available,
};
const nextIndex = [indexItem, ...index.filter((item) => item.year !== year)].sort((a, b) =>
  a.year < b.year ? 1 : a.year > b.year ? -1 : 0
);
fs.mkdirSync(path.dirname(indexPath), { recursive: true });
fs.writeFileSync(indexPath, JSON.stringify(nextIndex, null, 2) + "\n", "utf-8");

console.log(`Imported ${pageSummaries.length} pages to ${outDir}`);
