import fs from "fs";
import path from "path";
import CityHeader from "./CityHeader";
import { getMunicipalities } from "@/lib/municipalities";
import { hasCityCapability } from "@/lib/cityCapabilities";

export type NavItem = { href: string; label: string };
export type CityNavConfig = { name: string; nav: NavItem[] };

// Build city list from municipalities.json
function buildCities(): Record<string, { name: string }> {
  const municipalities = getMunicipalities();
  return Object.fromEntries(
    municipalities
      .filter((m) => m.active)
      .map((m) => [m.slug, { name: m.council_name }])
  );
}

// Master nav definition — order determines display order
// pageDir: subdirectory under app/{city}/ (empty string = city root page)
// dataFile: path relative to site/data/{city}/ (undefined = always show)
// cityOnly: restrict to specific cities
type MasterNavItem = {
  key: string;
  label: string;
  pageDir: string;
  dataFile?: string;
  cityOnly?: string[];
  href?: string;
};

const MASTER_NAV: MasterNavItem[] = [
  { key: "members", label: "議員", pageDir: "" },
  { key: "sessions", label: "速報", pageDir: "sessions", dataFile: "sessions/index.json" },
  { key: "minutes", label: "議事録", pageDir: "minutes", dataFile: "minutes/index.json" },
  { key: "themes", label: "テーマ", pageDir: "themes", dataFile: "members_activity.json" },
  { key: "budgets", label: "予算", pageDir: "budgets", dataFile: "budgets/index.json" },
  { key: "decisions", label: "議決結果", pageDir: "decisions", dataFile: "decisions.json" },
];

// Per-city label overrides for localized names
const LABEL_OVERRIDES: Record<string, Record<string, string>> = {
  tomakomai: { newsletter: "議会報告" },
};

function pageExists(cityKey: string, pageDir: string): boolean {
  // Check static city-specific route first
  const staticPath = pageDir
    ? path.join(process.cwd(), "src", "app", cityKey, pageDir, "page.tsx")
    : path.join(process.cwd(), "src", "app", cityKey, "page.tsx");
  if (fs.existsSync(staticPath)) return true;
  // Fall back to dynamic [city] route
  const dynamicPath = pageDir
    ? path.join(process.cwd(), "src", "app", "[city]", pageDir, "page.tsx")
    : path.join(process.cwd(), "src", "app", "[city]", "page.tsx");
  return fs.existsSync(dynamicPath);
}

function computeCityNav(cityKey: string): NavItem[] {
  const overrides = LABEL_OVERRIDES[cityKey] ?? {};
  const baseHref = `/${cityKey}`;

  return MASTER_NAV.filter((item) => {
    // Restrict to specific cities
    if (item.cityOnly && !item.cityOnly.includes(cityKey)) return false;

    if (item.href) return true;

    // Check page route exists (prevents 404)
    if (!pageExists(cityKey, item.pageDir)) return false;

    // Check backing data through the generated city capabilities index.
    if (item.dataFile && !hasCityCapability(cityKey, item.key)) return false;

    return true;
  }).map((item) => ({
    href: item.href ?? (item.key === "members" ? baseHref : `${baseHref}/${item.key}`),
    label: overrides[item.key] ?? item.label,
  }));
}

export default function CityHeaderServer() {
  const CITIES = buildCities();
  const allCityNavs: Record<string, CityNavConfig> = {};

  for (const [cityKey, config] of Object.entries(CITIES)) {
    allCityNavs[cityKey] = {
      name: config.name,
      nav: computeCityNav(cityKey),
    };
  }

  return <CityHeader allCityNavs={allCityNavs} />;
}
