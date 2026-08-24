import assert from "node:assert/strict";
import test from "node:test";
import { mergeQuestionersWithProvenance } from "../../site/scripts/lib/merge-questioners.mjs";

test("AI-only questioner topics never become structure-derived topics", () => {
  assert.deepEqual(
    mergeQuestionersWithProvenance([], [
      { name: "山田太郎", topics: ["生成AIによる補足", "生成AIによる補足"] },
    ]),
    [
      {
        name: "山田太郎",
        topics: [],
        ai_topics: ["生成AIによる補足"],
        topics_source: "ai_generated",
      },
    ]
  );
});

test("structured topics stay separate from matched AI additions", () => {
  assert.deepEqual(
    mergeQuestionersWithProvenance(
      [{ name: "山田太郎", topics: ["防災について"] }],
      [{ name: "山田太郎議員", topics: ["防災について", "避難所の改善"] }]
    ),
    [
      {
        name: "山田太郎",
        topics: ["防災について"],
        ai_topics: ["避難所の改善"],
        topics_source: "minutes_structure",
      },
    ]
  );
});
