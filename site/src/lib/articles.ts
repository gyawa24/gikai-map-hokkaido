import fs from "node:fs";
import path from "node:path";
import { getNotionArticles } from "@/lib/notionArticles";

export type ArticleCategory = "企画" | "解説" | "インタビュー";

export type ArticleSection = {
  heading: string;
  paragraphs: string[];
};

export type Article = {
  slug: string;
  title: string;
  summary: string;
  date: string;
  category: ArticleCategory;
  author: string;
  tags: string[];
  readingMinutes: number;
  sections: ArticleSection[];
};

type ArticleFrontmatter = {
  title?: string;
  summary?: string;
  date?: string;
  category?: string;
  author?: string;
  tags?: string;
  readingMinutes?: string;
};

const ARTICLES_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), "content", "articles");
export const CATEGORIES: ArticleCategory[] = ["企画", "解説", "インタビュー"];

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFrontmatter(raw: string): ArticleFrontmatter {
  const result: ArticleFrontmatter = {};

  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    result[key as keyof ArticleFrontmatter] = stripQuotes(value);
  }

  return result;
}

export function parseSections(markdown: string): ArticleSection[] {
  const sections: ArticleSection[] = [];
  let current: ArticleSection | null = null;
  let paragraphLines: string[] = [];

  function flushParagraph() {
    if (!current || paragraphLines.length === 0) return;
    const isTable = paragraphLines.every((line) => line.startsWith("|"));
    current.paragraphs.push(paragraphLines.join(isTable ? "\n" : " "));
    paragraphLines = [];
  }

  function ensureSection() {
    if (!current) {
      current = { heading: "本文", paragraphs: [] };
      sections.push(current);
    }
  }

  for (const rawLine of markdown.trim().split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("## ")) {
      flushParagraph();
      current = { heading: line.replace(/^##\s+/, ""), paragraphs: [] };
      sections.push(current);
      continue;
    }

    if (line === "") {
      flushParagraph();
      continue;
    }

    if (line.startsWith("# ")) continue;

    ensureSection();
    paragraphLines.push(line);
  }

  flushParagraph();
  return sections.filter((section) => section.paragraphs.length > 0);
}

function parseArticleFile(fileName: string): Article | null {
  const slug = fileName.replace(/\.md$/, "");
  const filePath = path.join(/*turbopackIgnore: true*/ ARTICLES_DIR, fileName);
  const raw = fs.readFileSync(/*turbopackIgnore: true*/ filePath, "utf-8");
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) return null;

  const meta = parseFrontmatter(match[1]);
  const category = normalizeArticleCategory(meta.category);
  const sections = parseSections(match[2]);

  if (!meta.title || !meta.summary || !meta.date || sections.length === 0) {
    return null;
  }

  return {
    slug,
    title: meta.title,
    summary: meta.summary,
    date: meta.date,
    category,
    author: meta.author ?? "地方議会ドットコム編集部",
    tags: meta.tags ? meta.tags.split(",").map((tag) => tag.trim()).filter(Boolean) : [],
    readingMinutes: Number(meta.readingMinutes ?? 3),
    sections,
  };
}

export function normalizeArticleCategory(value: string | undefined): ArticleCategory {
  return CATEGORIES.includes(value as ArticleCategory)
    ? (value as ArticleCategory)
    : "企画";
}

export function estimateReadingMinutes(text: string): number {
  const chars = text.replace(/\s/g, "").length;
  return Math.max(1, Math.ceil(chars / 600));
}

function byNewest(a: Article, b: Article): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return a.slug.localeCompare(b.slug);
}

export function getLocalArticles(): Article[] {
  try {
    return fs
      .readdirSync(/*turbopackIgnore: true*/ ARTICLES_DIR)
      .filter((fileName) => fileName.endsWith(".md"))
      .map(parseArticleFile)
      .filter((article): article is Article => article !== null)
      .sort(byNewest);
  } catch {
    return [];
  }
}

export async function getArticles(): Promise<Article[]> {
  const localArticles = getLocalArticles();
  const notionArticles = await getNotionArticles();
  const merged = new Map<string, Article>();

  for (const article of localArticles) merged.set(article.slug, article);
  for (const article of notionArticles) merged.set(article.slug, article);

  return [...merged.values()].sort(byNewest);
}

export async function getLatestArticles(limit = 3): Promise<Article[]> {
  return (await getArticles()).slice(0, limit);
}

export async function getArticle(slug: string): Promise<Article | undefined> {
  return (await getArticles()).find((article) => article.slug === slug);
}

export function formatArticleDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日`;
}

export function articleCategoryClass(category: ArticleCategory): string {
  const styles: Record<ArticleCategory, string> = {
    企画: "border-[#E6C566] bg-[#FFF7D6] text-[#6B4C11]",
    解説: "border-[#C5D0E6] bg-[#E8EEF7] text-[#2A5298]",
    インタビュー: "border-[#B7DEC9] bg-[#EEF9F2] text-[#166534]",
  };
  return styles[category];
}
