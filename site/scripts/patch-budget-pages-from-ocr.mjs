import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [
  pdfPath,
  city,
  year,
  startPageArg,
  dpiArg = "180",
  psmArg = "6",
  langArg = "jpn+eng",
] = process.argv.slice(2);

if (!pdfPath || !city || !year || !startPageArg) {
  console.error(
    "Usage: node scripts/patch-budget-pages-from-ocr.mjs <pdfPath> <city> <year> <startPage> [dpi] [psm] [lang]"
  );
  process.exit(1);
}

const startPage = Number(startPageArg);
const dpi = Number(dpiArg);
const psm = Number(psmArg);
const lang = langArg;

if (!Number.isInteger(startPage) || startPage < 1) {
  console.error("startPage must be a positive integer");
  process.exit(1);
}

const siteRoot = process.cwd();
const repoRoot = path.resolve(siteRoot, "..");
const dataRoots = [path.join(repoRoot, "data"), path.join(siteRoot, "data")];
const pdfFileName = path.basename(pdfPath);

function normalizeText(text) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function firstUsefulLine(text, page) {
  return (
    text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length >= 3 && !/^-?\d+-?$/.test(line)) ?? `${page}ページ`
  );
}

function previewText(text) {
  return text.replace(/\s+/g, " ").trim().slice(0, 180);
}

function readManifest(dataRoot) {
  const manifestPath = path.join(dataRoot, city, "budgets", year, "manifest.json");
  return {
    manifestPath,
    manifest: JSON.parse(fs.readFileSync(manifestPath, "utf-8")),
  };
}

function writePage(dataRoot, pageNumber, text) {
  const outDir = path.join(dataRoot, city, "budgets", year, "pages");
  fs.mkdirSync(outDir, { recursive: true });
  const fileName = `page-${String(pageNumber).padStart(3, "0")}.md`;
  fs.writeFileSync(
    path.join(outDir, fileName),
    `---\npage: ${pageNumber}\nsource: ${pdfFileName}\nocr: tesseract\n---\n\n${text}\n`,
    "utf-8"
  );
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "budget-ocr-pages-"));
try {
  execFileSync("pdftoppm", ["-r", String(dpi), "-png", pdfPath, path.join(tmpDir, "page")], {
    stdio: "inherit",
  });

  const pngFiles = fs
    .readdirSync(tmpDir)
    .filter((file) => file.endsWith(".png"))
    .sort();

  const ocrPages = [];
  for (const [index, file] of pngFiles.entries()) {
    const imagePath = path.join(tmpDir, file);
    const outBase = path.join(tmpDir, file.replace(/\.png$/, ""));
    execFileSync("tesseract", [imagePath, outBase, "-l", lang, "--psm", String(psm)], {
      stdio: "ignore",
    });
    const text = normalizeText(fs.readFileSync(`${outBase}.txt`, "utf-8"));
    const pageNumber = startPage + index;
    ocrPages.push({ pageNumber, text });
  }

  for (const dataRoot of dataRoots) {
    const { manifestPath, manifest } = readManifest(dataRoot);
    const pagesByNumber = new Map(manifest.pages.map((page) => [page.page, page]));

    for (const { pageNumber, text } of ocrPages) {
      const page = pagesByNumber.get(pageNumber);
      if (!page) {
        throw new Error(`page not found in manifest: ${pageNumber}`);
      }
      writePage(dataRoot, pageNumber, text);
      page.title = firstUsefulLine(text, pageNumber);
      page.preview = previewText(text);
      page.text_length = text.length;
      page.ocr = {
        engine: "tesseract",
        dpi,
        psm,
        lang,
        source_file_name: pdfFileName,
      };
    }

    manifest.ocr_patches = [
      ...(Array.isArray(manifest.ocr_patches) ? manifest.ocr_patches : []),
      {
        source_file_name: pdfFileName,
        page_start: startPage,
        page_end: startPage + ocrPages.length - 1,
        engine: "tesseract",
        dpi,
        psm,
        lang,
        generated_at: new Date().toISOString(),
      },
    ];

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  }

  console.log(
    `Patched ${ocrPages.length} OCR pages into ${city}/budgets/${year} starting at page ${startPage}`
  );
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
