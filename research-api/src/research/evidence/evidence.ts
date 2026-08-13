import type { Evidence, PolicySourceDocument } from "../types.js";

export function toEvidence(
  document: PolicySourceDocument,
  excerpt = document.text,
): Evidence {
  return {
    id: document.id,
    municipalityId: document.municipalityId,
    municipalityName: document.municipalityName,
    sourceType: document.sourceType,
    title: document.title,
    excerpt,
    sourceUrl: document.sourceUrl,
    evidenceLevel: document.evidenceLevel,
    ...(document.date ? { date: document.date } : {}),
    ...(document.meetingName ? { meetingName: document.meetingName } : {}),
    ...(document.committeeName ? { committeeName: document.committeeName } : {}),
    ...(document.speaker ? { speaker: document.speaker } : {}),
    ...(document.speakerRole ? { speakerRole: document.speakerRole } : {}),
  };
}

export interface EvidenceLimits {
  maxItems: number;
  maxChars: number;
}

export function buildEvidenceSet(
  documents: readonly PolicySourceDocument[],
  limits: EvidenceLimits,
): Evidence[] {
  const maxItems = Math.max(0, Math.floor(limits.maxItems));
  const maxChars = Math.max(0, Math.floor(limits.maxChars));
  const seen = new Set<string>();
  const result: Evidence[] = [];
  let usedChars = 0;

  for (const document of documents) {
    if (result.length >= maxItems || usedChars >= maxChars) break;
    if (seen.has(document.id)) continue;
    seen.add(document.id);
    const remaining = maxChars - usedChars;
    const excerpt = document.text.slice(0, remaining);
    if (!excerpt && document.text) break;
    result.push(toEvidence(document, excerpt));
    usedChars += excerpt.length;
  }
  return result;
}
