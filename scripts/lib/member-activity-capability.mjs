export function hasPublishedMemberThemes(activity, { minutesAccess } = {}) {
  if (minutesAccess === "restricted") return false;
  if (!activity || typeof activity !== "object" || Array.isArray(activity)) return false;
  return Object.values(activity).some(
    (entry) =>
      entry?.classification_status === "classified" &&
      Array.isArray(entry.themes) &&
      entry.themes.length > 0
  );
}
