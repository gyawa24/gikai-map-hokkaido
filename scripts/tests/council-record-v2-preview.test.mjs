import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createMinutesV2PreviewArtifact, writeMinutesV2PreviewArtifact } from "../lib/council-record-v2-preview.mjs";

const siteRoot = fileURLToPath(new URL("../../site/", import.meta.url));
const siteRequire = createRequire(path.join(siteRoot, "package.json"));
const ts = siteRequire("typescript");

function loadPreviewReader(env, filesystem = fs) {
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true }, fileName: filename,
    }).outputText;
    vm.runInNewContext(code, {
      module, exports: module.exports, process: { env },
      require(id) {
        if (id === "node:fs") return filesystem;
        if (id.startsWith("@/")) return load(path.join(siteRoot, "src", `${id.slice(2)}.ts`));
        return siteRequire(id);
      },
    }, { filename });
    return module.exports;
  }
  return load(path.join(siteRoot, "src/lib/councilRecordV2Preview.ts")).loadMinutesV2Preview;
}

// プレビュー保管・読み取り境界の合成fixture。公式議事録の実データとは区別する。
function fixture() {
  const minutes = {
    council_id: 578, name: "合成確認用会議", year: "2026", japanese_year: "令和8年", type_label: "定例会",
    schedules: [{ schedule_id: 2, name: "3月2日（第1号）", page_no: 1, minutes: [
      { minute_id: 1, title: "（名簿）", minute_type: "名簿", text: "名簿\n　原文空白" },
      { minute_id: 3, title: "氏名未同定の原文表記", minute_type: "○議長", text: "○原文表記　本文\n次の行" },
    ] }],
  };
  return {
    record: { record_id: "chitose:record:test", municipality_id: "chitose", sittings: [{}], turns: [{}], document_items: [{}] },
    projection: { minutes: structuredClone(minutes), provenance: { generator: { name: "test", version: "1" } }, publication: { public_visible: false } },
    legacyMinutes: minutes,
    indexItem: { council_id: 578, name: minutes.name, year: "2026", japanese_year: "令和8年", type_label: "定例会", file: "578.json" },
    validation: { ok: true, errors: [], warnings: [], publicationReady: false, gateResults: ["schema", "graph", "provenance", "content", "freshness"].map((gate) => ({ gate, status: "pass" })) },
    preparedAt: "2026-09-07T00:00:00Z",
  };
}

function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "council-v2-preview-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("原文・ID・順序が一致したデータだけを非公開プレビューとして保存・読み取る", (t) => {
  const root = temporary(t);
  const args = fixture();
  const artifact = createMinutesV2PreviewArtifact(args);
  const first = writeMinutesV2PreviewArtifact(root, artifact);
  const second = writeMinutesV2PreviewArtifact(root, artifact);
  assert.equal(first.artifactSha256, second.artifactSha256);
  const result = loadPreviewReader({ NODE_ENV: "development", MINUTES_V2_PREVIEW_ROOT: root })("chitose", "578");
  assert.equal(result.status, "available");
  assert.equal(result.artifact.minutes.schedules[0].minutes[1].minute_id, 3);
  assert.equal(result.artifact.minutes.schedules[0].minutes[0].text, "名簿\n　原文空白");
  assert.equal(result.artifact.publication.public_visible, false);
});

test("本文の空白変更・順序変更・別会議index・検証失敗を保存前に拒否する", () => {
  for (const mutate of [
    (args) => { args.projection.minutes.schedules[0].minutes[0].text = "名簿\n原文空白"; },
    (args) => { args.projection.minutes.schedules[0].minutes.reverse(); },
    (args) => { args.indexItem.council_id = 999; },
    (args) => { args.validation.ok = false; },
    (args) => { args.validation.warnings.push({ gate: "provenance", message: "source revision unavailable" }); },
    (args) => { args.validation.gateResults[2].status = "fail"; },
    (args) => { args.validation.gateResults[2].status = "not_applicable"; },
    (args) => { args.validation.gateResults = []; },
    (args) => { args.projection.publication.public_visible = true; },
  ]) {
    const args = fixture(); mutate(args);
    assert.throws(() => createMinutesV2PreviewArtifact(args));
  }
});

test("本番環境や設定なしではファイルに触れる前に無効化する", () => {
  const noFilesystem = new Proxy({}, { get: () => () => { throw new Error("filesystem must not be read"); } });
  for (const env of [{ NODE_ENV: "production", MINUTES_V2_PREVIEW_ROOT: "/private" }, { NODE_ENV: "development" }]) {
    assert.equal(loadPreviewReader(env, noFilesystem)("chitose", "578").status, "disabled");
  }
});

test("保存後の改変・パス逸脱・別自治体の成果物を拒否する", (t) => {
  const root = temporary(t);
  const artifact = createMinutesV2PreviewArtifact(fixture());
  const output = writeMinutesV2PreviewArtifact(root, artifact);
  const read = loadPreviewReader({ NODE_ENV: "development", MINUTES_V2_PREVIEW_ROOT: root });
  assert.equal(read("../chitose", "578").status, "invalid");
  assert.equal(read("chitose", "../578").status, "invalid");
  assert.equal(read("chitose", "579").status, "missing");
  fs.appendFileSync(output.artifactPath, " ");
  assert.equal(read("chitose", "578").status, "invalid");
  assert.throws(() => writeMinutesV2PreviewArtifact(root, artifact), /changed/);
  fs.writeFileSync(path.join(output.directory, "current.json"), JSON.stringify({
    schema_version: "council-record-v2-preview-pointer.v1", artifact_sha256: "a".repeat(64), artifact_file: "../../private.json",
  }));
  assert.equal(read("chitose", "578").status, "invalid");
});

test("表示用の件数や非公開状態が矛盾する成果物を読み込まない", (t) => {
  const root = temporary(t);
  const read = loadPreviewReader({ NODE_ENV: "development", MINUTES_V2_PREVIEW_ROOT: root });
  for (const mutate of [
    (artifact) => { artifact.counts.turns = 9; },
    (artifact) => { artifact.counts.sittings = 99; },
    (artifact) => { artifact.publication.public_visible = true; },
    (artifact) => { artifact.validation.legacy_equivalence = false; },
    (artifact) => { artifact.validation.warning_count = 1; },
    (artifact) => { artifact.validation.gate_results[2].status = "fail"; },
    (artifact) => { artifact.validation.gate_results = []; },
  ]) {
    const artifact = createMinutesV2PreviewArtifact(fixture()); mutate(artifact);
    writeMinutesV2PreviewArtifact(root, artifact);
    assert.equal(read("chitose", "578").status, "invalid");
  }
});
