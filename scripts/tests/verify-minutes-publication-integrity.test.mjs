import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { verifyMinutesPublicationIntegrity } from "../verify-minutes-publication-integrity.mjs";

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function fixture(dataDir, schedule) {
  const minutesDir = path.join(dataDir, "fixture", "minutes");
  writeJson(path.join(minutesDir, "index.json"), [{
    council_id: 20241001,
    name: "令和6年第1回定例会",
    year: "2024",
    file: "20241001.json",
    schedule_count: 1,
    start_date: "2024-03-08",
    end_date: "2024-03-08",
    sort_date: "2024-03-08",
    date_precision: "day",
  }]);
  writeJson(path.join(minutesDir, "20241001.json"), {
    council_id: 20241001,
    year: "2024",
    schedules: [schedule],
  });
}

test("accepts a synchronized publication index", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutes-integrity-ok-"));
  try {
    fixture(dataDir, {
      schedule_id: 1,
      name: "令和6年3月8日",
      minutes: [{ text: "令和6年第1回議会定例会会議録 令和6年3月8日開会" }],
    });
    const result = await verifyMinutesPublicationIntegrity({ dataDir });
    assert.deepEqual(result.errors, []);
    assert.equal(result.councilCount, 1);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("rejects a confirmed year mismatch and stale date metadata", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutes-integrity-bad-"));
  try {
    fixture(dataDir, {
      schedule_id: 1,
      name: "平成30年3月12日",
      minutes: [{ text: "平成30年第1回議会定例会会議録 平成30年3月12日開会" }],
    });
    const result = await verifyMinutesPublicationIntegrity({ dataDir });
    assert.ok(result.errors.some((message) => message.includes("conflicts with header year 2018")));
    assert.ok(result.errors.some((message) => message.includes("incorrect start_date")));
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
