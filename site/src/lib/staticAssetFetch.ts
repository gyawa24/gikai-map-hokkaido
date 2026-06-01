export async function fetchStaticAsset(url: URL): Promise<Response> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const { env } = await getCloudflareContext({ async: true });
    if (env.ASSETS) {
      return env.ASSETS.fetch(url);
    }
  } catch {
    // Non-Cloudflare runtimes can use the normal public asset route.
  }

  return fetch(url, { cache: "force-cache" });
}
