export function selectedMinutesSchedule(
  selectedIndex: number,
  matchCounts: number[] | null,
  explicitlySelected: boolean,
): number {
  if (!matchCounts || explicitlySelected || matchCounts[selectedIndex] > 0) return selectedIndex;
  const firstMatch = matchCounts.findIndex((count) => count > 0);
  return firstMatch < 0 ? selectedIndex : firstMatch;
}
