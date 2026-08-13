import "server-only";
import coverageData from "../../public/generated/research-coverage.json";

type ResearchCoverage = {
  municipalities?: Array<{ slug?: string; agendaCount?: number }>;
};

export function getResearchCoverageMunicipalityIds(): Set<string> {
  const coverage = coverageData as ResearchCoverage;
  return new Set(
    (coverage.municipalities ?? [])
      .filter(
        (municipality) =>
          typeof municipality.slug === "string" &&
          (municipality.agendaCount ?? 0) > 0,
      )
      .map((municipality) => municipality.slug as string),
  );
}
