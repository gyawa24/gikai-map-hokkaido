import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isIndexableRequestHost, PREVIEW_NOINDEX_HEADER } from "@/lib/indexing";
import { publicRawUrl } from "@/lib/publicRawUrl";
import { slugForTag, tagFromSlug } from "@/lib/topicAliases";

const TOPICS_PREFIX = "/topics/";
const BUDGETS_PREFIX = "/budgets/";
const MEMBERS_PREFIX = "/members/";
const MEMBER_EXPORT_PATH = "/api/export/members";
const SITE_OG_IMAGE_PATH = "/api/og-site";
const BUDGET_IMAGE_EXTENSIONS = new Set([".avif", ".jpg", ".jpeg", ".png", ".webp"]);
const MEMBER_IMAGE_EXTENSIONS = new Set([".avif", ".jpg", ".jpeg", ".png", ".webp"]);
const IS_DEVELOPMENT = process.env.NODE_ENV === "development";
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  IS_DEVELOPMENT
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  IS_DEVELOPMENT
    ? "connect-src 'self' http: https: ws: wss:"
    : "connect-src 'self' https://raw.githubusercontent.com",
  "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

function withPreviewNoindex(request: NextRequest, response: NextResponse) {
  response.headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  if (!isIndexableRequestHost(request.headers)) {
    response.headers.set("X-Robots-Tag", PREVIEW_NOINDEX_HEADER);
  }
  return response;
}

function redirectLegacyMembersExport(request: NextRequest) {
  const city = request.nextUrl.searchParams.get("city") ?? "";
  if (!/^[a-z0-9-]{1,64}$/i.test(city)) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = `/generated/open-data/members/${city}.csv`;
  url.search = "";
  return NextResponse.redirect(url, 308);
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith(BUDGETS_PREFIX)) {
    const imageExtension = pathname.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase();
    if (imageExtension && BUDGET_IMAGE_EXTENSIONS.has(imageExtension)) {
      return withPreviewNoindex(request, NextResponse.redirect(publicRawUrl(pathname), 308));
    }
  }

  if (pathname.startsWith(MEMBERS_PREFIX)) {
    const imageExtension = pathname.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase();
    if (imageExtension && MEMBER_IMAGE_EXTENSIONS.has(imageExtension)) {
      return withPreviewNoindex(request, NextResponse.redirect(publicRawUrl(pathname), 308));
    }
  }

  if (pathname === SITE_OG_IMAGE_PATH) {
    const url = request.nextUrl.clone();
    url.pathname = "/og-site-v2.png";
    url.search = "";
    return withPreviewNoindex(request, NextResponse.redirect(url, 308));
  }

  if (pathname === MEMBER_EXPORT_PATH) {
    return withPreviewNoindex(request, redirectLegacyMembersExport(request));
  }

  if (!pathname.startsWith(TOPICS_PREFIX) || pathname === "/topics") {
    return withPreviewNoindex(request, NextResponse.next());
  }

  const segment = pathname.slice(TOPICS_PREFIX.length).split("/")[0] ?? "";
  if (!segment || segment.startsWith("u-") || /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(segment)) {
    return withPreviewNoindex(request, NextResponse.next());
  }

  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    decoded = segment;
  }

  const url = request.nextUrl.clone();
  url.pathname = `${TOPICS_PREFIX}${slugForTag(tagFromSlug(decoded))}`;
  return withPreviewNoindex(request, NextResponse.redirect(url, 308));
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg).*)",
  ],
};
