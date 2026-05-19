import fs from "fs";
import path from "path";

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

let cachedIndex: CityCapabilitiesIndex | null = null;

function getDataRoot(): string {
  return path.join(/*turbopackIgnore: true*/ process.cwd(), "data");
}

function readIndex(): CityCapabilitiesIndex | null {
  if (cachedIndex) return cachedIndex;
  const filePath = path.join(/*turbopackIgnore: true*/ getDataRoot(), "_city-capabilities.json");
  try {
    cachedIndex = JSON.parse(fs.readFileSync(filePath, "utf-8")) as CityCapabilitiesIndex;
    return cachedIndex;
  } catch {
    return null;
  }
}

function emptyCityCapability(slug: string): CityCapability {
  const capabilities = Object.fromEntries(
    CAPABILITY_DEFINITIONS.map((definition) => [definition.key, false])
  ) as Record<CityCapabilityKey, boolean>;
  return { slug, capabilities, paths: {} };
}

export function getCityCapability(slug: string): CityCapability {
  return readIndex()?.cities[slug] ?? emptyCityCapability(slug);
}

export function getCityCapabilities(): Record<string, CityCapability> {
  const index = readIndex();
  if (index) return index.cities;
  return {};
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
