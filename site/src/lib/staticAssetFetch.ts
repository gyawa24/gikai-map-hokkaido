export async function fetchCloudflareStaticAsset(url: URL): Promise<Response | null> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const { env } = await getCloudflareContext({ async: true });
    if (env.ASSETS) {
      return env.ASSETS.fetch(url);
    }
  } catch {
    // Non-Cloudflare runtimes do not expose the static asset binding.
  }

  return null;
}

export async function fetchStaticAsset(url: URL): Promise<Response> {
  const assetResponse = await fetchCloudflareStaticAsset(url);
  if (assetResponse) return assetResponse;
  return fetch(url, { cache: "force-cache" });
}
