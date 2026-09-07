import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

function write(root, file, contents) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

function fixture(t, failSegments = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "onboard-publication-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const file of ["scripts/onboard-municipality.mjs", "scripts/sync-site-data.mjs", "scripts/lib/public-data-reminders.mjs", "scripts/lib/budget-source-reminders.mjs"]) {
    write(root, file, fs.readFileSync(path.join(repoRoot, file)));
  }
  write(root, "data/municipalities.json", JSON.stringify([{ slug: "sample", name: "例市", council_name: "例市議会", region: "例", furigana: "れいし", active: true, level: "municipality" }]));
  write(root, "data/sample/minutes/index.json", '[{"council_id":1,"file":"1.json","schedule_count":1}]');
  write(root, "data/sample/minutes/1.json", '{"council_id":1,"schedules":[{"schedule_id":1,"minutes":[]}]}');
  write(root, "data/sample/minutes/2.json", '{"quarantined":true}');
  write(root, "site/data/sample/minutes/index.json", "[]");
  write(root, "scripts/backfill-minutes-index-dates.mjs", "");
  write(root, "scripts/build-segments.mjs", failSegments ? "process.exit(1)" : `
    import fs from 'node:fs';
    fs.writeFileSync('segments-built', 'yes');
  `);
  write(root, "site/scripts/build-city-capabilities.mjs", `
    import fs from 'node:fs';
    import assert from 'node:assert/strict';
    assert.ok(fs.existsSync('segments-built'));
    assert.ok(fs.existsSync('site/data/sample/minutes/1.json'));
    fs.writeFileSync('capabilities-built', 'yes');
  `);
  return root;
}

test("onboarding uses the publication manifest and builds capabilities after segments and sync", (t) => {
  const root = fixture(t);
  const result = spawnSync(process.execPath, ["scripts/onboard-municipality.mjs", "--slug", "sample", "--build-segments"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(root, "capabilities-built")), true);
  assert.equal(fs.existsSync(path.join(root, "site/data/sample/minutes/1.json")), true);
  assert.equal(fs.existsSync(path.join(root, "site/data/sample/minutes/2.json")), false);
  assert.equal(fs.existsSync(path.join(root, "data/sample/minutes/2.json")), true);
});

test("failed segment generation leaves the publication untouched", (t) => {
  const root = fixture(t, true);
  const result = spawnSync(process.execPath, ["scripts/onboard-municipality.mjs", "--slug", "sample", "--build-segments"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.equal(fs.readFileSync(path.join(root, "site/data/sample/minutes/index.json"), "utf8"), "[]");
  assert.equal(fs.existsSync(path.join(root, "site/data/sample/minutes/1.json")), false);
  assert.equal(fs.existsSync(path.join(root, "capabilities-built")), false);
});
