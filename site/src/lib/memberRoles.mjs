/**
 * @param {string | undefined} faction
 * @returns {string[]}
 */
export function extractFactionLeadershipLabels(faction) {
  const compact = String(faction ?? "").replace(/[\s　]/g, "");
  const match = compact.match(/[（(]((?:副)?議長)[）)]$/u);
  return match ? [match[1]] : [];
}
