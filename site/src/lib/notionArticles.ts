import type { Article, ArticleCategory, ArticleSection } from "@/lib/articles";
import {
  estimateReadingMinutes,
  normalizeArticleCategory,
  parseSections,
} from "@/lib/articles";

const NOTION_API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = process.env.NOTION_VERSION ?? "2026-03-11";
const ARTICLE_REVALIDATE_SECONDS = 600;
const MAX_NOTION_PAGES = 500;

type NotionRichText = {
  plain_text?: string;
  href?: string | null;
};

type NotionProperty = {
  type: string;
  title?: NotionRichText[];
  rich_text?: NotionRichText[];
  status?: { name?: string } | null;
  select?: { name?: string } | null;
  multi_select?: { name?: string }[];
  date?: { start?: string } | null;
  number?: number | null;
  url?: string | null;
  checkbox?: boolean;
  [key: string]: unknown;
};

type NotionPage = {
  object: "page";
  id: string;
  created_time?: string;
  last_edited_time?: string;
  properties: Record<string, NotionProperty>;
};

type NotionQueryResponse = {
  results: Array<NotionPage | { object: string }>;
  has_more: boolean;
  next_cursor: string | null;
};

type NotionDatabaseResponse = {
  data_sources?: Array<{ id?: string }>;
};

type NotionBlock = {
  id: string;
  type: string;
  has_children?: boolean;
  [key: string]: unknown;
};

type NotionBlockChildrenResponse = {
  results: NotionBlock[];
  has_more: boolean;
  next_cursor: string | null;
};

const PROPERTY_ALIASES = {
  title: ["title", "Title", "記事タイトル", "タイトル", "名前", "Name"],
  slug: ["slug", "Slug", "スラッグ", "URL Slug"],
  summary: ["summary", "Summary", "概要", "要約", "description", "Description"],
  status: ["status", "Status", "公開状態", "ステータス"],
  date: ["published_at", "Published At", "date", "Date", "公開日", "投稿日"],
  category: ["category", "Category", "分類", "カテゴリ"],
  tags: ["tags", "Tags", "タグ"],
  author: ["author", "Author", "著者"],
  readingMinutes: ["readingMinutes", "Reading Minutes", "reading_minutes", "読了分"],
  body: ["body", "Body", "本文", "Content", "content"],
} as const;

function getNotionToken(): string | null {
  return process.env.NOTION_TOKEN ?? process.env.NOTION_API_KEY ?? null;
}

function notionEnabled(): boolean {
  return Boolean(
    getNotionToken() &&
      (process.env.NOTION_ARTICLES_DATA_SOURCE_ID || process.env.NOTION_ARTICLES_DATABASE_ID)
  );
}

async function notionRequest<T>(
  endpoint: string,
  init: RequestInit & { next?: { revalidate: number; tags?: string[] } } = {}
): Promise<T> {
  const token = getNotionToken();
  if (!token) throw new Error("NOTION_TOKEN is not configured");

  const response = await fetch(`${NOTION_API_BASE}${endpoint}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION,
      ...init.headers,
    },
    next: {
      revalidate: ARTICLE_REVALIDATE_SECONDS,
      tags: ["notion-articles"],
      ...init.next,
    },
  });

  if (!response.ok) {
    throw new Error(`Notion API ${response.status}: ${await response.text()}`);
  }

  return response.json() as Promise<T>;
}

async function getArticlesDataSourceId(): Promise<string | null> {
  if (process.env.NOTION_ARTICLES_DATA_SOURCE_ID) {
    return process.env.NOTION_ARTICLES_DATA_SOURCE_ID;
  }

  const databaseId = process.env.NOTION_ARTICLES_DATABASE_ID;
  if (!databaseId) return null;

  const database = await notionRequest<NotionDatabaseResponse>(`/databases/${databaseId}`);
  return database.data_sources?.find((source) => source.id)?.id ?? null;
}

function findProperty(
  properties: Record<string, NotionProperty>,
  aliases: readonly string[],
  fallbackType?: string
): NotionProperty | undefined {
  for (const alias of aliases) {
    if (properties[alias]) return properties[alias];
  }

  const normalizedAliases = new Set(aliases.map((alias) => alias.toLowerCase()));
  for (const [name, property] of Object.entries(properties)) {
    if (normalizedAliases.has(name.toLowerCase())) return property;
  }

  if (!fallbackType) return undefined;
  return Object.values(properties).find((property) => property.type === fallbackType);
}

function richTextToMarkdown(items: NotionRichText[] | undefined): string {
  return (items ?? [])
    .map((item) => {
      const text = item.plain_text ?? "";
      return item.href ? `[${text}](${item.href})` : text;
    })
    .join("");
}

function propertyText(property: NotionProperty | undefined): string {
  if (!property) return "";

  switch (property.type) {
    case "title":
      return richTextToMarkdown(property.title);
    case "rich_text":
      return richTextToMarkdown(property.rich_text);
    case "status":
      return property.status?.name ?? "";
    case "select":
      return property.select?.name ?? "";
    case "date":
      return property.date?.start ?? "";
    case "number":
      return property.number == null ? "" : String(property.number);
    case "url":
      return property.url ?? "";
    case "checkbox":
      return property.checkbox ? "true" : "false";
    default:
      return "";
  }
}

function propertyTags(property: NotionProperty | undefined): string[] {
  if (!property) return [];
  if (property.type === "multi_select") {
    return (property.multi_select ?? []).map((item) => item.name ?? "").filter(Boolean);
  }
  return propertyText(property)
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function isPublished(properties: Record<string, NotionProperty>): boolean {
  const status = propertyText(findProperty(properties, PROPERTY_ALIASES.status)).toLowerCase();
  return ["published", "publish", "public", "公開", "公開済み"].includes(status);
}

function dateOnly(value: string | undefined): string {
  const match = value?.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : new Date().toISOString().slice(0, 10);
}

async function queryArticlePages(dataSourceId: string): Promise<NotionPage[]> {
  const pages: NotionPage[] = [];
  let startCursor: string | null = null;

  do {
    const response: NotionQueryResponse = await notionRequest<NotionQueryResponse>(
      `/data_sources/${dataSourceId}/query`,
      {
        method: "POST",
        body: JSON.stringify({
          page_size: 100,
          start_cursor: startCursor ?? undefined,
        }),
      }
    );

    pages.push(
      ...response.results.filter(
        (result): result is NotionPage => result.object === "page"
      )
    );
    startCursor = response.next_cursor;
  } while (startCursor && pages.length < MAX_NOTION_PAGES);

  return pages;
}

async function listBlockChildren(blockId: string): Promise<NotionBlock[]> {
  const blocks: NotionBlock[] = [];
  let startCursor: string | null = null;

  do {
    const response: NotionBlockChildrenResponse = await notionRequest<NotionBlockChildrenResponse>(
      `/blocks/${blockId}/children?page_size=100${
        startCursor ? `&start_cursor=${encodeURIComponent(startCursor)}` : ""
      }`
    );
    blocks.push(...response.results);
    startCursor = response.next_cursor;
  } while (startCursor);

  return blocks;
}

function blockText(block: NotionBlock): string {
  const value = block[block.type] as { rich_text?: NotionRichText[] } | undefined;
  return richTextToMarkdown(value?.rich_text).trim();
}

async function blocksToSections(pageId: string): Promise<ArticleSection[]> {
  const blocks = await listBlockChildren(pageId);
  const sections: ArticleSection[] = [];
  let current: ArticleSection = { heading: "本文", paragraphs: [] };
  let listLines: string[] = [];
  let listType: "bullet" | "number" | null = null;

  function flushList() {
    if (listLines.length === 0) return;
    current.paragraphs.push(listLines.join("\n"));
    listLines = [];
    listType = null;
  }

  function pushCurrent() {
    flushList();
    if (current.paragraphs.length > 0) sections.push(current);
  }

  for (const block of blocks) {
    const text = blockText(block);
    if (!text) continue;

    if (["heading_1", "heading_2", "heading_3"].includes(block.type)) {
      pushCurrent();
      current = { heading: text, paragraphs: [] };
      continue;
    }

    if (block.type === "bulleted_list_item") {
      if (listType !== "bullet") flushList();
      listType = "bullet";
      listLines.push(`- ${text}`);
      continue;
    }

    if (block.type === "numbered_list_item") {
      if (listType !== "number") flushList();
      listType = "number";
      listLines.push(`1. ${text}`);
      continue;
    }

    if (["paragraph", "quote", "callout"].includes(block.type)) {
      flushList();
      current.paragraphs.push(text);
    }
  }

  pushCurrent();
  return sections.length > 0 ? sections : [{ heading: "本文", paragraphs: [] }];
}

async function notionPageToArticle(page: NotionPage): Promise<Article | null> {
  const properties = page.properties;
  if (!isPublished(properties)) return null;

  const title = propertyText(findProperty(properties, PROPERTY_ALIASES.title, "title"));
  const slug = propertyText(findProperty(properties, PROPERTY_ALIASES.slug));
  if (!title || !slug) return null;

  const bodyMarkdown = propertyText(findProperty(properties, PROPERTY_ALIASES.body));
  const sections = bodyMarkdown ? parseSections(bodyMarkdown) : await blocksToSections(page.id);
  const flatBody = sections.flatMap((section) => section.paragraphs).join("\n");
  const summary =
    propertyText(findProperty(properties, PROPERTY_ALIASES.summary)) ||
    flatBody.replace(/\s+/g, " ").slice(0, 120);

  if (!summary || sections.every((section) => section.paragraphs.length === 0)) return null;

  const categoryText = propertyText(findProperty(properties, PROPERTY_ALIASES.category));
  const readingMinutes = Number(propertyText(findProperty(properties, PROPERTY_ALIASES.readingMinutes)));
  const textForEstimate = `${title}\n${summary}\n${flatBody}`;

  return {
    slug,
    title,
    summary,
    date: dateOnly(
      propertyText(findProperty(properties, PROPERTY_ALIASES.date)) || page.created_time
    ),
    category: normalizeArticleCategory(categoryText as ArticleCategory),
    author:
      propertyText(findProperty(properties, PROPERTY_ALIASES.author)) ||
      "地方議会ドットコム編集部",
    tags: propertyTags(findProperty(properties, PROPERTY_ALIASES.tags)),
    readingMinutes: Number.isFinite(readingMinutes) && readingMinutes > 0
      ? readingMinutes
      : estimateReadingMinutes(textForEstimate),
    sections,
  };
}

export async function getNotionArticles(): Promise<Article[]> {
  if (!notionEnabled()) return [];

  try {
    const dataSourceId = await getArticlesDataSourceId();
    if (!dataSourceId) return [];

    const pages = await queryArticlePages(dataSourceId);
    const articles = await Promise.all(pages.map(notionPageToArticle));
    return articles.filter((article): article is Article => article !== null);
  } catch (error) {
    console.warn("[articles] Notion fetch failed; falling back to local markdown", error);
    return [];
  }
}
