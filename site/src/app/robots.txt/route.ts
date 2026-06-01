import { isIndexableRequestHost, PREVIEW_NOINDEX_HEADER } from "@/lib/indexing";

const SITEMAP_URL = "https://chihougikai.com/sitemap.xml";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  if (!isIndexableRequestHost(request.headers)) {
    return new Response("User-agent: *\nDisallow: /\n", {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Robots-Tag": PREVIEW_NOINDEX_HEADER,
      },
    });
  }

  return new Response(`User-agent: *\nAllow: /\nSitemap: ${SITEMAP_URL}\n`, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
