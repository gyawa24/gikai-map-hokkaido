import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { assertManagedMinutesProjection, pruneStaleMinutesJson, syncPublishedMinutes } from "../sync-site-data.mjs";

function meeting(councilId, extra = {}) {
  return JSON.stringify({ council_id: councilId, schedules: [{ schedule_id: 1, minutes: [] }], ...extra }) + "\n";
}

function write(filePath, value = meeting(Number(path.basename(filePath, ".json")))) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, "utf8");
}

function managedFixture() {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "minutes-v2-managed-"));
  const source = path.join(fixture, "data", "sample", "minutes");
  const destination = path.join(fixture, "site", "data", "sample", "minutes");
  const index = [{ council_id: 1, file: "1.json" }];
  const body = meeting(1, { name: "原文" });
  const registryPath = path.join(fixture, "data", "sample", "council-records", "index.json");
  const registry = {
    schema_version: "council-record-body-registry.v1", municipality_id: "sample",
    records: [{ council_id: 1, state: "active", release_path: "council-records/1/releases/test-run",
      minutes_sha256: createHash("sha256").update(body).digest("hex"), publication_sha256: "a".repeat(64) }],
  };
  write(path.join(source, "1.json"), body);
  write(path.join(source, "index.json"), JSON.stringify(index));
  write(registryPath, JSON.stringify(registry));
  write(path.join(destination, "1.json"), body);
  write(path.join(destination, "index.json"), JSON.stringify(index));
  return { fixture, source, destination, index, body, registryPath, registry };
}

test("managed projection preflight accepts its exact pinned bytes", async () => {
  const f = managedFixture();
  try {
    assert.deepEqual([...await assertManagedMinutesProjection(f.source, f.index)], [["1.json", f.registry.records[0].minutes_sha256]]);
  } finally { fs.rmSync(f.fixture, { recursive: true, force: true }); }
});

test("managed body changes stop sync and dry-run before touching published files", async () => {
  const f = managedFixture();
  try {
    write(path.join(f.source, "1.json"), meeting(1, { name: "changed" }));
    for (const dryRun of [false, true]) {
      await assert.rejects(syncPublishedMinutes(f.source, f.destination, dryRun), /v2 managed council 1: projection hash mismatch/u);
    }
    assert.equal(fs.readFileSync(path.join(f.destination, "1.json"), "utf8"), f.body);
    assert.equal(fs.readFileSync(path.join(f.destination, "index.json"), "utf8"), JSON.stringify(f.index));
  } finally { fs.rmSync(f.fixture, { recursive: true, force: true }); }
});

test("managed index removal stops sync and standalone prune", async () => {
  const f = managedFixture();
  try {
    write(path.join(f.source, "index.json"), "[]");
    await assert.rejects(syncPublishedMinutes(f.source, f.destination), /v2 managed council 1: publication index/u);
    await assert.rejects(pruneStaleMinutesJson(f.source, f.destination, { publishedFiles: new Set(["index.json"]) }), /v2 managed council 1: publication index/u);
    assert.equal(fs.readFileSync(path.join(f.destination, "1.json"), "utf8"), f.body);
  } finally { fs.rmSync(f.fixture, { recursive: true, force: true }); }
});

test("a managed hash alone cannot authorize sync without its release evidence", async () => {
  const f = managedFixture();
  try {
    await assert.rejects(syncPublishedMinutes(f.source, f.destination));
    assert.equal(fs.readFileSync(path.join(f.destination, "1.json"), "utf8"), f.body);
  } finally { fs.rmSync(f.fixture, { recursive: true, force: true }); }
});

test("rolled-back records release the legacy write protection", async () => {
  const f = managedFixture();
  try {
    f.registry.records[0].state = "rolled_back";
    write(f.registryPath, JSON.stringify(f.registry));
    const updated = meeting(1, { name: "updated after rollback" });
    write(path.join(f.source, "1.json"), updated);
    await syncPublishedMinutes(f.source, f.destination);
    assert.equal(fs.readFileSync(path.join(f.destination, "1.json"), "utf8"), updated);
  } finally { fs.rmSync(f.fixture, { recursive: true, force: true }); }
});

test("malformed managed registries fail closed", async () => {
  for (const mutate of [
    (r) => { r.schema_version = "unknown"; },
    (r) => { r.municipality_id = "another"; },
    (r) => { r.records.push({ ...r.records[0] }); },
    (r) => { r.records[0].state = "disabled"; },
    (r) => { r.records[0].minutes_sha256 = "invalid"; },
    (r) => { r.records[0].release_path = "../../elsewhere"; },
  ]) {
    const f = managedFixture();
    try {
      mutate(f.registry);
      write(f.registryPath, JSON.stringify(f.registry));
      await assert.rejects(syncPublishedMinutes(f.source, f.destination), /Invalid v2 managed minutes registry/u);
      assert.equal(fs.readFileSync(path.join(f.destination, "1.json"), "utf8"), f.body);
    } finally { fs.rmSync(f.fixture, { recursive: true, force: true }); }
  }
});

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
    write(path.join(source, "1.json"), meeting(1, { published: true }));
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
    write(path.join(source, "1.json"), meeting(1, { published: true }));
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
    write(path.join(source, "1.json"), meeting(1, { new: 1 }));
    write(path.join(source, "2.json"), meeting(2, { new: 2 }));
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
    await assert.rejects(syncPublishedMinutes(source, destination), /requires a source index/);
    assert.equal(fs.existsSync(path.join(destination, "1.json")), false);
    assert.equal(fs.existsSync(path.join(destination, "stale.json")), true);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

for (const [label, index, body, error] of [
  ["council ID mismatch", [{ council_id: 1, file: "1.json" }], meeting(2), /mismatched/],
  ["schedule count mismatch", [{ council_id: 1, file: "1.json", schedule_count: 2 }], meeting(1), /schedule_count/],
  ["duplicate council", [{ council_id: 1, file: "1.json" }, { council_id: 1, file: "1.json" }], meeting(1), /duplicate council/],
  ["duplicate schedules", [{ council_id: 1, file: "1.json" }], meeting(1, { schedules: [{ schedule_id: 1, minutes: [] }, { schedule_id: 1, minutes: [] }] }), /duplicate schedules/],
  ["invalid JSON", [{ council_id: 1, file: "1.json" }], "{broken", /JSON/],
]) {
  test(`minutes sync rejects ${label} before changing the publication`, async () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "minutes-invalid-publication-"));
    const source = path.join(fixture, "source");
    const destination = path.join(fixture, "destination");
    try {
      write(path.join(source, "index.json"), JSON.stringify(index));
      write(path.join(source, "1.json"), body);
      write(path.join(destination, "index.json"), "[]\n");
      write(path.join(destination, "old.json"), "keep\n");
      await assert.rejects(syncPublishedMinutes(source, destination), error);
      assert.equal(fs.readFileSync(path.join(destination, "index.json"), "utf8"), "[]\n");
      assert.equal(fs.readFileSync(path.join(destination, "old.json"), "utf8"), "keep\n");
      assert.equal(fs.existsSync(path.join(destination, "1.json")), false);
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });
}
