#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SITE_ROOT = path.resolve(__dirname, "..");
const ARTICLES_DIR = path.join(SITE_ROOT, "content", "articles");
const NOTION_API_BASE = "https://api.notion.com/v1";
const MAX_NOTION_PAGES = 500;
const SYNC_TARGET_STATUSES = new Set([
  "published",
  "publish",
  "public",
  "ready",
  "公開",
  "公開済み",
  "公開候補",
]);

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
};

function parseArgs(argv) {
  return {
    dryRun: argv.includes("--dry-run"),
  };
}

async function loadEnvFile(filePath) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // Optional local env file.
  }
}

async function loadLocalEnv() {
  await loadEnvFile(path.join(SITE_ROOT, ".env.local"));
  await loadEnvFile(path.join(SITE_ROOT, ".env"));
}

function getNotionToken() {
  return process.env.NOTION_TOKEN ?? process.env.NOTION_API_KEY ?? null;
}

async function notionRequest(endpoint, init = {}) {
  const token = getNotionToken();
  if (!token) throw new Error("NOTION_TOKEN is not configured");

  const response = await fetch(`${NOTION_API_BASE}${endpoint}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Notion-Version": process.env.NOTION_VERSION ?? "2026-03-11",
      ...init.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`Notion API ${response.status}: ${await response.text()}`);
  }

  return response.json();
}

async function getArticlesDataSourceId() {
  if (process.env.NOTION_ARTICLES_DATA_SOURCE_ID) {
    return process.env.NOTION_ARTICLES_DATA_SOURCE_ID;
  }

  const databaseId = process.env.NOTION_ARTICLES_DATABASE_ID;
  if (!databaseId) return null;

  const database = await notionRequest(`/databases/${databaseId}`);
  return database.data_sources?.find((source) => source.id)?.id ?? null;
}

function richTextToMarkdown(items) {
  return (items ?? [])
    .map((item) => {
      const text = item.plain_text ?? "";
      return item.href ? `[${text}](${item.href})` : text;
    })
    .join("");
}

function propertyText(property) {
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

function propertyTags(property) {
  if (!property) return [];
  if (property.type === "multi_select") {
    return (property.multi_select ?? []).map((item) => item.name ?? "").filter(Boolean);
  }
  return propertyText(property)
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function findProperty(properties, aliases, fallbackType) {
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

function isSyncTarget(properties) {
  const status = propertyText(findProperty(properties, PROPERTY_ALIASES.status)).toLowerCase();
  return SYNC_TARGET_STATUSES.has(status);
}

function dateOnly(value) {
  const match = value?.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : new Date().toISOString().slice(0, 10);
}

function normalizeArticleCategory(value) {
  return ["企画", "解説", "インタビュー"].includes(value) ? value : "企画";
}

function estimateReadingMinutes(text) {
  const chars = text.replace(/\s/g, "").length;
  return Math.max(1, Math.ceil(chars / 600));
}

function safeSlug(slug) {
  const trimmed = slug.trim();
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(trimmed)) {
    throw new Error(`Unsupported article slug: ${slug}`);
  }
  return trimmed;
}

function yamlString(value) {
  return JSON.stringify(String(value ?? ""));
}

function blockText(block) {
  const value = block[block.type];
  return richTextToMarkdown(value?.rich_text).trim();
}

async function listBlockChildren(blockId) {
  const blocks = [];
  let startCursor = null;

  do {
    const response = await notionRequest(
      `/blocks/${blockId}/children?page_size=100${
        startCursor ? `&start_cursor=${encodeURIComponent(startCursor)}` : ""
      }`
    );
    blocks.push(...response.results);
    startCursor = response.next_cursor;
  } while (startCursor);

  return blocks;
}

async function blocksToMarkdown(pageId) {
  const blocks = await listBlockChildren(pageId);
  const lines = [];
  let number = 1;

  for (const block of blocks) {
    const text = blockText(block);
    if (!text) continue;

    if (["heading_1", "heading_2", "heading_3"].includes(block.type)) {
      lines.push("", `## ${text}`, "");
      number = 1;
      continue;
    }

    if (block.type === "bulleted_list_item") {
      lines.push(`- ${text}`);
      number = 1;
      continue;
    }

    if (block.type === "numbered_list_item") {
      lines.push(`${number}. ${text}`);
      number += 1;
      continue;
    }

    if (["paragraph", "quote", "callout"].includes(block.type)) {
      lines.push(text, "");
      number = 1;
    }
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function queryArticlePages(dataSourceId) {
  const pages = [];
  let startCursor = null;

  do {
    const response = await notionRequest(`/data_sources/${dataSourceId}/query`, {
      method: "POST",
      body: JSON.stringify({
        page_size: 100,
        start_cursor: startCursor ?? undefined,
      }),
    });

    pages.push(...response.results.filter((result) => result.object === "page"));
    startCursor = response.next_cursor;
  } while (startCursor && pages.length < MAX_NOTION_PAGES);

  return pages;
}

async function pageToMarkdown(page) {
  const properties = page.properties;
  if (!isSyncTarget(properties)) return null;

  const title = propertyText(findProperty(properties, PROPERTY_ALIASES.title, "title"));
  const slug = safeSlug(propertyText(findProperty(properties, PROPERTY_ALIASES.slug)));
  if (!title || !slug) return null;

  const bodyProperty = propertyText(findProperty(properties, PROPERTY_ALIASES.body));
  const body = bodyProperty.trim() || await blocksToMarkdown(page.id);
  if (!body) return null;

  const summary =
    propertyText(findProperty(properties, PROPERTY_ALIASES.summary)) ||
    body.replace(/\s+/g, " ").slice(0, 120);
  const date = dateOnly(
    propertyText(findProperty(properties, PROPERTY_ALIASES.date)) || page.created_time
  );
  const category = normalizeArticleCategory(
    propertyText(findProperty(properties, PROPERTY_ALIASES.category))
  );
  const author =
    propertyText(findProperty(properties, PROPERTY_ALIASES.author)) ||
    "地方議会ドットコム編集部";
  const tags = propertyTags(findProperty(properties, PROPERTY_ALIASES.tags));
  const readingMinutes =
    Number(propertyText(findProperty(properties, PROPERTY_ALIASES.readingMinutes))) ||
    estimateReadingMinutes(`${title}\n${summary}\n${body}`);

  const frontmatter = [
    "---",
    `title: ${yamlString(title)}`,
    `summary: ${yamlString(summary)}`,
    `date: ${yamlString(date)}`,
    `category: ${yamlString(category)}`,
    `author: ${yamlString(author)}`,
    `tags: ${yamlString(tags.join(", "))}`,
    `readingMinutes: ${yamlString(readingMinutes)}`,
    "---",
    "",
  ].join("\n");

  return {
    slug,
    markdown: `${frontmatter}${body.trim()}\n`,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await loadLocalEnv();

  const dataSourceId = await getArticlesDataSourceId();
  if (!dataSourceId) {
    throw new Error("NOTION_ARTICLES_DATA_SOURCE_ID or NOTION_ARTICLES_DATABASE_ID is not configured");
  }

  const pages = await queryArticlePages(dataSourceId);
  const articles = (await Promise.all(pages.map(pageToMarkdown))).filter(Boolean);
  await fs.mkdir(ARTICLES_DIR, { recursive: true });

  let written = 0;
  let unchanged = 0;

  for (const article of articles) {
    const filePath = path.join(ARTICLES_DIR, `${article.slug}.md`);
    let previous = null;
    try {
      previous = await fs.readFile(filePath, "utf8");
    } catch {
      // New file.
    }

    if (previous === article.markdown) {
      unchanged += 1;
      continue;
    }

    written += 1;
    if (!options.dryRun) {
      await fs.writeFile(filePath, article.markdown);
    }
    console.log(`${options.dryRun ? "would write" : "wrote"} ${path.relative(SITE_ROOT, filePath)}`);
  }

  console.log(
    `Notion article sync ${options.dryRun ? "dry-run " : ""}complete: ${articles.length} target, ${written} changed, ${unchanged} unchanged`
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
