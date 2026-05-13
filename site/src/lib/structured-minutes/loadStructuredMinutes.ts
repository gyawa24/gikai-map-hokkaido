import fs from "fs";
import path from "path";
import type { StructuredMinutes } from "./types";
import { validateStructuredMinutes } from "./validateStructuredMinutes";

function structuredMinutesPath(municipalitySlug: string, date: string): string {
  return path.join(
    /*turbopackIgnore: true*/ process.cwd(),
    "data",
    "structured-minutes",
    municipalitySlug,
    `${date}.json`
  );
}

export async function getStructuredMinutes(
  municipalitySlug: string,
  date: string
): Promise<StructuredMinutes | null> {
  const fp = structuredMinutesPath(municipalitySlug, date);
  if (!fs.existsSync(/*turbopackIgnore: true*/ fp)) return null;

  try {
    const data = JSON.parse(
      fs.readFileSync(/*turbopackIgnore: true*/ fp, "utf-8")
    ) as StructuredMinutes;
    const validation = validateStructuredMinutes(data);
    if (!validation.ok) {
      const message = `Invalid structured minutes ${municipalitySlug}/${date}: ${validation.errors.join("; ")}`;
      if (process.env.NODE_ENV !== "production") throw new Error(message);
      console.error(message);
      return null;
    }
    return data;
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
  if (!fs.existsSync(/*turbopackIgnore: true*/ fp)) return false;
  const data = await getStructuredMinutes(municipalitySlug, date);
  return data !== null;
}
