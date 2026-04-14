import fs from "fs";
import path from "path";
import CityHeader from "./CityHeader";
import { getMunicipalities } from "@/lib/municipalities";

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
};

const MASTER_NAV: MasterNavItem[] = [
  { key: "members", label: "議員一覧", pageDir: "" },
  { key: "decisions", label: "議決結果", pageDir: "decisions", dataFile: "decisions.json" },
  { key: "minutes", label: "議事録", pageDir: "minutes", dataFile: "minutes/index.json" },
  {
    key: "sessions",
    label: "会議録・速報",
    pageDir: "sessions",
    dataFile: "sessions",
    cityOnly: ["chitose"],
  },
  { key: "schedule", label: "行事予定", pageDir: "schedule", dataFile: "schedule.json" },
  { key: "newsletter", label: "議会だより", pageDir: "newsletter", dataFile: "newsletter.json" },
  {
    key: "plan",
    label: "総合計画",
    pageDir: "plan",
    dataFile: "comprehensive_plan.json",
    cityOnly: ["chitose"],
  },
  { key: "election", label: "選挙結果", pageDir: "election", dataFile: "election.json" },
  { key: "themes", label: "テーマ別", pageDir: "themes", dataFile: "members_activity.json" },
  { key: "ai-search", label: "✦ AI検索", pageDir: "ai-search" },
];

// Per-city label overrides for localized names
const LABEL_OVERRIDES: Record<string, Record<string, string>> = {
  tomakomai: { newsletter: "議会報告" },
};

function pageExists(cityKey: string, pageDir: string): boolean {
  if (pageDir === "ai-search") return true;
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

function dataExists(cityKey: string, dataFile: string): boolean {
  const dataPath = path.join(process.cwd(), "data", cityKey, dataFile);
  return fs.existsSync(dataPath);
}

function computeCityNav(cityKey: string): NavItem[] {
  const overrides = LABEL_OVERRIDES[cityKey] ?? {};
  const baseHref = `/${cityKey}`;

  return MASTER_NAV.filter((item) => {
    // Restrict to specific cities
    if (item.cityOnly && !item.cityOnly.includes(cityKey)) return false;

    // AI search is always shown
    if (item.key === "ai-search") return true;

    // Check page route exists (prevents 404)
    if (!pageExists(cityKey, item.pageDir)) return false;

    // Check data file exists (prevents empty pages)
    if (item.dataFile && !dataExists(cityKey, item.dataFile)) return false;

    return true;
  }).map((item) => ({
    href:
      item.key === "ai-search"
        ? "/ai-search"
        : item.key === "members"
        ? baseHref
        : `${baseHref}/${item.key}`,
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
