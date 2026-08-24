import fs from "fs";
import path from "path";
import type { MinutesIndexItem } from "@/types/minutes";

const REPO_OWNER = process.env.GIKAI_REPO_OWNER ?? "gyawa24";
const REPO_NAME = process.env.GIKAI_REPO_NAME ?? "gikai-map-hokkaido";
const REPO_BRANCH = process.env.GIKAI_REPO_BRANCH ?? "main";
const RAW_BASE = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${REPO_BRANCH}`;

type IndexLookup = {
  checked: boolean;
  item: MinutesIndexItem | null;
};

function findItem(items: unknown, id: string): MinutesIndexItem | null {
  return Array.isArray(items)
    ? (items as MinutesIndexItem[]).find((item) => String(item.council_id) === id) ?? null
    : null;
}

function getLocalIndexItem(city: string, id: string): IndexLookup {
  const candidates = [
    path.join(/*turbopackIgnore: true*/ process.cwd(), "data", city, "minutes", "index.json"),
    path.join(/*turbopackIgnore: true*/ process.cwd(), "data", city, "index.json"),
  ];
  for (const filePath of candidates) {
    if (!fs.existsSync(/*turbopackIgnore: true*/ filePath)) continue;
    try {
      const items = JSON.parse(
        fs.readFileSync(/*turbopackIgnore: true*/ filePath, "utf-8")
      ) as unknown;
      return { checked: true, item: findItem(items, id) };
    } catch {
      return { checked: true, item: null };
    }
  }
  return { checked: false, item: null };
}

async function getRemoteIndexItem(remotePath: string, id: string): Promise<IndexLookup> {
  try {
    const response = await fetch(`${RAW_BASE}/${remotePath}`, { cache: "no-store" });
    if (response.status === 404) return { checked: false, item: null };
    if (!response.ok) return { checked: true, item: null };
    return { checked: true, item: findItem(await response.json(), id) };
  } catch {
    return { checked: true, item: null };
  }
}

export async function getPublishedMinutesIndexItem(
  city: string,
  id: string
): Promise<MinutesIndexItem | null> {
  const local = getLocalIndexItem(city, id);
  if (local.checked) return local.item;

  for (const remotePath of [
    `site/data/${city}/minutes/index.json`,
    `site/data/${city}/index.json`,
  ]) {
    const remote = await getRemoteIndexItem(remotePath, id);
    if (remote.checked) return remote.item;
  }
  return null;
}
