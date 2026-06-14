export const PREVIEW_NOINDEX_HEADER = "noindex, nofollow";

const INDEXABLE_HOSTS = new Set([
  "chihougikai.com",
  ...(process.env.GIKAI_INDEXABLE_HOSTS ?? "")
    .split(",")
    .map((host) => normalizeHost(host))
    .filter(Boolean),
]);

export function normalizeHost(host: string | null): string {
  return (host ?? "").split(":")[0]?.trim().toLowerCase() ?? "";
}

export function isIndexableHost(host: string | null): boolean {
  const normalized = normalizeHost(host);
  return Boolean(normalized && INDEXABLE_HOSTS.has(normalized));
}

export function isIndexableRequestHost(headers: Headers): boolean {
  return isIndexableHost(headers.get("host"));
}
