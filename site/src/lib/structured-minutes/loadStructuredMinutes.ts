import fs from "fs";
import path from "path";
import type { StructuredMinutes } from "./types";
import { isStructuredMinutesRequest, matchesStructuredMinutesRequest, normalizeStructuredMinutes } from "./read-contract.mjs";

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

export type StructuredMinutesResult =
  | { status: "available"; data: StructuredMinutes }
  | { status: "absent" | "fetch_failed" | "parse_failed" | "invalid" };

function validateData(data: unknown, municipalitySlug: string, id: string): StructuredMinutesResult {
  if (!matchesStructuredMinutesRequest(data, municipalitySlug, id)) return { status: "invalid" };
  const result = normalizeStructuredMinutes(data);
  if (result.data) return { status: "available", data: result.data };
  console.error(`Invalid structured minutes: ${result.validation.errors.join("; ")}`);
  return { status: "invalid" };
}

export async function getStructuredMinutesResult(
  municipalitySlug: string,
  id: string
): Promise<StructuredMinutesResult> {
  if (!isStructuredMinutesRequest(municipalitySlug, id)) return { status: "absent" };
  const fp = structuredMinutesPath(municipalitySlug, id);
  if (fs.existsSync(/*turbopackIgnore: true*/ fp)) {
    try {
      return validateData(JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ fp, "utf-8")), municipalitySlug, id);
    } catch {
      return { status: "parse_failed" };
    }
  }
  let response: Response;
  try {
    response = await fetch(`${RAW_BASE}/${structuredMinutesRemotePath(municipalitySlug, id)}`, { cache: "no-store" });
  } catch {
    return { status: "fetch_failed" };
  }
  if (response.status === 404) return { status: "absent" };
  if (!response.ok) return { status: "fetch_failed" };
  try {
    return validateData(await response.json(), municipalitySlug, id);
  } catch {
    return { status: "parse_failed" };
  }
}

export async function getStructuredMinutes(municipalitySlug: string, id: string): Promise<StructuredMinutes | null> {
  const result = await getStructuredMinutesResult(municipalitySlug, id);
  return result.status === "available" ? result.data : null;
}

export async function hasStructuredMinutes(municipalitySlug: string, id: string): Promise<boolean> {
  return (await getStructuredMinutesResult(municipalitySlug, id)).status === "available";
}
