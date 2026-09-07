import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const siteRoot = fileURLToPath(new URL("../../site/", import.meta.url));
const siteRequire = createRequire(path.join(siteRoot, "package.json"));
const ts = siteRequire("typescript");
const React = siteRequire("react");
const { renderToStaticMarkup } = siteRequire("react-dom/server");

function Link({ children, prefetch: _prefetch, ...props }) {
  return React.createElement("a", props, children);
}

// Next.jsの実行環境だけを差し替え、実際のTS/TSXをSSRする。ソース内容の文字列比較はしない。
function createLoader(mocks = {}, globals = {}) {
  const cache = new Map();
  function load(relativePath) {
    const filename = path.resolve(siteRoot, relativePath);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    if (filename.endsWith(".json")) {
      module.exports = JSON.parse(fs.readFileSync(filename, "utf8"));
      return module.exports;
    }
    const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
      fileName: filename,
    }).outputText;
    function requireModule(id) {
      if (Object.hasOwn(mocks, id)) return mocks[id];
      if (id === "next/link") return { default: Link, __esModule: true };
      if (id === "fs" || id === "node:fs") {
        throw new Error("ページのソースファイルを本番ランタイムで参照してはいけません");
      }
      if (id.startsWith(".") || id.startsWith("@/")) {
        const base = id.startsWith("@/")
          ? path.join(siteRoot, "src", id.slice(2))
          : path.resolve(path.dirname(filename), id);
        const resolved = [base, `${base}.ts`, `${base}.tsx`].find((candidate) => fs.existsSync(candidate));
        assert.ok(resolved, `Cannot resolve ${id} from ${filename}`);
        return load(resolved);
      }
      return siteRequire(id);
    }
    vm.runInNewContext(code, {
      module,
      exports: module.exports,
      require: requireModule,
      process,
      URL,
      ...globals,
    }, { filename });
    return module.exports;
  }
  return load;
}

const { minutesDateLabel } = createLoader()("src/lib/minutesIndexPresentation.ts");

test("実際の公開台帳を静的に読み込み、WorkerのFSなしでも機能とナビを維持する", () => {
  const load = createLoader({
    "next/navigation": { usePathname: () => "/chitose/minutes/578" },
  });
  const capabilities = load("src/lib/cityCapabilities.ts");
  assert.equal(capabilities.hasCityCapability("chitose", "minutes"), true);
  assert.equal(capabilities.hasCityCapability("chitose", "members"), true);
  assert.equal(capabilities.hasCityCapability("unknown-municipality", "minutes"), false);
  assert.equal(capabilities.hasCityCapability("chitose", "invalid-capability"), false);
  const unknown = capabilities.getCityCapability("unknown-municipality");
  assert.equal(unknown.slug, "unknown-municipality");
  assert.ok(Object.values(unknown.capabilities).every((value) => value === false));
  assert.equal(Object.keys(unknown.paths).length, 0);
  assert.equal(capabilities.getCityCapabilities().chitose.capabilities.minutes, true);

  const Header = load("src/components/CityHeaderServer.tsx").default;
  const html = renderToStaticMarkup(React.createElement(Header));
  for (const href of ["/chitose", "/chitose/sessions", "/chitose/minutes", "/chitose/themes", "/chitose/budgets", "/chitose/decisions"]) {
    assert.ok(html.includes(`href="${href}"`), `${href} is missing`);
  }
  assert.ok(html.includes("議員"));
  const currentLinks = [...html.matchAll(/<a\b[^>]*aria-current="page"[^>]*>/g)];
  assert.equal(currentLinks.length, 1);
  assert.ok(currentLinks[0][0].includes('href="/chitose/minutes"'));
});

test("複数開催日を含むPDF1件を1日程と断定せず、日程・資料の件数として表示する", () => {
  const load = createLoader({
    "next/navigation": {
      useSearchParams: () => new URLSearchParams(),
      useRouter: () => ({}),
      usePathname: () => "/abashiri/minutes",
    },
  });
  const MinutesIndex = load("src/components/MinutesIndexClient.tsx").default;
  const html = renderToStaticMarkup(React.createElement(MinutesIndex, {
    city: "abashiri",
    items: [{
      council_id: 20251003,
      name: "令和7年第3回定例会",
      year: "2025",
      japanese_year: "令和7年",
      type_label: "本会議 > 定例会",
      file: "20251003.json",
      schedule_count: 1,
      start_date: "2025-09-02",
      end_date: "2025-09-22",
      date_precision: "day",
      enriched: null,
    }],
  }));
  assert.ok(html.includes("日程・資料 1件"));
  assert.ok(!html.includes("1日程"));
  assert.ok(html.includes("2025年9月2日〜2025年9月22日"));
});

test("開催日の精度と欠測を保持し、不正な日付を表示しない", () => {
  assert.equal(minutesDateLabel({ start_date: "2026-03-02", end_date: "2026-03-26", date_precision: "day" }), "2026年3月2日〜2026年3月26日");
  assert.equal(minutesDateLabel({ start_date: "2026-03-01", end_date: "2026-03-31", date_precision: "month" }), "2026年3月");
  assert.equal(minutesDateLabel({}), "開催日未確認");
  assert.equal(minutesDateLabel({ start_date: "2026-02-30" }), "開催日未確認");
  assert.equal(minutesDateLabel({ start_date: "2026-03-02" }), "2026年3月2日開始（終了日未確認）");
});

const municipalityFixtures = [
  { slug: "chitose", council_name: "千歳市議会", active: true },
  { slug: "eniwa", council_name: "恵庭市議会", active: true },
  { slug: "tomakomai", council_name: "苫小牧市議会", active: true },
  { slug: "abashiri", council_name: "網走市議会", active: true },
];

for (const [pathname, currentHref] of [
  ["/chitose/minutes/578", "/chitose/minutes"],
  ["/eniwa", "/eniwa"],
  ["/tomakomai/members/1", "/tomakomai"],
  ["/abashiri/minutes", "/abashiri/minutes"],
]) {
  test(`ソースFSがなくても${pathname}のナビを描画し、現在地を一つにする`, () => {
    const load = createLoader({
      "next/navigation": { usePathname: () => pathname },
      "@/lib/municipalities": { getMunicipalities: () => municipalityFixtures },
      "@/lib/cityCapabilities": { hasCityCapability: (_city, key) => ["members", "minutes", "sessions", "themes"].includes(key) },
    });
    const Header = load("src/components/CityHeaderServer.tsx").default;
    const html = renderToStaticMarkup(React.createElement(Header));
    const currentLinks = [...html.matchAll(/<a\b[^>]*aria-current="page"[^>]*>/g)];
    assert.equal(currentLinks.length, 1);
    assert.ok(currentLinks[0][0].includes(`href="${currentHref}"`));
    assert.ok(html.includes("内ナビゲーション"));
    assert.ok(html.includes(`href="/${pathname.split("/")[1]}/minutes"`));
    assert.ok(!html.includes(`href="/${pathname.split("/")[1]}/budgets"`), "未掲載機能はナビに出さない");
  });
}

const emptyMessage = "現在、掲載されている議事録はありません。";
const failedMessage = "議事録一覧を読み込めませんでした";

for (const fixture of [
  { name: "正常なローカル空配列", local: "[]", status: 404, expected: emptyMessage },
  { name: "ローカルJSON破損", local: "{", status: 404, expected: failedMessage },
  { name: "ローカルの不正なルート形式", local: "{}", status: 404, expected: failedMessage },
  { name: "remoteのHTTP障害", local: null, status: 503, expected: failedMessage },
  { name: "公開台帳にある一覧がremoteで欠落", local: null, status: 404, expected: failedMessage },
  { name: "正常なremote空配列", local: null, status: 200, expected: emptyMessage },
  { name: "公式URLを持つ自治体", local: "[]", status: 404, expected: emptyMessage, municipality: { minutes_official_url: "https://example.com/council/minutes" }, sourceUrl: "https://example.com/council/minutes" },
  { name: "閲覧停止中のDNP自治体", local: "[]", status: 404, expected: emptyMessage, municipality: { system: "dnp", tenant_id: 1, minutes_access: "restricted" }, sourceUrl: "https://ssp.kaigiroku.net/tenant/chitose/MinuteBrowse.html" },
]) {
  test(`${fixture.name}を読み込み、未掲載と障害を区別する`, async () => {
    const municipality = { ...municipalityFixtures[0], name: "千歳市", ...fixture.municipality };
    const load = createLoader({
      fs: { existsSync: () => fixture.local !== null, readFileSync: () => fixture.local },
      "next/navigation": { notFound: () => { throw new Error("unexpected 404"); } },
      "@/components/JsonLd": { default: () => null, __esModule: true },
      "@/components/MinutesIndexClient": { default: () => null, __esModule: true },
      "@/lib/cityCapabilities": { hasCityCapability: () => true },
      "@/lib/municipalities": { getMunicipality: () => municipality },
      "@/lib/metadata": { absoluteUrl: (value) => `https://example.com${value}` },
      "@/lib/minutesPresentation": {},
      "@/lib/staticCityParams": {},
      "@/lib/structuredData": { buildBreadcrumbList: () => ({}) },
      "@/lib/structured-minutes/loadStructuredMinutes": {},
    }, {
      fetch: async () => ({ status: fixture.status, ok: fixture.status === 200, json: async () => [] }),
    });
    const Page = load("src/app/[city]/minutes/page.tsx").default;
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ city: "chitose" }) }));
    assert.ok(html.includes(fixture.expected));
    assert.ok(!html.includes(fixture.expected === failedMessage ? emptyMessage : failedMessage));
    assert.ok(html.includes("千歳市議会の議事録"));
    if (fixture.expected === failedMessage) assert.ok(html.includes('role="alert"'));
    if (fixture.sourceUrl) {
      assert.ok(html.includes(`href="${fixture.sourceUrl}"`));
      assert.ok(html.includes("公式会議録の一覧・検索"));
      assert.ok(!html.includes("この資料の公式原典"), "一覧URLを個別資料の原典と呼ばない");
    } else {
      assert.ok(html.includes("公式原典のURLは確認中です。"));
    }
  });
}
