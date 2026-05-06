import fs from "fs";
import path from "path";

export type Municipality = {
  slug: string;
  name: string;
  council_name: string;
  region: string;
  furigana: string;
  level: "municipality" | "prefecture";
  features: string[];
  active: boolean;
  tenant_id?: number;
  system?: string;
  gijiroku_subdomain?: string;
  minutes_status?: "available" | "unavailable";
  minutes_status_note?: string;
  minutes_verified_at?: string;
  minutes_access?: "restricted";
  minutes_access_note?: string;
};

export function getMunicipalities(): Municipality[] {
  const fp = path.join(process.cwd(), "data", "municipalities.json");
  return JSON.parse(fs.readFileSync(fp, "utf-8")) as Municipality[];
}

export function getMunicipality(slug: string): Municipality | null {
  return getMunicipalities().find((m) => m.slug === slug && m.active) ?? null;
}

export function hasFeature(slug: string, feature: string): boolean {
  return getMunicipality(slug)?.features.includes(feature) ?? false;
}
