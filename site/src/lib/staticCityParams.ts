import { getCityCapabilities, type CityCapabilityKey } from "@/lib/cityCapabilities";
import { getMunicipalities } from "@/lib/municipalities";

export type CityStaticParam = { city: string };

export function getActiveCityStaticParams(): CityStaticParam[] {
  return getMunicipalities()
    .filter((municipality) => municipality.active)
    .map((municipality) => ({ city: municipality.slug }));
}

export function getCapabilityCityStaticParams(capability: CityCapabilityKey): CityStaticParam[] {
  const capabilitiesBySlug = getCityCapabilities();
  return getMunicipalities()
    .filter((municipality) => municipality.active)
    .filter((municipality) => Boolean(capabilitiesBySlug[municipality.slug]?.capabilities[capability]))
    .map((municipality) => ({ city: municipality.slug }));
}

