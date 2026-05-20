import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [pdfPath, city, year, fiscalYearLabel, titleArg] = process.argv.slice(2);

if (!pdfPath || !city || !year || !fiscalYearLabel) {
  console.error("Usage: node scripts/import-budget-pdf.mjs <pdfPath> <city> <year> <fiscalYearLabel> [title]");
  process.exit(1);
}

const siteRoot = process.cwd();
const repoRoot = path.resolve(siteRoot, "..");
const dataRoots = [
  path.join(repoRoot, "data"),
  path.join(siteRoot, "data"),
];

function getCityName(slug) {
  try {
    const municipalities = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "data", "municipalities.json"), "utf-8")
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

  return {
    page,
    file: `pages/${fileName}`,
    title: firstUsefulLine ?? `${page}ページ`,
    preview,
    text_length: normalized.length,
    text: normalized,
  };
});

const stat = fs.statSync(pdfPath);
const generatedAt = new Date().toISOString();
const manifest = {
  city,
  year,
  fiscal_year_label: fiscalYearLabel,
  title: titleArg ?? `${fiscalYearLabel} ${getCityName(city)} 予算書`,
  source_file_name: path.basename(pdfPath),
  source_file_size_bytes: stat.size,
  source_pdf_available: false,
  page_count: pageSummaries.length,
  generated_at: generatedAt,
  pages: pageSummaries.map((page) => ({
    page: page.page,
    file: page.file,
    title: page.title,
    preview: page.preview,
    text_length: page.text_length,
  })),
};

function writeDataset(dataRoot) {
  const outDir = path.join(dataRoot, city, "budgets", year);
  const pagesDir = path.join(outDir, "pages");
  const indexPath = path.join(dataRoot, city, "budgets", "index.json");

  fs.mkdirSync(pagesDir, { recursive: true });
  for (const file of fs.readdirSync(pagesDir)) {
    if (file.endsWith(".md")) fs.rmSync(path.join(pagesDir, file));
  }

  for (const page of pageSummaries) {
    fs.writeFileSync(
      path.join(outDir, page.file),
      `---\npage: ${page.page}\nsource: ${path.basename(pdfPath)}\n---\n\n${page.text}\n`,
      "utf-8"
    );
  }

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

  return outDir;
}

const outDirs = dataRoots.map((dataRoot) => writeDataset(dataRoot));

console.log(`Imported ${pageSummaries.length} pages to ${outDirs.join(" and ")}`);
