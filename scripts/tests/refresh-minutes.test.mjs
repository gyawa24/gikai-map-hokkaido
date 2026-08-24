import assert from "node:assert/strict";
import test from "node:test";

import { defaultTargetYears } from "../refresh-minutes.mjs";

test("default refresh years include the execution year", () => {
  assert.deepEqual(
    defaultTargetYears(new Date("2026-08-23T00:00:00+09:00")),
    ["2024", "2025", "2026"],
  );
});
