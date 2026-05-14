import fs from "fs";
import path from "path";
import { getBudgetDocument, type BudgetPage } from "@/lib/budgets";

function stripMarkdownFrontmatter(text: string): string {
  return text.replace(/^---\n[\s\S]*?\n---\n\n?/, "");
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
