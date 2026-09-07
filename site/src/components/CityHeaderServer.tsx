import CityHeader from "./CityHeader";
import { getMunicipalities } from "@/lib/municipalities";
import { hasCityCapability, type CityCapabilityKey } from "@/lib/cityCapabilities";

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

// 本番ランタイムにはページのソースファイルがないため、既知のルートと公開台帳で判定する。
type MasterNavItem = {
  key: CityCapabilityKey;
  label: string;
};

const MASTER_NAV: MasterNavItem[] = [
  { key: "members", label: "議員" },
  { key: "sessions", label: "速報" },
  { key: "minutes", label: "議事録" },
  { key: "themes", label: "テーマ" },
  { key: "budgets", label: "予算" },
  { key: "decisions", label: "議決結果" },
];

function computeCityNav(cityKey: string): NavItem[] {
  const baseHref = `/${cityKey}`;

  return MASTER_NAV.filter((item) => item.key === "members" || hasCityCapability(cityKey, item.key))
    .map((item) => ({
      href: item.key === "members" ? baseHref : `${baseHref}/${item.key}`,
      label: item.key === "members" && !hasCityCapability(cityKey, "members") ? "概要" : item.label,
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
