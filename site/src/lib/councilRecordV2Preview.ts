import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { MinutesIndexItem, MinutesSession } from "@/types/minutes";
import { isMinutesSession } from "@/lib/minutesSessionValidation";

type PreviewArtifact = {
  schema_version: "council-record-v2-preview.v1";
  record_id: string;
  municipality_id: string;
  council_id: string;
  prepared_at: string;
  publication: { state: "internal_preview"; public_visible: false };
  validation: { ok: true; legacy_equivalence: true; warning_count: 0; gate_results: { gate: string; status: string }[] };
  counts: { sittings: number; turns: number; document_items: number; original_records: number };
  minutes: MinutesSession;
  index_item: MinutesIndexItem;
};

export type MinutesV2PreviewResult =
  | { status: "available"; artifact: PreviewArtifact }
  | { status: "disabled" | "missing" | "invalid" };

export function loadMinutesV2Preview(city: string, id: string): MinutesV2PreviewResult {
  // 検証用ファイルを公開Workerから読める経路にしない。
  if (process.env.NODE_ENV !== "development" || !process.env.MINUTES_V2_PREVIEW_ROOT) return { status: "disabled" };
  if (!/^[a-z][a-z0-9_-]*$/u.test(city) || !/^\d+$/u.test(id)) return { status: "invalid" };
  const directory = path.join(/*turbopackIgnore: true*/ process.env.MINUTES_V2_PREVIEW_ROOT, city, id);
  const pointerPath = path.join(/*turbopackIgnore: true*/ directory, "current.json");
  try {
    if (!fs.existsSync(/*turbopackIgnore: true*/ pointerPath)) return { status: "missing" };
    const pointer = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ pointerPath, "utf8"));
    if (pointer.schema_version !== "council-record-v2-preview-pointer.v1"
      || !/^[a-f0-9]{64}$/u.test(pointer.artifact_sha256)
      || pointer.artifact_file !== `${pointer.artifact_sha256}.json`) return { status: "invalid" };
    const artifactPath = path.join(/*turbopackIgnore: true*/ directory, pointer.artifact_file);
    if (fs.statSync(/*turbopackIgnore: true*/ artifactPath).size > 32 * 1024 * 1024) return { status: "invalid" };
    const bytes = fs.readFileSync(/*turbopackIgnore: true*/ artifactPath);
    if (createHash("sha256").update(bytes).digest("hex") !== pointer.artifact_sha256) return { status: "invalid" };
    const artifact = JSON.parse(bytes.toString("utf8")) as PreviewArtifact;
    if (artifact.schema_version !== "council-record-v2-preview.v1"
      || artifact.municipality_id !== city || artifact.council_id !== id
      || artifact.publication?.state !== "internal_preview" || artifact.publication?.public_visible !== false
      || artifact.validation?.ok !== true || artifact.validation?.legacy_equivalence !== true
      || artifact.validation.warning_count !== 0 || !Array.isArray(artifact.validation.gate_results)
      || !isMinutesSession(artifact.minutes, id) || String(artifact.index_item?.council_id) !== id
      || !Number.isSafeInteger(artifact.counts?.original_records) || artifact.counts.original_records < 0
      || !Number.isSafeInteger(artifact.counts?.turns) || artifact.counts.turns < 0
      || !Number.isSafeInteger(artifact.counts?.document_items) || artifact.counts.document_items < 0
      || !Number.isFinite(Date.parse(artifact.prepared_at))) return { status: "invalid" };
    const gates = artifact.validation.gate_results;
    if (gates.some((result) => !["pass", "not_applicable"].includes(result.status))
      || ["schema", "graph", "provenance", "content", "freshness"].some((gate) => {
        const results = gates.filter((result) => result.gate === gate);
        return results.length !== 1 || results[0].status !== "pass";
      })) return { status: "invalid" };
    const originalCount = artifact.minutes.schedules.reduce((total, sitting) => total + sitting.minutes.length, 0);
    if (artifact.counts.sittings !== artifact.minutes.schedules.length
      || artifact.counts.original_records !== originalCount
      || artifact.counts.turns + artifact.counts.document_items !== originalCount) return { status: "invalid" };
    return { status: "available", artifact };
  } catch {
    return { status: "invalid" };
  }
}
