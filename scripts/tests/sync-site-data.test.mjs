import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { pruneStaleMinutesJson, syncPublishedMinutes } from "../sync-site-data.mjs";

function write(filePath, value = "{}\n") {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, "utf8");
}

test("minutes sync prunes JSON outside the publication manifest", async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "minutes-mirror-"));
  const source = path.join(fixture, "data", "sample", "minutes");
  const destination = path.join(fixture, "site", "data", "sample", "minutes");
  try {
    write(path.join(source, "index.json"), '[{"council_id":1,"file":"1.json"}]\n');
    write(path.join(source, "1.json"));
    write(path.join(source, "3.json"));
    write(path.join(source, "enriched", "1.json"));
    write(path.join(source, "enriched", "3.json"));
    write(path.join(destination, "index.json"), "[]\n");
    write(path.join(destination, "1.json"));
    write(path.join(destination, "2.json"));
    write(path.join(destination, "enriched", "1.json"));
    write(path.join(destination, "enriched", "2.json"));
    write(path.join(destination, "local-note.txt"), "keep\n");

    const removed = await pruneStaleMinutesJson(source, destination);

    assert.deepEqual(removed, ["2.json", path.join("enriched", "2.json")]);
    assert.equal(fs.existsSync(path.join(destination, "1.json")), true);
    assert.equal(fs.existsSync(path.join(destination, "enriched", "1.json")), true);
    assert.equal(fs.existsSync(path.join(destination, "local-note.txt")), true);
    assert.equal(fs.existsSync(path.join(destination, "2.json")), false);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("minutes sync copies only manifest meetings and matching enriched JSON", async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "minutes-publication-copy-"));
  const source = path.join(fixture, "source");
  const destination = path.join(fixture, "destination");
  try {
    write(path.join(source, "index.json"), '[{"council_id":1,"file":"1.json"}]\n');
    write(path.join(source, "1.json"), '{"published":true}\n');
    write(path.join(source, "2.json"), '{"published":false}\n');
    write(path.join(source, "enriched", "1.json"), '{"published":true}\n');
    write(path.join(source, "enriched", "2.json"), '{"published":false}\n');
    write(path.join(destination, "2.json"));
    write(path.join(destination, "enriched", "2.json"));

    await syncPublishedMinutes(source, destination);

    assert.equal(fs.existsSync(path.join(destination, "index.json")), true);
    assert.equal(fs.existsSync(path.join(destination, "1.json")), true);
    assert.equal(fs.existsSync(path.join(destination, "enriched", "1.json")), true);
    assert.equal(fs.existsSync(path.join(destination, "2.json")), false);
    assert.equal(fs.existsSync(path.join(destination, "enriched", "2.json")), false);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("minutes sync removes a stale enriched JSON when the source was withdrawn", async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "minutes-enriched-withdrawal-"));
  const source = path.join(fixture, "source");
  const destination = path.join(fixture, "destination");
  try {
    write(path.join(source, "index.json"), '[{"council_id":1,"file":"1.json"}]\n');
    write(path.join(source, "1.json"), '{"published":true}\n');
    write(path.join(destination, "index.json"), '[{"council_id":1,"file":"1.json"}]\n');
    write(path.join(destination, "1.json"), '{"published":true}\n');
    write(path.join(destination, "enriched", "1.json"), '{"withdrawn":true}\n');

    await syncPublishedMinutes(source, destination);

    assert.equal(fs.existsSync(path.join(destination, "1.json")), true);
    assert.equal(fs.existsSync(path.join(destination, "enriched", "1.json")), false);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("minutes sync fails before touching the mirror when an indexed meeting is missing", async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "minutes-missing-meeting-"));
  const source = path.join(fixture, "source");
  const destination = path.join(fixture, "destination");
  try {
    write(path.join(source, "index.json"), '[{"council_id":1,"file":"1.json"}]\n');
    write(path.join(destination, "index.json"), '[{"council_id":1,"file":"1.json"}]\n');
    write(path.join(destination, "1.json"), '{"stale":true}\n');
    write(path.join(destination, "2.json"), '{"unrelatedStale":true}\n');

    await assert.rejects(
      syncPublishedMinutes(source, destination),
      /minutes index references missing meeting JSON/u
    );

    assert.equal(fs.readFileSync(path.join(destination, "1.json"), "utf8"), '{"stale":true}\n');
    assert.equal(
      fs.readFileSync(path.join(destination, "index.json"), "utf8"),
      '[{"council_id":1,"file":"1.json"}]\n'
    );
    assert.equal(
      fs.readFileSync(path.join(destination, "2.json"), "utf8"),
      '{"unrelatedStale":true}\n'
    );
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("minutes sync preserves the old publication when a meeting copy fails", async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "minutes-copy-failure-"));
  const source = path.join(fixture, "source");
  const destination = path.join(fixture, "destination");
  try {
    write(
      path.join(source, "index.json"),
      '[{"council_id":1,"file":"1.json"},{"council_id":2,"file":"2.json"}]\n'
    );
    write(path.join(source, "1.json"), '{"new":1}\n');
    write(path.join(source, "2.json"), '{"new":2}\n');
    write(path.join(destination, "index.json"), '[{"council_id":1,"file":"1.json"}]\n');
    write(path.join(destination, "1.json"), '{"oldPublication":true}\n');
    write(path.join(destination, "2.json", "blocker.txt"), "force rename failure\n");

    await assert.rejects(syncPublishedMinutes(source, destination));

    assert.equal(
      fs.readFileSync(path.join(destination, "index.json"), "utf8"),
      '[{"council_id":1,"file":"1.json"}]\n'
    );
    assert.equal(
      fs.readFileSync(path.join(destination, "1.json"), "utf8"),
      '{"oldPublication":true}\n'
    );
    assert.deepEqual(
      fs
        .readdirSync(destination, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => entry.name)
        .sort(),
      ["1.json", "index.json"]
    );
    assert.equal(fs.statSync(path.join(destination, "2.json")).isDirectory(), true);
    assert.deepEqual(
      fs.readdirSync(destination).filter((name) => name.endsWith(".tmp")),
      []
    );
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("minutes mirror dry-run reports stale files without deleting them", async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "minutes-mirror-dry-"));
  const source = path.join(fixture, "source");
  const destination = path.join(fixture, "destination");
  try {
    write(path.join(source, "index.json"), "[]\n");
    write(path.join(destination, "index.json"), "[]\n");
    write(path.join(destination, "stale.json"));

    const removed = await pruneStaleMinutesJson(source, destination, { dryRun: true });

    assert.deepEqual(removed, ["stale.json"]);
    assert.equal(fs.existsSync(path.join(destination, "stale.json")), true);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("minutes mirror does not prune without an authoritative source index", async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "minutes-mirror-no-index-"));
  const source = path.join(fixture, "source");
  const destination = path.join(fixture, "destination");
  try {
    write(path.join(source, "1.json"));
    write(path.join(destination, "stale.json"));

    const removed = await pruneStaleMinutesJson(source, destination);

    assert.deepEqual(removed, []);
    assert.equal(fs.existsSync(path.join(destination, "stale.json")), true);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
