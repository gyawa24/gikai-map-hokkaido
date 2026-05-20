import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [pdfPath, city, year, dpiArg = "130", qualityArg = "78"] = process.argv.slice(2);

if (!pdfPath || !city || !year) {
  console.error("Usage: node scripts/render-budget-page-images.mjs <pdfPath> <city> <year> [dpi] [quality]");
  process.exit(1);
}

const dpi = Number(dpiArg);
const quality = Number(qualityArg);
const siteRoot = process.cwd();
const repoRoot = path.resolve(siteRoot, "..");
const manifestPath = path.join(siteRoot, "data", city, "budgets", year, "manifest.json");
const rootManifestPath = path.join(repoRoot, "data", city, "budgets", year, "manifest.json");
const publicDir = path.join(siteRoot, "public", "budgets", city, year, "pages");
const tmpDir = path.join(siteRoot, ".tmp-budget-pages", `${city}-${year}`);

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

fs.rmSync(tmpDir, { recursive: true, force: true });
fs.mkdirSync(tmpDir, { recursive: true });
fs.mkdirSync(publicDir, { recursive: true });

for (const file of fs.readdirSync(publicDir)) {
  if (file.endsWith(".webp")) fs.rmSync(path.join(publicDir, file));
}

execFileSync("pdftoppm", ["-r", String(dpi), "-png", pdfPath, path.join(tmpDir, "page")], {
  stdio: "inherit",
});

const pngFiles = fs.readdirSync(tmpDir).filter((file) => file.endsWith(".png")).sort();

for (const file of pngFiles) {
  const match = file.match(/-(\d+)\.png$/);
  if (!match) continue;
  const page = Number(match[1]);
  const webpName = `page-${String(page).padStart(3, "0")}.webp`;
  execFileSync("cwebp", [
    "-quiet",
    "-q",
    String(quality),
    path.join(tmpDir, file),
    "-o",
    path.join(publicDir, webpName),
  ]);
}

manifest.page_images_available = true;
manifest.page_image_format = "webp";
manifest.page_image_dpi = dpi;
manifest.page_image_quality = quality;
manifest.pages = manifest.pages.map((page) => ({
  ...page,
  image: `/budgets/${city}/${year}/pages/page-${String(page.page).padStart(3, "0")}.webp`,
}));

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
if (fs.existsSync(rootManifestPath)) {
  fs.writeFileSync(rootManifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
}
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`Rendered ${pngFiles.length} page images to ${publicDir}`);
