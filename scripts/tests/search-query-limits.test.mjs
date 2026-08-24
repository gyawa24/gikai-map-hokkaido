import assert from "node:assert/strict";
import test from "node:test";

import {
  appendSearchQueryToHref,
  MAX_SEARCH_ASSET_REQUESTS_PER_QUERY,
  MAX_SEARCH_QUERY_INPUT_LENGTH,
  runtimeAgendaResultId,
  validateSearchAssetRequestPlan,
  validateSearchPostingPlan,
  validateSearchQueryLimits,
} from "../../site/src/lib/searchQueryLimits.mjs";

test("通常の全文検索語は共通query上限内に収まる", () => {
  assert.equal(MAX_SEARCH_ASSET_REQUESTS_PER_QUERY, 96);
  assert.equal(validateSearchQueryLimits("千歳市民の入院を受け入れた").ok, true);
  assert.equal(validateSearchQueryLimits("福祉 一般質問").ok, true);
});

test("1文字検索はruntime全shardを取得する前に拒否する", () => {
  assert.equal(validateSearchQueryLimits("市").ok, false);
  assert.equal(validateSearchQueryLimits("市 町").ok, false);
  assert.equal(validateSearchQueryLimits("A I").ok, false);
  assert.equal(validateSearchQueryLimits("議 会").ok, false);
  assert.equal(validateSearchQueryLimits("議会").ok, true);
});

test("数百文字pasteはposting取得を始める前に拒否する", () => {
  const query = "道路整備".repeat(100);
  let postingFetchCount = 0;

  if (validateSearchQueryLimits(query).ok) postingFetchCount += 1;

  assert.equal(postingFetchCount, 0);
  assert.equal(validateSearchQueryLimits(query).ok, false);
  assert.ok(query.length > MAX_SEARCH_QUERY_INPUT_LENGTH);
});

test("token数・展開term数・posting bucket数にも独立上限を設ける", () => {
  assert.equal(
    validateSearchQueryLimits("一 二 三 四 五 六 七 八 九").ok,
    false
  );
  assert.equal(
    validateSearchPostingPlan(
      Array.from({ length: 65 }, (_, index) => `term-${index}`),
      ["000.json.gz"]
    ).ok,
    false
  );
  assert.equal(
    validateSearchPostingPlan(
      ["道路整"],
      Array.from({ length: 33 }, (_, index) => `${index.toString(16).padStart(3, "0")}.json.gz`)
    ).ok,
    false
  );
});

test("検索assetはmanifest・posting・文書・Range合計96 requestでfail-closedにする", () => {
  const existing = new Set(Array.from({ length: 32 }, (_, index) => `posting:${index}`));
  assert.deepEqual(
    validateSearchAssetRequestPlan(
      existing,
      Array.from({ length: 64 }, (_, index) => `range:${index}`)
    ),
    { ok: true, requestCount: 96 }
  );
  assert.deepEqual(
    validateSearchAssetRequestPlan(existing, ["posting:0", ...Array.from(
      { length: 65 },
      (_, index) => `range:${index}`
    )]),
    { ok: false, requestCount: 97 }
  );
});

test("minutes全文検索結果はhashを保ったまま原文q導線を付ける", () => {
  assert.equal(
    appendSearchQueryToHref("/chitose/minutes/490#seg-2", "入院受入れ"),
    "/chitose/minutes/490?q=%E5%85%A5%E9%99%A2%E5%8F%97%E5%85%A5%E3%82%8C#seg-2"
  );
});

test("runtime client/APIも同一schedule内agenda_indexで結果IDを分離する", () => {
  const base = { city: "chitose", council_id: 490, schedule_index: 0 };
  assert.notEqual(
    runtimeAgendaResultId({ ...base, agenda_index: 0 }),
    runtimeAgendaResultId({ ...base, agenda_index: 1 })
  );
});
