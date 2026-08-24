import assert from "node:assert/strict";
import test from "node:test";

import {
  candidateIdsFromBigramTermGroups,
  payloadSliceForRange,
  resolveBigramCandidates,
  SEARCH_POSTING_BUCKET_COUNT,
  searchPostingBucket,
  searchPostingBucketAssetFile,
  variantsForBigramMatchMode,
} from "../../site/src/lib/searchBigramCandidates.mjs";

test("posting bucket数・hash・ファイル名はbuilder/client共通定義を使う", () => {
  assert.equal(SEARCH_POSTING_BUCKET_COUNT, 1024);
  const bucket = searchPostingBucket("道路整");
  assert.match(searchPostingBucketAssetFile(bucket), /^[0-3][0-9a-f]{2}\.json\.gz$/);
});

const variants = [
  { kind: "original", normalized: "除雪" },
  { kind: "exact", normalized: "除排雪" },
  { kind: "related", normalized: "雪対策" },
];

test("strict候補はoriginalとexactだけ、fallback候補はrelatedも含む", () => {
  assert.deepEqual(
    variantsForBigramMatchMode(variants, "strict").map((variant) => variant.kind),
    ["original", "exact"]
  );
  assert.deepEqual(
    variantsForBigramMatchMode(variants, "fallback").map((variant) => variant.kind),
    ["original", "exact", "related"]
  );
});

test("relatedだけに一致する全文索引文書はstrict候補へ混入しない", () => {
  const postings = new Map([
    ["除雪", [0]],
    ["除排", [1]],
    ["排雪", [1]],
    ["雪対", [2]],
    ["対策", [2]],
  ]);
  const termGroups = (matchMode) => [
    variantsForBigramMatchMode(variants, matchMode).map((variant) => {
      if (variant.kind === "original") return ["除雪"];
      if (variant.kind === "exact") return ["除排", "排雪"];
      return ["雪対", "対策"];
    }),
  ];

  const strictIds = candidateIdsFromBigramTermGroups(
    termGroups("strict"),
    "and",
    postings
  );
  const fallbackIds = candidateIdsFromBigramTermGroups(
    termGroups("fallback"),
    "and",
    postings
  );
  const documents = [
    { id: "original", fullTextIndexed: true },
    { id: "exact", fullTextIndexed: true },
    { id: "related-only", fullTextIndexed: true },
  ];

  assert.deepEqual(strictIds.map((id) => documents[id].id), ["original", "exact"]);
  assert.deepEqual(
    fallbackIds.map((id) => documents[id].id),
    ["original", "exact", "related-only"]
  );
});

test("ANDでは全token group、ORではいずれかのgroupを候補にする", () => {
  const groups = [
    [["防災"]],
    [["給食"]],
  ];
  const postings = new Map([
    ["防災", [0, 1]],
    ["給食", [1, 2]],
  ]);

  assert.deepEqual(candidateIdsFromBigramTermGroups(groups, "and", postings), [1]);
  assert.deepEqual(candidateIdsFromBigramTermGroups(groups, "or", postings), [0, 1, 2]);
});

test("2文字variantだけで確定した候補は全文検証を不要にする", () => {
  const resolution = resolveBigramCandidates(
    [[
      { terms: ["一般"], exactByPosting: true },
      { terms: ["除排", "排雪"], exactByPosting: false },
    ]],
    "and",
    new Map([
      ["一般", [0]],
      ["除排", [1, 2]],
      ["排雪", [1, 2]],
    ])
  );

  assert.deepEqual(resolution.candidateIds, [0, 1, 2]);
  assert.deepEqual(resolution.verificationIds, [1, 2]);
});

test("3文字以上の同義語exact postingは全文rangeを不要にする", () => {
  const resolution = resolveBigramCandidates(
    [[{ terms: ["子ども"], exactByPosting: true }]],
    "and",
    new Map([["子ども", [3, 7]]])
  );
  assert.deepEqual(resolution.candidateIds, [3, 7]);
  assert.deepEqual(resolution.verificationIds, []);
});

test("任意の3文字variantは1つのtrigramで全文rangeを不要にする", () => {
  const resolution = resolveBigramCandidates(
    [[{ terms: ["中学校"], exactByPosting: true }]],
    "and",
    new Map([["中学校", [2, 5]]])
  );
  assert.deepEqual(resolution.candidateIds, [2, 5]);
  assert.deepEqual(resolution.verificationIds, []);
});

test("4文字以上はtrigramの連続位置が一致する文書だけをexact候補にする", () => {
  const resolution = resolveBigramCandidates(
    [[{
      terms: ["道路整", "路整備"],
      exactByPosting: false,
      positional: true,
    }]],
    "and",
    new Map([
      ["道路整", {
        documentIds: [0, 1],
        positionsByDocument: new Map([[0, [4]], [1, [4]]]),
      }],
      ["路整備", {
        documentIds: [0, 1],
        positionsByDocument: new Map([[0, [5]], [1, [20]]]),
      }],
    ])
  );
  assert.deepEqual(resolution.candidateIds, [0]);
  assert.deepEqual(resolution.verificationIds, []);
});

test("低頻度trigramに位置列がなければ候補を全文rangeで再確認する", () => {
  const resolution = resolveBigramCandidates(
    [[{
      terms: ["希少な", "少な語"],
      exactByPosting: false,
      positional: true,
    }]],
    "and",
    new Map([
      ["希少な", { documentIds: [4, 8] }],
      ["少な語", { documentIds: [4, 8] }],
    ])
  );
  assert.deepEqual(resolution.candidateIds, [4, 8]);
  assert.deepEqual(resolution.verificationIds, [4, 8]);
});

test("ANDは各groupに2文字variant一致がある候補だけ検証不要にする", () => {
  const resolution = resolveBigramCandidates(
    [
      [{ terms: ["一般"], exactByPosting: true }],
      [
        { terms: ["質問"], exactByPosting: true },
        { terms: ["問い", "い合", "合わ", "わせ"], exactByPosting: false },
      ],
    ],
    "and",
    new Map([
      ["一般", [0, 1]],
      ["質問", [0]],
      ["問い", [1]],
      ["い合", [1]],
      ["合わ", [1]],
      ["わせ", [1]],
    ])
  );

  assert.deepEqual(resolution.candidateIds, [0, 1]);
  assert.deepEqual(resolution.verificationIds, [1]);
});

test("複数自治体で共有するpayloadから各自治体の範囲だけを読む", () => {
  const payload = ["a-0", "a-1", "b-0", "b-1"];
  assert.deepEqual(
    payloadSliceForRange(payload, {
      start: 0,
      end: 2,
      payload_start: 0,
      payload_end: 2,
    }),
    ["a-0", "a-1"]
  );
  assert.deepEqual(
    payloadSliceForRange(payload, {
      start: 0,
      end: 2,
      payload_start: 2,
      payload_end: 4,
    }),
    ["b-0", "b-1"]
  );
});
