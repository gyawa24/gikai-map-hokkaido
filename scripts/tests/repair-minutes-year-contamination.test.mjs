import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  detectScheduleYearMismatch,
  repairMunicipalityYearContamination,
} from "../repair-minutes-year-contamination.mjs";

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function schedule(scheduleId, name, text) {
  return {
    schedule_id: scheduleId,
    name,
    minutes: [{ minute_id: 1, text, source_url: `https://example.test/${scheduleId}.pdf` }],
  };
}

test("requires both meeting-date and header-year evidence", () => {
  assert.equal(
    detectScheduleYearMismatch(
      schedule(1, "3月会議第2号", "令和6年議会定例会会議録 令和5年3月8日 開議"),
      2024,
    ),
    null,
  );
  assert.equal(
    detectScheduleYearMismatch(
      schedule(1, "平成30年第1回定例会（平成30年3月12日）", "平成30年第1回議会定例会会議録"),
      2024,
    )?.detected_year,
    2018,
  );
  assert.equal(
    detectScheduleYearMismatch(
      schedule(
        2,
        "第2回定例会 一般質問",
        "令和2年第2回定例会（令和2年6月18日）一般質問。4月7日の宣言は5月25日に解除。",
      ),
      2024,
    )?.detected_year,
    2020,
  );
});

test("dry-run is read-only and write filters only confirmed schedules with a backup", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "minutes-year-repair-"));
  const slug = "fixture";
  const minutesDir = path.join(dataDir, slug, "minutes");
  const council = {
    council_id: 20241001,
    year: "2024",
    schedules: [
      schedule(1, "令和6年第1回定例会（令和6年3月8日）", "令和6年第1回議会定例会会議録"),
      schedule(2, "平成30年第1回定例会（平成30年3月9日）", "平成30年第1回議会定例会会議録"),
    ],
  };
  writeJson(path.join(minutesDir, "index.json"), [{
    council_id: 20241001,
    year: "2024",
    file: "20241001.json",
    schedule_count: 2,
    start_date: "2018-03-09",
    sort_date: "2018-03-09",
  }]);
  writeJson(path.join(minutesDir, "20241001.json"), council);

  try {
    const dryRun = await repairMunicipalityYearContamination(slug, { dataDir });
    assert.equal(dryRun.removedSchedules, 1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(minutesDir, "20241001.json"))).schedules.length, 2);

    const written = await repairMunicipalityYearContamination(slug, { dataDir, write: true });
    assert.equal(written.removedSchedules, 1);
    const repaired = JSON.parse(fs.readFileSync(path.join(minutesDir, "20241001.json")));
    assert.deepEqual(repaired.schedules.map((item) => item.schedule_id), [1]);
    const index = JSON.parse(fs.readFileSync(path.join(minutesDir, "index.json")));
    assert.equal(index[0].schedule_count, 1);
    assert.equal("start_date" in index[0], false);
    assert.equal("sort_date" in index[0], false);
    const backup = JSON.parse(fs.readFileSync(
      path.join(dataDir, slug, "quarantine", "minutes", "year-mismatch", "20241001.json"),
    ));
    assert.equal(backup.schedules.length, 2);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
