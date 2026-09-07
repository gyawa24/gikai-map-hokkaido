import cityCapabilitiesData from "../../data/_city-capabilities.json";

export type CityCapabilityKey =
  | "members"
  | "minutes"
  | "sessions"
  | "themes"
  | "budgets"
  | "decisions"
  | "schedule"
  | "newsletter"
  | "election"
  | "plan"
  | "segments";

export type CityCapability = {
  slug: string;
  capabilities: Record<CityCapabilityKey, boolean>;
  paths: Partial<Record<CityCapabilityKey, string>>;
};

type CityCapabilitiesIndex = {
  version: number;
  generated_at: string;
  source: string;
  cities: Record<string, CityCapability>;
};

const CAPABILITY_DEFINITIONS: { key: CityCapabilityKey; paths: string[] }[] = [
  { key: "members", paths: ["members.json"] },
  { key: "minutes", paths: ["minutes/index.json", "index.json"] },
  { key: "sessions", paths: ["sessions/index.json"] },
  { key: "themes", paths: ["members_activity.json"] },
  { key: "budgets", paths: ["budgets/index.json"] },
  { key: "decisions", paths: ["decisions.json"] },
  { key: "schedule", paths: ["schedule.json"] },
  { key: "newsletter", paths: ["newsletter.json"] },
  { key: "election", paths: ["election.json"] },
  { key: "plan", paths: ["comprehensive_plan.json"] },
  { key: "segments", paths: ["segments/_index.json"] },
];

// Workerでも生成済みの公開台帳を参照できるよう、ビルド時に取り込む。
const capabilityIndex = cityCapabilitiesData as CityCapabilitiesIndex;

function emptyCityCapability(slug: string): CityCapability {
  const capabilities = Object.fromEntries(
    CAPABILITY_DEFINITIONS.map((definition) => [definition.key, false])
  ) as Record<CityCapabilityKey, boolean>;
  return { slug, capabilities, paths: {} };
}

export function getCityCapability(slug: string): CityCapability {
  return capabilityIndex.cities[slug] ?? emptyCityCapability(slug);
}

export function getCityCapabilities(): Record<string, CityCapability> {
  return capabilityIndex.cities;
}

export function hasCityCapability(slug: string, key: string): boolean {
  if (!CAPABILITY_DEFINITIONS.some((definition) => definition.key === key)) return false;
  return Boolean(getCityCapability(slug).capabilities[key as CityCapabilityKey]);
}

export function getAvailableCityCapabilityKeys(
  capability: CityCapability,
  { includeInternal = false }: { includeInternal?: boolean } = {}
): CityCapabilityKey[] {
  return CAPABILITY_DEFINITIONS
    .filter((definition) => includeInternal || definition.key !== "segments")
    .filter((definition) => capability.capabilities[definition.key])
    .map((definition) => definition.key);
}
