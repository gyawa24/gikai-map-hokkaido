import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildMemberIndex,
  matchMember,
} from "../build-segments.mjs";
import { repairMunicipalityMemberAttributions } from "../repair-segment-member-attributions.mjs";

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("uses only a matching, opening self-introduction for number-only PDF speakers", () => {
  const memberIndex = buildMemberIndex([
    { seat_number: 9, name: "山田 太郎", faction: "無所属" },
    { seat_number: 2, name: "鈴木 花子", faction: "町民クラブ" },
  ]);
  const expected = { name: "山田 太郎", faction: "無所属" };

  assert.deepEqual(
    matchMember("２番議員", memberIndex, "おはようございます。２番山田太郎です。質問を始めます。"),
    expected,
  );
  assert.deepEqual(
    matchMember("１番議員", memberIndex, "皆さん、おはようございます。１番、山田 太郎です。質問を始めます。"),
    expected,
  );

  assert.equal(
    matchMember("２番議員", memberIndex, "おはようございます。１番、山田太郎です。質問を始めます。"),
    null,
  );
  assert.equal(
    matchMember("２番議員", memberIndex, "おはようございます。質問を始めます。２番山田太郎です。"),
    null,
  );
  assert.equal(
    matchMember("２番議員", memberIndex, "おはようございます。２番議員は山田太郎です。"),
    null,
  );
  assert.equal(
    matchMember("２番議員", memberIndex, "おはようございます。２番副委員長山田太郎です。"),
    null,
  );
  assert.equal(
    matchMember("２番議員", memberIndex, "おはようございます。２番山田太郎議員です。"),
    null,
  );
});

test("matches full names across known character variants only when the roster match is unique", () => {
  const uniqueIndex = buildMemberIndex([
    { seat_number: 1, name: "髙橋 邦雄", faction: "無所属" },
  ]);
  assert.deepEqual(
    matchMember("高橋邦雄議員", uniqueIndex, "本文です。"),
    { name: "髙橋 邦雄", faction: "無所属" },
  );
  assert.deepEqual(
    matchMember("３番議員", uniqueIndex, "（高橋邦雄君） 本文です。"),
    { name: "髙橋 邦雄", faction: "無所属" },
  );

  const ambiguousIndex = buildMemberIndex([
    { seat_number: 1, name: "髙橋 邦雄", faction: "無所属" },
    { seat_number: 2, name: "高橋 邦雄", faction: "町民会" },
  ]);
  assert.equal(matchMember("高橋邦雄議員", ambiguousIndex, "本文です。"), null);
  assert.equal(matchMember("３番議員", ambiguousIndex, "（高橋邦雄君） 本文です。"), null);
});

test("repairs only published member names and preserves historical faction values", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "repair-segment-member-"));
  const cityDir = path.join(dataRoot, "fixture");
  const published = [
    {
      id: "fixture-1-1-1",
      council_id: 1,
      speaker: "３番議員",
      member_name: "誤った 議員",
      member_faction: "誤会派",
      text: "（山田太郎君） 本文です。",
    },
    {
      id: "fixture-1-1-2",
      council_id: 1,
      speaker: "9番議員",
      member_name: "山田 太郎",
      member_faction: "無所属",
      text: "本文に氏名はありません。",
    },
    {
      id: "fixture-1-1-3",
      council_id: 1,
      speaker: "山田旧人議員",
      member_name: "山田 太郎",
      member_faction: "無所属",
      text: "同じ姓の旧議員による本文です。",
    },
  ];
  const quarantined = [{ ...published[0], id: "fixture-999-1-1" }];

  try {
    writeJson(path.join(cityDir, "members.json"), [
      { seat_number: 9, name: "山田 太郎", faction: "無所属" },
    ]);
    writeJson(path.join(cityDir, "minutes", "index.json"), [{ council_id: 1 }]);
    writeJson(path.join(cityDir, "segments", "1.json"), published);
    writeJson(path.join(cityDir, "segments", "999.json"), quarantined);
    writeJson(path.join(cityDir, "segments", "_index.json"), published);

    const dryRun = await repairMunicipalityMemberAttributions("fixture", { dataRoot });
    assert.equal(dryRun.changedSegments, 3);
    assert.equal(readJson(path.join(cityDir, "segments", "1.json"))[0].member_name, "誤った 議員");

    const result = await repairMunicipalityMemberAttributions("fixture", { dataRoot, write: true });
    assert.equal(result.changedSegments, 3);
    const repaired = readJson(path.join(cityDir, "segments", "1.json"));
    assert.equal(repaired[0].member_name, "山田 太郎");
    assert.equal(repaired[0].member_faction, "誤会派");
    assert.equal(repaired[1].member_name, null);
    assert.equal(repaired[1].member_faction, "無所属");
    assert.equal(repaired[2].member_name, null);
    assert.equal(repaired[2].member_faction, "無所属");
    assert.deepEqual(readJson(path.join(cityDir, "segments", "999.json")), quarantined);
    assert.deepEqual(
      readJson(path.join(cityDir, "segments", "_index.json"))
        .map((entry) => [entry.member_name, entry.member_faction]),
      [["山田 太郎", "誤会派"], [null, "無所属"], [null, "無所属"]],
    );
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

for (const scenario of ["missing", "duplicate"]) {
  test(`fails before writing when the segment index has a ${scenario} id`, async () => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), `repair-segment-member-${scenario}-`));
    const cityDir = path.join(dataRoot, "fixture");
    const segment = {
      id: "fixture-1-1-1",
      council_id: 1,
      speaker: "３番議員",
      member_name: "誤った 議員",
      member_faction: "誤会派",
      text: "（山田太郎君） 本文です。",
    };
    try {
      writeJson(path.join(cityDir, "members.json"), [
        { seat_number: 9, name: "山田 太郎", faction: "無所属" },
      ]);
      writeJson(path.join(cityDir, "minutes", "index.json"), [{ council_id: 1 }]);
      writeJson(path.join(cityDir, "segments", "1.json"), [segment]);
      writeJson(
        path.join(cityDir, "segments", "_index.json"),
        scenario === "missing" ? [] : [segment, segment],
      );
      const before = fs.readFileSync(path.join(cityDir, "segments", "1.json"), "utf8");

      await assert.rejects(
        repairMunicipalityMemberAttributions("fixture", { dataRoot, write: true }),
        /missing from _index|duplicate or missing segment index id/,
      );
      assert.equal(fs.readFileSync(path.join(cityDir, "segments", "1.json"), "utf8"), before);
    } finally {
      fs.rmSync(dataRoot, { recursive: true, force: true });
    }
  });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
