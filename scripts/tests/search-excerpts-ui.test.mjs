import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { buildMultiTermSearchExcerpt } from "../../site/src/lib/searchExcerpts.mjs";

const siteRequire = createRequire(new URL("../../site/package.json", import.meta.url));
const ts = siteRequire("typescript");
const React = siteRequire("react");
const { renderToStaticMarkup } = siteRequire("react-dom/server");

// Exercise the real private render/serialization functions without starting Next.js,
// fetching search assets, or replacing the excerpt implementation with a mock.
function loadFunctions(relativePath, names) {
  const source = fs.readFileSync(new URL(`../../site/${relativePath}`, import.meta.url), "utf8");
  const ast = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true);
  const functions = ast.statements.filter((node) =>
    ts.isFunctionDeclaration(node) && names.includes(node.name?.text)
  );
  assert.equal(functions.length, names.length);
  const code = ts.transpileModule(
    `${functions.map((node) => node.getText(ast)).join("\n")}\nexport { ${names.join(", ")} };`,
    { fileName: relativePath, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }
  ).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: siteRequire }, { filename: relativePath });
  return module.exports;
}

const { SearchResultExcerpt } = loadFunctions("src/components/SearchClient.tsx", ["Highlight", "SearchResultExcerpt"]);
const renderExcerpt = (result, tokens) => renderToStaticMarkup(React.createElement(SearchResultExcerpt, { result, tokens }));
const json = (value) => JSON.parse(JSON.stringify(value));

const body = `学校給食は施設整備について。${"別件の説明。".repeat(100)}保育料の無償化について。`;
const tokens = ["学校給食", "無償化"];
const excerpt = buildMultiTermSearchExcerpt(body, tokens);

for (const relativePath of ["src/components/SearchClient.tsx", "src/app/api/search/route.ts"]) {
  test(`${relativePath} keeps rich excerpt fields, original identity and URL when dropping score`, () => {
    const { stripSessionScore } = loadFunctions(relativePath, ["stripSessionScore"]);
    const hit = {
      id: "agenda-fulltext:chitose:578:0", city: "chitose", cityName: "千歳市",
      sourceType: "minutes", title: "定例会", committee: "議題", href: "/chitose/minutes/578?q=学校給食%20無償化",
      segIndex: 0, label: "本会議", startTime: "", field: "議事録", date: "2026-03-02", year: "2026",
      score: 998, ...excerpt,
    };
    const { score: ignored, ...expected } = hit;
    void ignored;
    assert.deepEqual(json(stripSessionScore([hit])), [expected]);
    const legacy = { ...hit, context: "本文が検索語に該当する会議です。" };
    for (const key of ["snippetSegments", "snippetSourceLength", "separated", "snippetCoverageComplete"]) delete legacy[key];
    const { score: legacyScore, ...expectedLegacy } = legacy;
    void legacyScore;
    assert.deepEqual(json(stripSessionScore([legacy])), [expectedLegacy]);
  });
}

test("separated original excerpts render as separate paragraphs with an explicit topic caveat", () => {
  const html = renderExcerpt(excerpt, tokens);
  assert.equal((html.match(/<p /g) ?? []).length, 3);
  assert.equal((html.match(/<mark /g) ?? []).length, 2);
  assert.ok(html.includes("同じ話題とは限りません。"));
  assert.ok(html.includes('class="text-sm leading-relaxed text-[#4A5568]"'));
  assert.ok(!html.includes("[…別の箇所…]"));
  assert.ok(!html.includes("抜粋に収まらない"));
});

test("a continuous full-body excerpt has no invented ellipsis or separation notice", () => {
  const result = buildMultiTermSearchExcerpt("学校給食の無償化。", tokens);
  const html = renderExcerpt(result, tokens);
  assert.equal((html.match(/<p /g) ?? []).length, 1);
  assert.ok(!html.includes("…"));
  assert.ok(!html.includes("同じ話題"));
  const incomplete = renderExcerpt({ ...result, snippetCoverageComplete: false }, tokens);
  assert.ok(incomplete.includes("抜粋に収まらない検索語があります。全文をご確認ください。"));
});

test("legacy fallback and rich excerpts both escape HTML, while regex characters remain literal", () => {
  const unsafe = '<script>alert("x")</script> 学校給食 [無償化]';
  for (const result of [
    { context: unsafe },
    buildMultiTermSearchExcerpt(unsafe, ["学校給食", "[無償化]"]),
  ]) {
    const html = renderExcerpt(result, ["学校給食", "[無償化]"]);
    assert.ok(html.includes("&lt;script&gt;"));
    assert.ok(!html.includes("<script>"));
    assert.equal((html.match(/<mark /g) ?? []).length, 2);
  }
  const description = "検索対象の本文が検索語に該当する会議です。原文で該当箇所を確認できます。";
  const html = renderExcerpt({ context: description }, []);
  assert.ok(html.includes(description));
  assert.equal((html.match(/<p /g) ?? []).length, 1);
  assert.ok(!html.includes("抜粋しています"));
});
