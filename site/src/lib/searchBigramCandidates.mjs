export const SEARCH_POSTING_BUCKET_COUNT = 1024;

export function searchPostingBucket(term) {
  let hash = 0;
  for (let index = 0; index < term.length; index += 1) {
    hash = ((hash * 31) + term.charCodeAt(index)) >>> 0;
  }
  return hash % SEARCH_POSTING_BUCKET_COUNT;
}

export function searchPostingBucketFile(bucket) {
  return `${bucket.toString(16).padStart(3, "0")}.json`;
}

export function searchPostingBucketAssetFile(bucket) {
  return `${searchPostingBucketFile(bucket)}.gz`;
}

/**
 * @template {{ kind: string }} T
 * @param {T[]} variants
 * @param {"strict" | "fallback"} matchMode
 * @returns {T[]}
 */
export function variantsForBigramMatchMode(variants, matchMode) {
  if (matchMode === "fallback") return variants;
  return variants.filter(
    (variant) => variant.kind === "original" || variant.kind === "exact"
  );
}

/**
 * @param {number[]} left
 * @param {number[]} right
 */
function intersectNumberLists(left, right) {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
}

function postingDocumentIds(posting) {
  if (Array.isArray(posting)) return posting;
  return posting?.documentIds ?? [];
}

function containsSortedNumber(values, target) {
  let low = 0;
  let high = values.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const value = values[middle];
    if (value === target) return true;
    if (value < target) low = middle + 1;
    else high = middle - 1;
  }
  return false;
}

function positionalVariantMatches(variant, documentId, postingsByTerm) {
  const positionLists = variant.terms.map(
    (term) => postingsByTerm.get(term)?.positionsByDocument?.get(documentId) ?? []
  );
  if (positionLists.some((positions) => positions.length === 0)) return false;
  return positionLists[0].some((startPosition) =>
    positionLists.slice(1).every((positions, offset) =>
      containsSortedNumber(positions, startPosition + offset + 1)
    )
  );
}

function combineCandidateGroups(groups, searchMode) {
  if (groups.length === 0) return [];
  if (searchMode === "or") return unionNumberLists(groups);
  if (groups.some((group) => group.length === 0)) return [];
  return groups
    .slice(1)
    .reduce(
      (acc, group) => intersectNumberLists(acc, group),
      groups[0] ?? []
    );
}

/**
 * @param {number[][]} lists
 */
export function unionNumberLists(lists) {
  return Array.from(new Set(lists.flat()));
}

/**
 * Resolve document candidates from token-group variants. Each outer item is a
 * query token, each middle item is one original/exact/related variant, and each
 * inner item is the bigrams required by that variant.
 *
 * @param {string[][][]} variantTermGroups
 * @param {"and" | "or"} searchMode
 * @param {Map<string, number[] | { documentIds: number[]; positionsByDocument?: Map<number, number[]> }>} postingsByTerm
 */
export function candidateIdsFromBigramTermGroups(
  variantTermGroups,
  searchMode,
  postingsByTerm
) {
  const groupCandidates = variantTermGroups.map((variantGroups) => {
    const variantCandidates = variantGroups.map((terms) => {
      const lists = terms.map((term) => postingDocumentIds(postingsByTerm.get(term)));
      if (lists.some((list) => list.length === 0)) return [];
      return lists
        .slice(1)
        .reduce(
          (acc, list) => intersectNumberLists(acc, list),
          lists[0] ?? []
        );
    });
    return unionNumberLists(variantCandidates);
  });

  const nonEmptyGroups = groupCandidates.filter((group) => group.length > 0);
  if (nonEmptyGroups.length === 0) return [];
  if (searchMode === "or") return unionNumberLists(nonEmptyGroups);
  if (nonEmptyGroups.length !== groupCandidates.length) return [];
  return nonEmptyGroups
    .slice(1)
    .reduce(
      (acc, group) => intersectNumberLists(acc, group),
      nonEmptyGroups[0] ?? []
    );
}

/**
 * Resolve candidates while retaining whether the posting match alone proves
 * an exact match. A two- or three-character normalized variant is exactly
 * represented by one indexed n-gram; longer variants still need the source
 * search text checked unless they have a dedicated exact posting.
 *
 * @param {Array<Array<{ terms: string[]; exactByPosting: boolean; positional?: boolean }>>} variantGroups
 * @param {"and" | "or"} searchMode
 * @param {Map<string, number[] | { documentIds: number[]; positionsByDocument?: Map<number, number[]> }>} postingsByTerm
 */
export function resolveBigramCandidates(
  variantGroups,
  searchMode,
  postingsByTerm
) {
  const resolvedGroups = variantGroups.map((group) =>
    group.map((variant) => {
      const broadCandidates = candidateIdsFromBigramTermGroups(
        [[variant.terms]],
        "and",
        postingsByTerm
      );
      if (variant.positional) {
        const positionsAvailable = variant.terms.every(
          (term) => postingsByTerm.get(term)?.positionsByDocument instanceof Map
        );
        if (!positionsAvailable) {
          return { candidates: broadCandidates, exact: [] };
        }
        const exactCandidates = broadCandidates.filter((documentId) =>
          positionalVariantMatches(variant, documentId, postingsByTerm)
        );
        return { candidates: exactCandidates, exact: exactCandidates };
      }
      return {
        candidates: broadCandidates,
        exact: variant.exactByPosting ? broadCandidates : [],
      };
    })
  );
  const candidateIds = combineCandidateGroups(
    resolvedGroups.map((group) => unionNumberLists(group.map((variant) => variant.candidates))),
    searchMode
  );
  const exactIds = combineCandidateGroups(
    resolvedGroups.map((group) => unionNumberLists(group.map((variant) => variant.exact))),
    searchMode
  );
  const exact = new Set(exactIds);
  return {
    candidateIds,
    verificationIds: candidateIds.filter((id) => !exact.has(id)),
  };
}

/**
 * Return the city-local portion of a payload file that may be shared by
 * multiple municipalities.
 *
 * @template T
 * @param {T[]} payload
 * @param {{ start: number; end: number; payload_start: number; payload_end: number }} range
 * @returns {T[]}
 */
export function payloadSliceForRange(payload, range) {
  const localLength = range.end - range.start;
  const payloadLength = range.payload_end - range.payload_start;
  if (
    localLength <= 0
    || payloadLength !== localLength
    || range.payload_start < 0
    || range.payload_end > payload.length
  ) {
    throw new Error("invalid shared search payload range");
  }
  return payload.slice(range.payload_start, range.payload_end);
}
