const DEFAULT_BASE_URL = "http://localhost:8787";
const PREVIEW_NOINDEX_HEADER = "noindex";
const RETRYABLE_STATUSES = new Set([500, 502, 503, 504]);
const REQUEST_ATTEMPTS = Number(process.env.CLOUDFLARE_SMOKE_ATTEMPTS ?? "5");
const REQUEST_TIMEOUT_MS = Number(process.env.CLOUDFLARE_SMOKE_TIMEOUT_MS ?? "20000");

function normalizeHost(host) {
  return (host ?? "").split(":")[0]?.trim().toLowerCase() ?? "";
}

function getArgValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const baseUrl = (
  getArgValue("--base") ??
  process.env.CLOUDFLARE_SMOKE_BASE_URL ??
  DEFAULT_BASE_URL
).replace(/\/+$/, "");

const indexableHosts = new Set([
  "chihougikai.com",
  "www.chihougikai.com",
  ...(process.env.GIKAI_INDEXABLE_HOSTS ?? "")
    .split(",")
    .map((host) => normalizeHost(host))
    .filter(Boolean),
]);
const baseHost = normalizeHost(new URL(baseUrl).host);
const isIndexableBaseHost = indexableHosts.has(baseHost);
const securityHeaders = {
  "content-security-policy": "default-src 'self'",
  "permissions-policy": "camera=()",
  "referrer-policy": "strict-origin-when-cross-origin",
  "strict-transport-security": "max-age=63072000",
  "x-content-type-options": "nosniff",
  "x-frame-options": "SAMEORIGIN",
};
const previewNoindexHeaders = isIndexableBaseHost
  ? {}
  : {
      "x-robots-tag": PREVIEW_NOINDEX_HEADER,
    };

const smokeCases = [
  {
    label: "top page",
    path: "/",
    status: 200,
    bodyIncludes: ["地方議会ドットコム", "og-site-v2.png", "summary_large_image"],
    headersInclude: {
      ...securityHeaders,
      ...previewNoindexHeaders,
    },
    headersExclude: isIndexableBaseHost
      ? {
          "x-robots-tag": "noindex",
        }
      : undefined,
  },
  {
    label: "privacy policy",
    path: "/privacy",
    status: 200,
    bodyIncludes: "Cloudflare, Inc.",
  },
  {
    label: "news page includes Cloudflare cutover note",
    path: "/news",
    status: 200,
    bodyIncludes: "サイトの配信基盤を更新しました",
  },
  {
    label: "city page with remote member photos",
    path: "/hakodate",
    status: 200,
    bodyIncludes: ["raw.githubusercontent.com", "https://chihougikai.com/hakodate"],
  },
  {
    label: "member detail with remote photo",
    path: "/hakodate/members/1",
    status: 200,
    bodyIncludes: "raw.githubusercontent.com",
  },
  {
    label: "dynamic member detail with GitHub Raw fallback",
    path: "/asahikawa/members/1",
    status: 200,
    bodyIncludes: "横山",
  },
  {
    label: "budget page with remote images",
    path: "/chitose/budgets/2026",
    status: 200,
    bodyIncludes: "raw.githubusercontent.com",
  },
  {
    label: "dynamic minutes list",
    path: "/chitose/minutes",
    status: 200,
    bodyIncludes: ["<title>議事録 - 千歳市", "千歳市", "公式議事録"],
    bodyExcludes: [
      "<title>ページが見つかりません",
      "noindex, nofollow",
      "NEXT_HTTP_ERROR_FALLBACK;404",
    ],
  },
  {
    label: "dynamic minutes retains capability navigation",
    path: "/chitose/minutes/578",
    status: 200,
    bodyCheck(body) {
      const navigation = body.match(/<nav\b[^>]*aria-label="千歳市議会内ナビゲーション"[^>]*>([\s\S]*?)<\/nav>/u)?.[1] ?? "";
      for (const href of ["/chitose", "/chitose/minutes", "/chitose/themes"]) {
        assert(navigation.includes(`href="${href}"`), `city navigation is missing ${href}`);
      }
    },
  },
  {
    label: "dynamic topic page",
    path: "/topics/u-e5ae9ae4be8be4bc9a",
    status: 200,
    bodyIncludes: ["定例会", "https://chihougikai.com/topics/u-e5ae9ae4be8be4bc9a"],
  },
  {
    label: "dynamic minutes detail",
    path: "/asahikawa/minutes/312",
    status: 200,
    headersInclude: {
      "content-security-policy": "connect-src 'self' https://raw.githubusercontent.com",
    },
    bodyIncludes: ["旭川", "raw.githubusercontent.com", "議事録本文を読み込んでいます"],
  },
  {
    label: "search API",
    path: "/api/search?q=%E4%BA%88%E7%AE%97",
    status: 200,
    headersInclude: {
      "x-gikai-search-mode": "client",
    },
    jsonKeys: ["sessionResults", "memberResults"],
  },
  {
    label: "search API city name",
    path: "/api/search?q=%E5%8D%83%E6%AD%B3%E5%B8%82",
    status: 200,
    headersInclude: {
      "x-gikai-search-mode": "client",
    },
    jsonKeys: ["sessionResults", "memberResults"],
  },
  {
    label: "search API repeat",
    path: "/api/search?q=%E4%BA%88%E7%AE%97",
    status: 200,
    headersInclude: {
      "x-gikai-search-mode": "client",
    },
    jsonKeys: ["sessionResults", "memberResults"],
  },
  {
    label: "search API repeat second",
    path: "/api/search?q=%E4%BA%88%E7%AE%97",
    status: 200,
    headersInclude: {
      "x-gikai-search-mode": "client",
    },
    jsonKeys: ["sessionResults", "memberResults"],
  },
  {
    label: "sitemap",
    path: "/sitemap.xml",
    status: 200,
    bodyIncludes: [
      "<urlset",
      "https://chihougikai.com/search",
      "https://chihougikai.com/hakodate",
      "https://chihougikai.com/chitose/budgets/2026",
      "https://chihougikai.com/topics/u-e8b2a1e694bfe383bbe4ba88e7ae97",
    ],
    bodyExcludes: ["https://chihougikai.com/topics/予算"],
  },
  {
    label: isIndexableBaseHost ? "production robots indexable" : "preview robots noindex",
    path: "/robots.txt",
    status: 200,
    bodyIncludes: isIndexableBaseHost ? "Allow: /" : "Disallow: /",
    headersInclude: isIndexableBaseHost
      ? undefined
      : {
          "x-robots-tag": PREVIEW_NOINDEX_HEADER,
        },
    headersExclude: isIndexableBaseHost
      ? {
          "x-robots-tag": "noindex",
        }
      : undefined,
  },
  {
    label: "static OGP image",
    path: "/og-site-v2.png",
    status: 200,
    contentTypeIncludes: "image/png",
  },
  {
    label: "legacy static OGP image",
    path: "/og-site.png",
    status: 200,
    contentTypeIncludes: "image/png",
  },
  {
    label: "legacy member CSV API redirect",
    path: "/api/export/members?city=chitose",
    status: 308,
    redirectLocationIncludes: "/generated/open-data/members/chitose.csv",
  },
  {
    label: "member CSV asset",
    path: "/generated/open-data/members/chitose.csv",
    status: 200,
    bodyIncludes: "seat_number,name,furigana",
  },
  {
    label: "legacy topic URL redirect",
    path: "/topics/%E4%BA%88%E7%AE%97",
    status: 308,
    redirectLocationIncludes: "/topics/u-e4ba88e7ae97",
  },
  {
    label: "legacy member photo redirect",
    path: "/members/hakodate/seat_1.jpg",
    status: 308,
    redirectLocationIncludes: "raw.githubusercontent.com",
  },
  {
    label: "legacy budget image redirect",
    path: "/budgets/chitose/2026/pages/page-001.webp",
    status: 308,
    redirectLocationIncludes: "raw.githubusercontent.com",
  },
  {
    label: "DNP migration preview is not exposed",
    path: "/chitose/minutes/578/preview",
    status: 404,
  },
  {
    label: "document migration preview is not exposed",
    path: "/iwamizawa/minutes/799/preview",
    status: 404,
  },
  {
    label: "remote MCP is not exposed",
    path: "/api/mcp",
    status: 404,
  },
  {
    label: "like API is not exposed",
    path: "/api/like?target=x",
    status: 404,
  },
];

function buildUrl(path) {
  return new URL(path, `${baseUrl}/`).toString();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetries(url) {
  let lastError;

  for (let attempt = 1; attempt <= REQUEST_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        redirect: "manual",
        signal: controller.signal,
      });
      if (!RETRYABLE_STATUSES.has(response.status) || attempt === REQUEST_ATTEMPTS) {
        return response;
      }
      lastError = new Error(`got retryable status ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === REQUEST_ATTEMPTS) break;
    } finally {
      clearTimeout(timeout);
    }

    await wait(1000 * attempt);
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function checkCase(testCase) {
  const response = await fetchWithRetries(buildUrl(testCase.path));
  let bodyWasRead = false;

  assert(
    response.status === testCase.status,
    `expected status ${testCase.status}, got ${response.status}`
  );

  if (testCase.redirectLocationIncludes) {
    const location = response.headers.get("location") ?? "";
    assert(
      location.includes(testCase.redirectLocationIncludes),
      `expected Location to include ${testCase.redirectLocationIncludes}, got ${location || "(empty)"}`
    );
  }

  if (testCase.contentTypeIncludes) {
    const contentType = response.headers.get("content-type") ?? "";
    assert(
      contentType.includes(testCase.contentTypeIncludes),
      `expected Content-Type to include ${testCase.contentTypeIncludes}, got ${contentType || "(empty)"}`
    );
  }

  if (testCase.headersInclude) {
    for (const [headerName, expected] of Object.entries(testCase.headersInclude)) {
      const value = response.headers.get(headerName) ?? "";
      assert(
        value.includes(expected),
        `expected ${headerName} header to include ${expected}, got ${value || "(empty)"}`
      );
    }
  }

  if (testCase.headersExclude) {
    for (const [headerName, disallowed] of Object.entries(testCase.headersExclude)) {
      const value = response.headers.get(headerName) ?? "";
      assert(
        !value.includes(disallowed),
        `expected ${headerName} header not to include ${disallowed}, got ${value}`
      );
    }
  }

  if (testCase.bodyIncludes || testCase.bodyExcludes || testCase.jsonKeys || testCase.bodyCheck) {
    const body = await response.text();
    bodyWasRead = true;

    if (testCase.bodyIncludes) {
      const expectedItems = Array.isArray(testCase.bodyIncludes)
        ? testCase.bodyIncludes
        : [testCase.bodyIncludes];
      for (const expected of expectedItems) {
        assert(
          body.includes(expected),
          `expected body to include ${expected}`
        );
      }
    }

    if (testCase.bodyExcludes) {
      const disallowedItems = Array.isArray(testCase.bodyExcludes)
        ? testCase.bodyExcludes
        : [testCase.bodyExcludes];
      for (const disallowed of disallowedItems) {
        assert(
          !body.includes(disallowed),
          `expected body not to include ${disallowed}`
        );
      }
    }

    if (testCase.bodyCheck) testCase.bodyCheck(body);

    if (testCase.jsonKeys) {
      const data = JSON.parse(body);
      for (const key of testCase.jsonKeys) {
        assert(Object.hasOwn(data, key), `expected JSON key ${key}`);
      }
    }
  }

  if (!bodyWasRead) {
    await response.body?.cancel().catch(() => undefined);
  }
}

const failures = [];

console.log(`Cloudflare smoke test: ${baseUrl}`);

for (const testCase of smokeCases) {
  try {
    await checkCase(testCase);
    console.log(`✓ ${testCase.label}`);
  } catch (error) {
    failures.push({ testCase, error });
    console.error(`✗ ${testCase.label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} smoke test(s) failed.`);
  process.exit(1);
}

console.log("Cloudflare smoke test passed.");
