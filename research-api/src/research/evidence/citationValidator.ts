import type {
  AnalysisSections,
  CitationValidationSummary,
  Evidence,
} from "../types.js";

export interface CitationValidationResult {
  sections: AnalysisSections;
  summary: CitationValidationSummary;
}

export function validateCitations(
  sections: AnalysisSections,
  evidences: readonly Evidence[],
): CitationValidationResult {
  const trusted = new Map(evidences.map((evidence) => [evidence.id, evidence]));
  const invalid = new Set<string>();
  let removedReferenceCount = 0;
  let removedSectionCount = 0;

  const filterIds = (
    ids: readonly string[],
    municipality?: { id: string; name: string },
  ): { ids: string[]; rejected: boolean } => {
    const seen = new Set<string>();
    const valid: string[] = [];
    let rejected = false;
    for (const id of ids) {
      const evidence = trusted.get(id);
      const matchesMunicipality =
        !municipality ||
        (evidence?.municipalityId === municipality.id &&
          evidence.municipalityName === municipality.name);
      if (!evidence || !matchesMunicipality) {
        invalid.add(id);
        removedReferenceCount += 1;
        rejected = true;
      } else if (!seen.has(id)) {
        seen.add(id);
        valid.push(id);
      }
    }
    return { ids: valid, rejected };
  };

  const retainReferenced = <T extends { evidenceIds: string[] }>(
    values: readonly T[],
    map: (value: T) => { value: T; rejected: boolean },
  ): T[] =>
    values.flatMap((value) => {
      const mapped = map(value);
      if (mapped.rejected || mapped.value.evidenceIds.length === 0) {
        removedSectionCount += 1;
        return [];
      }
      return [mapped.value];
    });

  const validated: AnalysisSections = {
    summary: sections.summary,
    keyIssues: retainReferenced(sections.keyIssues, (value) => {
      const filtered = filterIds(value.evidenceIds);
      return {
        value: { ...value, evidenceIds: filtered.ids },
        rejected: filtered.rejected,
      };
    }),
    municipalityComparisons: retainReferenced(
      sections.municipalityComparisons,
      (value) => {
        const filtered = filterIds(value.evidenceIds, {
          id: value.municipalityId,
          name: value.municipalityName,
        });
        return {
          value: { ...value, evidenceIds: filtered.ids },
          rejected: filtered.rejected,
        };
      },
    ),
    administrationResponsePatterns: retainReferenced(
      sections.administrationResponsePatterns,
      (value) => {
        const filtered = filterIds(value.evidenceIds);
        return {
          value: { ...value, evidenceIds: filtered.ids },
          rejected: filtered.rejected,
        };
      },
    ),
    policyOptions: retainReferenced(sections.policyOptions, (value) => {
      const filtered = filterIds(value.evidenceIds);
      return {
        value: { ...value, evidenceIds: filtered.ids },
        rejected: filtered.rejected,
      };
    }),
    nextResearchItems: [...sections.nextResearchItems],
    limitations: [...sections.limitations],
  };

  return {
    sections: validated,
    summary: {
      valid: invalid.size === 0,
      invalidEvidenceIds: Array.from(invalid),
      removedReferenceCount,
      removedSectionCount,
    },
  };
}
