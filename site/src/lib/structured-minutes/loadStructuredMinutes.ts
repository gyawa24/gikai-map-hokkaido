import fs from "fs";
import path from "path";
import type { StructuredMinutes } from "./types";
import { validateStructuredMinutes } from "./validateStructuredMinutes";

const REPO_OWNER = process.env.GIKAI_REPO_OWNER ?? "gyawa24";
const REPO_NAME = process.env.GIKAI_REPO_NAME ?? "gikai-map-hokkaido";
const REPO_BRANCH = process.env.GIKAI_REPO_BRANCH ?? "main";
const RAW_BASE = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${REPO_BRANCH}`;

function structuredMinutesPath(municipalitySlug: string, date: string): string {
  return path.join(
    /*turbopackIgnore: true*/ process.cwd(),
    "data",
    "structured-minutes",
    municipalitySlug,
    `${date}.json`
  );
}

function structuredMinutesRemotePath(municipalitySlug: string, date: string): string {
  return `site/data/structured-minutes/${municipalitySlug}/${date}.json`;
}

function validateData(
  data: StructuredMinutes,
  municipalitySlug: string,
  date: string
): StructuredMinutes | null {
  const validation = validateStructuredMinutes(data);
  if (validation.ok) return data;

  const message = `Invalid structured minutes ${municipalitySlug}/${date}: ${validation.errors.join("; ")}`;
  if (process.env.NODE_ENV !== "production") throw new Error(message);
  console.error(message);
  return null;
}

async function fetchStructuredMinutes(
  municipalitySlug: string,
  date: string
): Promise<StructuredMinutes | null> {
  try {
    const res = await fetch(
      `${RAW_BASE}/${structuredMinutesRemotePath(municipalitySlug, date)}`,
      { next: { revalidate: 86400 } }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as StructuredMinutes;
    return validateData(data, municipalitySlug, date);
  } catch (error) {
    if (process.env.NODE_ENV !== "production") throw error;
    console.error(`Failed to fetch structured minutes ${municipalitySlug}/${date}`, error);
    return null;
  }
}

async function remoteStructuredMinutesExists(
  municipalitySlug: string,
  date: string
): Promise<boolean> {
  try {
    const res = await fetch(
      `${RAW_BASE}/${structuredMinutesRemotePath(municipalitySlug, date)}`,
      { method: "HEAD", next: { revalidate: 86400 } }
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function getStructuredMinutes(
  municipalitySlug: string,
  date: string
): Promise<StructuredMinutes | null> {
  const fp = structuredMinutesPath(municipalitySlug, date);
  if (!fs.existsSync(/*turbopackIgnore: true*/ fp)) {
    return fetchStructuredMinutes(municipalitySlug, date);
  }

  try {
    const data = JSON.parse(
      fs.readFileSync(/*turbopackIgnore: true*/ fp, "utf-8")
    ) as StructuredMinutes;
    return validateData(data, municipalitySlug, date);
  } catch (error) {
    if (process.env.NODE_ENV !== "production") throw error;
    console.error(`Failed to load structured minutes ${municipalitySlug}/${date}`, error);
    return null;
  }
}

export async function hasStructuredMinutes(
  municipalitySlug: string,
  date: string
): Promise<boolean> {
  const fp = structuredMinutesPath(municipalitySlug, date);
  if (!fs.existsSync(/*turbopackIgnore: true*/ fp)) {
    return remoteStructuredMinutesExists(municipalitySlug, date);
  }
  const data = await getStructuredMinutes(municipalitySlug, date);
  return data !== null;
}
