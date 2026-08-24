import municipalitiesData from "../../data/municipalities.json";

export type Municipality = {
  slug: string;
  name: string;
  council_name: string;
  region: string;
  furigana: string;
  level: "municipality" | "prefecture";
  active: boolean;
  tenant_id?: number;
  system?: string;
  gijiroku_subdomain?: string;
  minutes_status?: "available" | "unavailable";
  minutes_status_note?: string;
  minutes_verified_at?: string;
  minutes_access?: "restricted";
  minutes_access_note?: string;
  minutes_official_url?: string;
  council_term_end?: string;
  council_term_end_source?: string;
  council_term_end_verified_at?: string;
};

export function getMunicipalities(): Municipality[] {
  return municipalitiesData as Municipality[];
}

export function getMunicipality(slug: string): Municipality | null {
  return getMunicipalities().find((m) => m.slug === slug && m.active) ?? null;
}
