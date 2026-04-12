import fs from "fs";
import path from "path";

type MinutesIndexItem = {
  japanese_year: string;
};

export type MinutesSummary = {
  count: number | null;
  latestYear: string | null;
};

export function getMinutesSummary(city: string): MinutesSummary {
  try {
    const fp = path.join(process.cwd(), "data", city, "minutes", "index.json");
    const items = JSON.parse(fs.readFileSync(fp, "utf-8")) as MinutesIndexItem[];
    if (items.length === 0) return { count: null, latestYear: null };
    return { count: items.length, latestYear: items[0].japanese_year };
  } catch {
    return { count: null, latestYear: null };
  }
}
