import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { repairPdfMinuteGroupings } from "../repair-pdf-minute-groupings.mjs";

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function schedule({ id, date, heading, url, text = "原文本文" }) {
  return {
    schedule_id: id,
    name: `${String(date.getMonth() + 1).padStart(2, "0")}月${String(date.getDate()).padStart(2, "0")}日 第${id}号`,
    page_no: id,
    minutes: [{
      minute_id: id,
      title: "会議録",
      minute_type: "本会議",
      text: `${heading}\n${text}`,
      source_url: url,
    }],
  };
}

function council(id, year, type, schedules) {
  return {
    council_id: id,
    name: `令和${year - 2018}年第${id % 100}回${type}`,
    year: String(year),
    japanese_year: `令和${year - 2018}年`,
    type_label: `全会議 > 本会議 > ${type}`,
    schedules,
  };
}

function setupCity(dataRoot, slug, councils) {
  const minutesDir = path.join(dataRoot, slug, "minutes");
  const index = councils.map((item) => ({
    council_id: item.council_id,
    name: item.name,
    year: item.year,
    japanese_year: item.japanese_year,
    type_label: item.type_label,
    file: `${item.council_id}.json`,
    schedule_count: item.schedules.length,
  }));
  writeJson(path.join(minutesDir, "index.json"), index);
  for (const item of councils) writeJson(path.join(minutesDir, `${item.council_id}.json`), item);
  return minutesDir;
}

function biratoriFixture() {
  const make = (sourceId, year, type, rows) => council(
    sourceId,
    year,
    type,
    rows.map(([number, month, day], index) => schedule({
      id: index + 1,
      date: new Date(year, month - 1, day),
      heading: `令和${year - 2018}年第${number}回平取町議会${type}`,
      url: `https://example.invalid/biratori/${year}-${type}-${number}-${day}.pdf`,
      text: `平取原文 ${year}-${number}-${day}`,
    })),
  );
  return [
    make(20241099, 2024, "定例会", [[3, 6, 26], [6, 9, 19], [6, 9, 20], [9, 12, 18], [9, 12, 19]]),
    make(20242099, 2024, "臨時会", [[4, 7, 4], [5, 8, 7], [7, 10, 15], [8, 11, 29]]),
    make(20251099, 2025, "定例会", [[3, 3, 5], [3, 3, 6], [6, 6, 19], [6, 6, 20], [8, 9, 18], [8, 9, 19], [10, 12, 17], [10, 12, 18]]),
    make(20252099, 2025, "臨時会", [[1, 1, 15], [2, 1, 29], [4, 4, 30], [5, 5, 30], [7, 8, 7], [9, 11, 26]]),
  ];
}

function rikubetsuFixture() {
  const buckets = new Map([
    [20241001, [["special", 1, 1, 24], ["regular", 3, 1, 5], ["special", 2, 4, 19], ["special", 3, 5, 9], ["regular", 6, 1, 4], ["special", 4, 8, 5], ["regular", 9, 1, 3], ["special", 5, 10, 16], ["regular", 12, 1, 10]]],
    [20241002, [["regular", 3, 2, 6], ["regular", 6, 2, 5], ["regular", 9, 2, 4], ["regular", 12, 2, 11]]],
    [20241003, [["regular", 3, 3, 7], ["regular", 9, 3, 10]]],
    [20241004, [["regular", 3, 4, 8], ["regular", 9, 4, 11]]],
    [20241005, [["regular", 3, 5, 12]]],
    [20251001, [["special", 1, 1, 23], ["regular", 3, 1, 4], ["special", 2, 5, 7], ["regular", 6, 1, 3], ["special", 3, 7, 7], ["special", 4, 8, 7], ["regular", 9, 1, 2], ["special", 5, 10, 14], ["regular", 12, 1, 2]]],
    [20251002, [["regular", 3, 2, 5], ["regular", 6, 2, 5], ["regular", 9, 2, 3], ["regular", 12, 2, 3]]],
    [20251003, [["regular", 3, 3, 11], ["regular", 9, 3, 9]]],
    [20251004, [["regular", 3, 4, 12], ["regular", 9, 4, 10]]],
  ]);
  return [...buckets].map(([sourceId, rows]) => {
    const year = Math.floor(sourceId / 10_000);
    return council(sourceId, year, "定例会", rows.map(([kind, numberOrMonth, sitting, day], index) => {
      const month = kind === "special" ? sitting === 1 ? numberOrMonth === 1 ? 1 : numberOrMonth === 2 ? 5 : numberOrMonth === 3 ? 7 : numberOrMonth === 4 ? 8 : 10 : 1 : numberOrMonth;
      const heading = kind === "special"
        ? `令和${year - 2018}年陸別町議会第${numberOrMonth}回臨時会会議録（第1号）`
        : `令和${year - 2018}年陸別町議会${numberOrMonth}月定例会会議録（第${sitting}号）`;
      return schedule({
        id: index + 1,
        date: new Date(year, month - 1, day),
        heading,
        url: `https://example.invalid/rikubetsu/${sourceId}-${index}.pdf`,
        text: `陸別原文 ${sourceId}-${index}`,
      });
    }));
  });
}

function furanoFixture() {
  return [council(20242002, 2024, "臨時会", [
    schedule({ id: 1, date: new Date(2024, 4, 27), heading: "令和6年第2回富良野市議会臨時会", url: "https://example.invalid/furano/2-index.pdf", text: "第2回目次" }),
    schedule({ id: 2, date: new Date(2024, 9, 30), heading: "令和6年第3回富良野市議会臨時会", url: "https://example.invalid/furano/3-index.pdf", text: "第3回目次" }),
    schedule({ id: 3, date: new Date(2024, 4, 27), heading: "令和6年第2回富良野市議会臨時会", url: "https://example.invalid/furano/2-body.pdf", text: "第2回本文" }),
    schedule({ id: 4, date: new Date(2024, 9, 30), heading: "令和6年第3回富良野市議会臨時会", url: "https://example.invalid/furano/3-body.pdf", text: "第3回本文" }),
  ])];
}

test("dry-run recognizes every known Biratori and Rikubetsu target without modifying files", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "minute-grouping-dry-run-"));
  try {
    const biratoriDir = setupCity(dataRoot, "biratori", biratoriFixture());
    const rikubetsuDir = setupCity(dataRoot, "rikubetsu", rikubetsuFixture());
    const biratoriBefore = fs.readFileSync(path.join(biratoriDir, "index.json"), "utf8");
    const rikubetsuBefore = fs.readFileSync(path.join(rikubetsuDir, "index.json"), "utf8");

    const biratori = await repairPdfMinuteGroupings("biratori", { dataRoot, generatedAt: "2026-08-23T00:00:00.000Z" });
    const rikubetsu = await repairPdfMinuteGroupings("rikubetsu", { dataRoot, generatedAt: "2026-08-23T00:00:00.000Z" });

    assert.equal(biratori.dryRun, true);
    assert.deepEqual(biratori.targetIds, [20241003, 20241006, 20241009, 20242004, 20242005, 20242007, 20242008, 20251003, 20251006, 20251008, 20251010, 20252001, 20252002, 20252004, 20252005, 20252007, 20252009]);
    assert.deepEqual(rikubetsu.targetIds, [20241003, 20241006, 20241009, 20241012, 20242001, 20242002, 20242003, 20242004, 20242005, 20251003, 20251006, 20251009, 20251012, 20252001, 20252002, 20252003, 20252004, 20252005]);
    assert.equal(fs.readFileSync(path.join(biratoriDir, "index.json"), "utf8"), biratoriBefore);
    assert.equal(fs.readFileSync(path.join(rikubetsuDir, "index.json"), "utf8"), rikubetsuBefore);
    assert.equal(fs.existsSync(path.join(dataRoot, "biratori", "quarantine")), false);
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("write mode preserves every schedule, saves originals to quarantine, and rebuilds the index", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "minute-grouping-write-"));
  try {
    const minutesDir = setupCity(dataRoot, "furano", furanoFixture());
    const original = readJson(path.join(minutesDir, "20242002.json"));
    const result = await repairPdfMinuteGroupings("furano", {
      dataRoot,
      write: true,
      generatedAt: "2026-08-23T00:00:00.000Z",
    });

    assert.equal(result.dryRun, false);
    assert.deepEqual(result.targetIds, [20242002, 20242003]);
    const second = readJson(path.join(minutesDir, "20242002.json"));
    const third = readJson(path.join(minutesDir, "20242003.json"));
    assert.deepEqual(
      [...second.schedules, ...third.schedules].map((item) => item.minutes[0].text).sort(),
      original.schedules.map((item) => item.minutes[0].text).sort(),
    );
    assert.deepEqual(second.schedules.map((item) => item.schedule_id), [1, 2]);
    assert.deepEqual(third.schedules.map((item) => item.schedule_id), [1, 2]);

    const index = readJson(path.join(minutesDir, "index.json"));
    assert.deepEqual(index.map((entry) => entry.council_id), [20242003, 20242002]);
    assert.deepEqual(index.map((entry) => entry.end_date), ["2024-10-30", "2024-05-27"]);

    const quarantine = path.join(dataRoot, "furano", "quarantine", "minutes", "grouping-repair");
    assert.deepEqual(readJson(path.join(quarantine, "20242002.json")), original);
    assert.equal(fs.existsSync(path.join(quarantine, "index.json")), true);
    const manifest = readJson(path.join(quarantine, "manifest.json"));
    assert.deepEqual(manifest.mappings, [{ old_council_id: 20242002, new_council_ids: [20242002, 20242003] }]);
    assert.equal(manifest.integrity.minute_text_modified, false);
    assert.deepEqual(
      manifest.integrity.source_minute_payload_hashes,
      manifest.integrity.target_minute_payload_hashes,
    );
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

for (const scenario of ["duplicate-url", "unrecognized", "collision"]) {
  test(`fails closed before writing for ${scenario}`, async () => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), `minute-grouping-${scenario}-`));
    try {
      const fixtures = furanoFixture();
      if (scenario === "duplicate-url") {
        fixtures[0].schedules[1].minutes[0].source_url = fixtures[0].schedules[0].minutes[0].source_url;
      } else if (scenario === "unrecognized") {
        fixtures[0].schedules[1].minutes[0].text = "公式回次を確認できない本文";
      }
      const minutesDir = setupCity(dataRoot, "furano", fixtures);
      if (scenario === "collision") {
        writeJson(path.join(minutesDir, "20242003.json"), council(20242003, 2024, "臨時会", []));
      }
      const before = fs.readFileSync(path.join(minutesDir, "index.json"), "utf8");

      await assert.rejects(
        repairPdfMinuteGroupings("furano", { dataRoot, write: true }),
        /duplicate source_url|not recognizable|target file collision/,
      );
      assert.equal(fs.readFileSync(path.join(minutesDir, "index.json"), "utf8"), before);
      assert.equal(fs.existsSync(path.join(dataRoot, "furano", "quarantine")), false);
    } finally {
      fs.rmSync(dataRoot, { recursive: true, force: true });
    }
  });
}
