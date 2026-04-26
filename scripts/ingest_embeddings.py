#!/usr/bin/env python3
"""
data/{slug}/minutes/*.json を Gemini batchEmbedContents で一括埋め込み、
Supabase council_chunks に投入する。

特徴:
- batchEmbedContents で1リクエスト = 100チャンク（個別 embed の100倍速）
- HTTP タイムアウト 60秒 / 429 で指数バックオフ / SDK非依存（gRPC ハングを回避）
- DB に既存の meeting_name はファイル単位でスキップ（再開可能・冪等）
- print(flush=True) で進捗が即時見える

Usage:
  python scripts/ingest_embeddings.py
  python scripts/ingest_embeddings.py eniwa
  EMBEDDING_SLUG=tomakomai python scripts/ingest_embeddings.py
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import requests
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / "site" / ".env.local")

from supabase import create_client  # noqa: E402

GEMINI_API_KEY = os.environ["GEMINI_API_KEY"]
SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

DEFAULT_SLUG = "chitose"
DEFAULT_MUNICIPALITY = "千歳市"


def municipality_name_from_slug(slug: str) -> str | None:
    fp = PROJECT_ROOT / "data" / "municipalities.json"
    if not fp.exists():
        return None
    try:
        items = json.loads(fp.read_text(encoding="utf-8"))
    except Exception:
        return None
    for item in items:
        if item.get("slug") == slug:
            return item.get("name")
    return None


SLUG = os.environ.get("EMBEDDING_SLUG") or (sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SLUG)
MUNICIPALITY = (
    os.environ.get("EMBEDDING_MUNICIPALITY")
    or (sys.argv[2] if len(sys.argv) > 2 else None)
    or municipality_name_from_slug(SLUG)
    or DEFAULT_MUNICIPALITY
)
MINUTES_DIR = PROJECT_ROOT / "data" / SLUG / "minutes"

CHUNK_SIZE = 500
CHUNK_OVERLAP = 100
EMBED_MODEL = "gemini-embedding-001"
EMBED_DIM = 768
EMBED_BATCH = 100      # batchEmbedContents 1コールあたり
INSERT_BATCH = 100     # Supabase insert 1コールあたり
HTTP_TIMEOUT = 60
INSERT_TIMEOUT = 120
RETRY_MAX = 5
RETRY_BASE_SLEEP = 2.0

EMBED_URL = (
    f"https://generativelanguage.googleapis.com/v1beta/"
    f"models/{EMBED_MODEL}:batchEmbedContents?key={GEMINI_API_KEY}"
)
INSERT_URL = f"{SUPABASE_URL}/rest/v1/council_chunks"
INSERT_HEADERS = {
    "apikey": SUPABASE_SERVICE_ROLE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}

QUESTION_TYPES = {"◆質問", "○一般質問"}
ANSWER_TYPES = {"◎答弁", "◎市長"}


def speaker_role_from_minute_type(minute_type: str) -> str:
    if minute_type in QUESTION_TYPES:
        return "question"
    if minute_type in ANSWER_TYPES:
        return "answer"
    if minute_type == "○議長":
        return "chair"
    if minute_type == "△議題":
        return "agenda"
    return "other"


def chunk_text(text: str) -> list[str]:
    if not text:
        return []
    chunks: list[str] = []
    n = len(text)
    start = 0
    while start < n:
        end = min(start + CHUNK_SIZE, n)
        piece = text[start:end].strip()
        if piece:
            chunks.append(piece)
        if end == n:
            break
        start = end - CHUNK_OVERLAP
    return chunks


def embed_batch(texts: list[str]) -> list[list[float]]:
    body = {
        "requests": [
            {
                "model": f"models/{EMBED_MODEL}",
                "content": {"parts": [{"text": t}]},
                "taskType": "RETRIEVAL_DOCUMENT",
                "outputDimensionality": EMBED_DIM,
            }
            for t in texts
        ]
    }
    last_err: str = ""
    for attempt in range(RETRY_MAX):
        try:
            r = requests.post(EMBED_URL, json=body, timeout=HTTP_TIMEOUT)
            if r.status_code == 200:
                j = r.json()
                return [e["values"] for e in j["embeddings"]]
            if r.status_code == 429:
                sleep = RETRY_BASE_SLEEP * (2 ** attempt)
                print(
                    f"    [429 attempt {attempt+1}/{RETRY_MAX}] sleeping {sleep:.1f}s",
                    flush=True,
                )
                time.sleep(sleep)
                continue
            last_err = f"HTTP {r.status_code}: {r.text[:200]}"
            print(f"    [error attempt {attempt+1}/{RETRY_MAX}] {last_err}", flush=True)
            time.sleep(RETRY_BASE_SLEEP * (2 ** attempt))
        except requests.exceptions.Timeout:
            last_err = "timeout"
            sleep = RETRY_BASE_SLEEP * (2 ** attempt)
            print(
                f"    [timeout attempt {attempt+1}/{RETRY_MAX}] sleeping {sleep:.1f}s",
                flush=True,
            )
            time.sleep(sleep)
        except Exception as e:
            last_err = str(e)
            print(f"    [exception attempt {attempt+1}/{RETRY_MAX}] {e}", flush=True)
            time.sleep(RETRY_BASE_SLEEP * (2 ** attempt))
    raise RuntimeError(f"embed_batch failed after {RETRY_MAX} attempts: {last_err}")


def fmt_vector(vals: list[float]) -> str:
    return "[" + ",".join(f"{v:.7f}" for v in vals) + "]"


def insert_rows(rows: list[dict]) -> None:
    if not rows:
        return
    last_err = ""
    for attempt in range(RETRY_MAX):
        try:
            r = requests.post(
                INSERT_URL, json=rows, headers=INSERT_HEADERS, timeout=INSERT_TIMEOUT
            )
            if r.status_code in (200, 201, 204):
                return
            last_err = f"HTTP {r.status_code}: {r.text[:200]}"
            print(
                f"    [insert err attempt {attempt+1}/{RETRY_MAX}] {last_err}",
                flush=True,
            )
            time.sleep(RETRY_BASE_SLEEP * (2 ** attempt))
        except requests.exceptions.Timeout:
            last_err = "timeout"
            sleep = RETRY_BASE_SLEEP * (2 ** attempt)
            print(
                f"    [insert timeout attempt {attempt+1}/{RETRY_MAX}] sleeping {sleep:.1f}s",
                flush=True,
            )
            time.sleep(sleep)
        except Exception as e:
            last_err = str(e)
            print(
                f"    [insert exception attempt {attempt+1}/{RETRY_MAX}] {e}",
                flush=True,
            )
            time.sleep(RETRY_BASE_SLEEP * (2 ** attempt))
    raise RuntimeError(f"insert_rows failed after {RETRY_MAX} attempts: {last_err}")


def get_existing_meetings() -> set[str]:
    """municipality 内で既に投入済みの meeting_name を取得。"""
    existing: set[str] = set()
    page = 0
    PAGE = 1000
    while True:
        res = (
            sb.table("council_chunks")
            .select("meeting_name")
            .eq("municipality", MUNICIPALITY)
            .range(page * PAGE, (page + 1) * PAGE - 1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            break
        for r in rows:
            existing.add(r["meeting_name"])
        if len(rows) < PAGE:
            break
        page += 1
    return existing


def main() -> None:
    files = sorted(MINUTES_DIR.glob("*.json"))
    if not files:
        print(f"No JSON files under {MINUTES_DIR}", file=sys.stderr)
        sys.exit(1)
    print(f"[ingest] {SLUG}: {len(files)} files in {MINUTES_DIR}", flush=True)

    existing = get_existing_meetings()
    print(
        f"[ingest] DB に既存の meeting_name: {len(existing)} 件 → これらは丸ごとスキップ",
        flush=True,
    )
    for n in sorted(existing):
        print(f"    既存: {n}", flush=True)

    total_chunks = 0
    skipped_files = 0
    processed_files = 0
    t_start = time.time()

    for fi, fp in enumerate(files, 1):
        try:
            data = json.loads(fp.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"[{fi:3d}/{len(files)}] {fp.name}: 読込失敗 {e}", flush=True)
            continue
        if not isinstance(data, dict):
            # index.json などのメタファイル（list 形式）は対象外
            print(
                f"[{fi:3d}/{len(files)}] {fp.name}: 議事録本体ではないためスキップ",
                flush=True,
            )
            continue

        meeting_name = (data.get("name") or "").strip()
        if meeting_name and meeting_name in existing:
            skipped_files += 1
            print(
                f"[{fi:3d}/{len(files)}] {fp.name}: スキップ (既存 = {meeting_name})",
                flush=True,
            )
            continue

        # この会議のチャンクをメタ付きで全部集める
        file_chunks: list[dict] = []
        for sched in data.get("schedules", []) or []:
            current_agenda = ""
            for m in sched.get("minutes", []) or []:
                minute_type = (m.get("minute_type") or "").strip()
                if minute_type == "△議題":
                    current_agenda = (m.get("text") or "").replace("△", "").strip()
                    continue
                text = (m.get("text") or "").strip()
                if not text:
                    continue
                for chunk in chunk_text(text):
                    file_chunks.append(
                        {
                            "speaker": minute_type,
                            "speaker_name": (m.get("title") or "").strip(),
                            "speaker_role": speaker_role_from_minute_type(minute_type),
                            "agenda_title": current_agenda,
                            "schedule_id": m.get("schedule_id")
                            or sched.get("schedule_id"),
                            "minute_id": m.get("minute_id"),
                            "content": chunk,
                        }
                    )

        if not file_chunks:
            print(f"[{fi:3d}/{len(files)}] {fp.name}: テキストなし", flush=True)
            continue

        print(
            f"[{fi:3d}/{len(files)}] {fp.name}: 会議={meeting_name} / {len(file_chunks)} chunks",
            flush=True,
        )

        pending_rows: list[dict] = []
        file_inserted = 0
        for batch_start in range(0, len(file_chunks), EMBED_BATCH):
            batch = file_chunks[batch_start : batch_start + EMBED_BATCH]
            texts = [c["content"] for c in batch]
            t0 = time.time()
            embeddings = embed_batch(texts)
            elapsed = time.time() - t0
            print(
                f"    embed {batch_start+1}-{batch_start+len(batch)}/{len(file_chunks)} "
                f"ok in {elapsed:.1f}s",
                flush=True,
            )

            council_id = data.get("council_id")
            for chunk_meta, emb in zip(batch, embeddings):
                pending_rows.append({
                    "municipality": MUNICIPALITY,
                    "slug": SLUG,
                    "meeting_name": meeting_name,
                    "council_id": council_id,
                    "schedule_id": chunk_meta["schedule_id"],
                    "minute_id": chunk_meta["minute_id"],
                    "speaker": chunk_meta["speaker"],
                    "speaker_name": chunk_meta["speaker_name"],
                    "speaker_role": chunk_meta["speaker_role"],
                    "agenda_title": chunk_meta["agenda_title"],
                    "content": chunk_meta["content"],
                    "embedding": fmt_vector(emb),
                })
                if len(pending_rows) >= INSERT_BATCH:
                    insert_rows(pending_rows)
                    file_inserted += len(pending_rows)
                    pending_rows = []
        if pending_rows:
            insert_rows(pending_rows)
            file_inserted += len(pending_rows)
            pending_rows = []

        total_chunks += file_inserted
        processed_files += 1
        existing.add(meeting_name)
        elapsed_total = time.time() - t_start
        print(
            f"    -> {fp.name} 完了 ({file_inserted} 行追加 / 累計 {total_chunks} 行 / "
            f"経過 {elapsed_total:.0f}s)",
            flush=True,
        )

    print(
        f"[done] processed={processed_files} skipped={skipped_files} "
        f"total_inserted={total_chunks}",
        flush=True,
    )


if __name__ == "__main__":
    main()
