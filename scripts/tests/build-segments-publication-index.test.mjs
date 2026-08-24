import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildSegmentsForMunicipality } from "../build-segments.mjs";

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("segments are generated only for meetings in the publication index", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "segments-publication-index-"));
  const minutesDir = path.join(tempRoot, "minutes");
  const segmentsDir = path.join(tempRoot, "segments");
  const membersPath = path.join(tempRoot, "members.json");

  try {
    writeJson(membersPath, [
      { seat_number: 9, name: "山田 太郎", faction: "無所属" },
      { seat_number: 10, name: "宮 利徳", faction: "会派A" },
      { seat_number: 11, name: "水口 典一", faction: "会派B" },
    ]);
    writeJson(path.join(minutesDir, "index.json"), [
      { council_id: 1, file: "1.json", name: "令和8年第1回定例会", year: "2026" },
    ]);
    writeJson(path.join(minutesDir, "1.json"), {
      council_id: 1,
      name: "令和8年第1回定例会",
      year: "2026",
      schedules: [
        {
          schedule_id: 1,
          name: "3月1日",
          minutes: [
            {
              minute_id: 1,
              minute_type: "◆質問",
              title: "山田太郎議員",
              text: "◆山田太郎議員　地域交通について伺います。",
            },
            {
              minute_id: 2,
              minute_type: "◆質問",
              title: "山田旧人議員",
              text: "◆山田旧人議員　過去の発言です。",
            },
            {
              minute_id: 3,
              minute_type: "◆質問",
              title: "3番議員",
              text: "◆3番議員　（山田太郎君） 本文に氏名がある質問です。",
            },
            {
              minute_id: 4,
              minute_type: "◆質問",
              title: "9番議員",
              text: "◆9番議員　本文に氏名がない質問です。",
            },
            {
              minute_id: 5,
              minute_type: "◆質問",
              title: "9番山田議員",
              text: "◆9番山田議員　席番号と姓が一致する質問です。",
            },
            {
              minute_id: 6,
              minute_type: "◆質問",
              title: "9番山田旧人議員",
              text: "◆9番山田旧人議員　同じ姓の旧議員による質問です。",
            },
            {
              minute_id: 7,
              minute_type: "◆質問",
              title: "宮利徳厚生消防常任委員会委員長（議案第1号に関する報告）………",
              text: "◆宮利徳厚生消防常任委員会委員長（議案第1号に関する報告）………　委員長報告です。",
            },
            {
              minute_id: 8,
              minute_type: "◆質問",
              title: "水口典一議員（代表質問）…………………………………………",
              text: "◆水口典一議員（代表質問）…………………………………………　代表質問です。",
            },
          ],
        },
      ],
    });
    writeJson(path.join(minutesDir, "999.json"), {
      council_id: 999,
      name: "隔離中の会議録",
      year: "2020",
      schedules: [],
    });

    const result = await buildSegmentsForMunicipality("fixture", {
      minutesDir,
      segmentsDir,
      membersPath,
    });

    assert.equal(result.councilCount, 1);
    assert.equal(fs.existsSync(path.join(segmentsDir, "1.json")), true);
    assert.equal(fs.existsSync(path.join(segmentsDir, "999.json")), false);
    const index = JSON.parse(fs.readFileSync(path.join(segmentsDir, "_index.json"), "utf8"));
    assert.ok(index.length > 0);
    assert.ok(index.every((entry) => entry.council_id === 1));
    assert.equal(index.find((entry) => entry.speaker === "山田太郎議員")?.member_name, "山田 太郎");
    assert.equal(index.find((entry) => entry.speaker === "山田旧人議員")?.member_name, null);
    assert.equal(index.find((entry) => entry.speaker === "3番議員")?.member_name, "山田 太郎");
    assert.equal(index.find((entry) => entry.speaker === "9番議員")?.member_name, null);
    assert.equal(index.find((entry) => entry.speaker === "9番山田議員")?.member_name, "山田 太郎");
    assert.equal(index.find((entry) => entry.speaker === "9番山田旧人議員")?.member_name, null);
    assert.equal(index.find((entry) => entry.speaker.startsWith("宮利徳厚生消防"))?.member_name, "宮 利徳");
    assert.equal(index.find((entry) => entry.speaker.startsWith("水口典一議員"))?.member_name, "水口 典一");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
