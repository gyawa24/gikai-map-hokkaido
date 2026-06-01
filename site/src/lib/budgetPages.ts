import fs from "fs";
import path from "path";
import { getBudgetDocument, type BudgetPage } from "@/lib/budgets";
import { publicRawUrl } from "@/lib/publicRawUrl";

function stripMarkdownFrontmatter(text: string): string {
  return text.replace(/^---\n[\s\S]*?\n---\n\n?/, "");
}

export function getBudgetPages(city: string, year: string): BudgetPage[] {
  const manifest = getBudgetDocument(city, year);
  if (!manifest) return [];
  const baseDir = path.join(/*turbopackIgnore: true*/ process.cwd(), "data", city, "budgets", year);

  return manifest.pages.map((page) => {
    const pageWithRemoteImage = {
      ...page,
      image: page.image ? publicRawUrl(page.image) : undefined,
    };

    try {
      const pagePath = path.join(/*turbopackIgnore: true*/ baseDir, page.file);
      const text = fs.readFileSync(/*turbopackIgnore: true*/ pagePath, "utf-8");
      return {
        ...pageWithRemoteImage,
        text: stripMarkdownFrontmatter(text).trimEnd(),
      };
    } catch {
      return {
        ...pageWithRemoteImage,
        text: "",
      };
    }
  });
}
