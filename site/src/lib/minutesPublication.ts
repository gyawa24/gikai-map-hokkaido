import fs from "fs";
import path from "path";
import type { MinutesIndexItem } from "@/types/minutes";

const REPO_OWNER = process.env.GIKAI_REPO_OWNER ?? "gyawa24";
const REPO_NAME = process.env.GIKAI_REPO_NAME ?? "gikai-map-hokkaido";
const REPO_BRANCH = process.env.GIKAI_REPO_BRANCH ?? "main";
const RAW_BASE = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${REPO_BRANCH}`;

export type PublishedMinutesResult =
  | { status: "available"; item: MinutesIndexItem }
  | { status: "absent" | "fetch_failed" | "parse_failed" };

type IndexLookup = PublishedMinutesResult | { status: "missing_index" };

function findItem(items: unknown, id: string): PublishedMinutesResult {
  if (!Array.isArray(items) || items.some((item) => !item || typeof item !== "object"
    || item.council_id == null || typeof item.name !== "string" || typeof item.file !== "string")) {
    return { status: "parse_failed" };
  }
  const item = (items as MinutesIndexItem[]).find((item) => String(item.council_id) === id);
  return item ? { status: "available", item } : { status: "absent" };
}

function getLocalIndexItem(city: string, id: string): IndexLookup {
  const candidates = [
    path.join(/*turbopackIgnore: true*/ process.cwd(), "data", city, "minutes", "index.json"),
    path.join(/*turbopackIgnore: true*/ process.cwd(), "data", city, "index.json"),
  ];
  for (const filePath of candidates) {
    if (!fs.existsSync(/*turbopackIgnore: true*/ filePath)) continue;
    try {
      return findItem(JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ filePath, "utf-8")), id);
    } catch {
      return { status: "parse_failed" };
    }
  }
  return { status: "missing_index" };
}

async function getRemoteIndexItem(remotePath: string, id: string): Promise<IndexLookup> {
  let response: Response;
  try {
    response = await fetch(`${RAW_BASE}/${remotePath}`, { cache: "no-store" });
  } catch {
    return { status: "fetch_failed" };
  }
  if (response.status === 404) return { status: "missing_index" };
  if (!response.ok) return { status: "fetch_failed" };
  try {
    return findItem(await response.json(), id);
  } catch {
    return { status: "parse_failed" };
  }
}

export async function getPublishedMinutesIndexResult(city: string, id: string): Promise<PublishedMinutesResult> {
  if (!/^[a-z][a-z0-9_]*$/u.test(city) || !/^\d+$/u.test(id)) return { status: "absent" };
  const local = getLocalIndexItem(city, id);
  if (local.status !== "missing_index") return local;
  for (const remotePath of [
    `site/data/${city}/minutes/index.json`,
    `site/data/${city}/index.json`,
  ]) {
    const remote = await getRemoteIndexItem(remotePath, id);
    if (remote.status !== "missing_index") return remote;
  }
  return { status: "absent" };
}

export async function getPublishedMinutesIndexItem(city: string, id: string): Promise<MinutesIndexItem | null> {
  const result = await getPublishedMinutesIndexResult(city, id);
  return result.status === "available" ? result.item : null;
}
