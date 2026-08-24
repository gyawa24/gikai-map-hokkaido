import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveCouncilDateRange,
  deriveScheduleDates,
  deriveSortMetadata,
  extractExplicitYears,
  sortMinutesIndex,
} from "../backfill-minutes-index-dates.mjs";

test("derives dates from schedule labels before council ids", () => {
  const range = deriveCouncilDateRange(
    { year: "2026", council_id: 20261004, name: "令和8年第4回定例会" },
    {
      schedules: [
        { name: "第4回定例会［6月18日］", minutes: [{ text: "本文" }] },
        { name: "第4回定例会［6月19日］", minutes: [{ text: "本文" }] },
      ],
    },
  );
  assert.deepEqual(range, { start_date: "2026-06-18", end_date: "2026-06-19" });
});

test("prefers the stated meeting date over an earlier notice date", () => {
  const dates = deriveScheduleDates(
    {
      name: "会議録本編",
      minutes: [{
        text: "令和8年5月8日 告示\n記\n1 期 日 令和8年5月20日\n2 場 所 議場",
      }],
    },
    "2026",
  );
  assert.deepEqual(dates, ["2026-05-20"]);
});

test("sorts same-year meetings by explicit end date and never by type-encoded id", () => {
  const sorted = sortMinutesIndex([
    { council_id: 20262003, year: "2026", sort_date: "2026-05-25" },
    { council_id: 20261004, year: "2026", sort_date: "2026-06-18" },
    { council_id: 20251004, year: "2025", sort_date: "2025-06-18" },
  ]);
  assert.deepEqual(sorted.map((entry) => entry.council_id), [20261004, 20262003, 20251004]);
});

test("uses month precision without inventing a meeting day", () => {
  assert.deepEqual(
    deriveSortMetadata({ year: "2025", name: "令和7年12月定例会議" }, null),
    { sort_date: "2025-12", date_precision: "month" },
  );
});

test("recognizes pre-Reiwa years instead of borrowing the index year", () => {
  assert.deepEqual(
    deriveScheduleDates(
      { name: "会議録", minutes: [{ text: "平成23年3月7日 開会" }] },
      "2024",
    ),
    ["2011-03-07"],
  );
  assert.deepEqual(extractExplicitYears("平成23年3月7日、令和6年3月8日"), [2011, 2024]);
});

test("recognizes a header weekday date even when the day suffix is omitted", () => {
  assert.deepEqual(
    deriveScheduleDates(
      {
        name: "第2号",
        minutes: [{ text: "令和8年第4回定例会 12月11(水曜日) 開議\n議案では10月1日の処分を報告" }],
      },
      "2026",
    ),
    ["2026-12-11"],
  );
});
