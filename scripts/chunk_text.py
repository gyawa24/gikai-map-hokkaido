#!/usr/bin/env python3
"""
抽出済みMarkdown/textをRAG投入前のJSONLチャンクに分割する。

AWSやRAG APIには接続しない。data/processed/ の .md / .txt を読み、
資料名、ページ範囲、見出し候補を保持したJSONLを data/chunks/ に出力する。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INPUT_DIR = ROOT / "data" / "processed"
DEFAULT_OUTPUT_DIR = ROOT / "data" / "chunks"
FRONTMATTER_RE = re.compile(r"\A---\n(.*?)\n---\n", re.DOTALL)
PAGE_HEADING_RE = re.compile(r"^## Page\s+(\d+)\s*$", re.MULTILINE)
HTML_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)
NO_TEXT_MARKER = "[No extractable text on this page]"


@dataclass
class Page:
    number: int
    text: str
    section: str | None

    @property
    def char_count(self) -> int:
        return count_chars(self.text)


@dataclass
class Document:
    path: Path
    title: str
    source_file: str
    pages: list[Page]


@dataclass
class ChunkDraft:
    pages: list[Page]

    @property
    def text(self) -> str:
        return "\n\n".join(page.text for page in self.pages if page.text).strip()

    @property
    def char_count(self) -> int:
        return count_chars(self.text)

    @property
    def page_start(self) -> int:
        return self.pages[0].number

    @property
    def page_end(self) -> int:
        return self.pages[-1].number

    @property
    def section(self) -> str | None:
        for page in self.pages:
            if page.section:
                return page.section
        return None


def count_chars(text: str) -> int:
    return len(re.sub(r"\s+", "", text))


def normalize_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = HTML_COMMENT_RE.sub("", text)
    text = text.replace(NO_TEXT_MARKER, "")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{4,}", "\n\n\n", text)
    return text.strip()


def parse_frontmatter(raw: str) -> tuple[dict[str, str], str]:
    match = FRONTMATTER_RE.match(raw)
    if not match:
        return {}, raw

    metadata: dict[str, str] = {}
    for line in match.group(1).splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        metadata[key.strip()] = value.strip().strip('"')
    return metadata, raw[match.end():]


def candidate_section(text: str) -> str | None:
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith(("#", "-", "*", "|")):
            continue
        if len(line) > 80:
            continue
        if re.fullmatch(r"[0-9０-９.,，．・\s]+", line):
            continue
        if re.match(r"^(第[0-9０-９一二三四五六七八九十]+[章節部編]|[0-9０-９]+(?:\.[0-9０-９]+)*[.)．、]?\s*)", line):
            return line
        if len(line) <= 30 and count_chars(text) > 120:
            return line
    return None


def parse_markdown_document(path: Path, raw: str) -> Document:
    metadata, body = parse_frontmatter(raw)
    title = metadata.get("title") or path.stem
    source_file = metadata.get("source_file") or path.name

    matches = list(PAGE_HEADING_RE.finditer(body))
    if not matches:
        text = normalize_text(body)
        return Document(
            path=path,
            title=title,
            source_file=source_file,
            pages=[Page(number=1, text=text, section=candidate_section(text))] if text else [],
        )

    pages: list[Page] = []
    for index, match in enumerate(matches):
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(body)
        text = normalize_text(body[start:end])
        if not text:
            continue
        pages.append(Page(
            number=int(match.group(1)),
            text=text,
            section=candidate_section(text),
        ))
    return Document(path=path, title=title, source_file=source_file, pages=pages)


def parse_text_document(path: Path, raw: str) -> Document:
    parts = raw.split("\f") if "\f" in raw else [raw]
    pages: list[Page] = []
    for index, part in enumerate(parts, 1):
        text = normalize_text(part)
        if not text:
            continue
        pages.append(Page(number=index, text=text, section=candidate_section(text)))
    return Document(path=path, title=path.stem, source_file=path.name, pages=pages)


def load_document(path: Path) -> Document:
    raw = path.read_text(encoding="utf-8", errors="replace")
    if path.suffix.lower() == ".md":
        return parse_markdown_document(path, raw)
    return parse_text_document(path, raw)


def split_long_page(page: Page, *, max_chars: int) -> list[Page]:
    if page.char_count <= max_chars:
        return [page]

    paragraphs = [paragraph.strip() for paragraph in re.split(r"\n{2,}", page.text) if paragraph.strip()]
    if len(paragraphs) <= 1:
        lines = [line.strip() for line in page.text.splitlines() if line.strip()]
        paragraphs = lines if len(lines) > 1 else [page.text]

    parts: list[Page] = []
    buffer: list[str] = []
    for paragraph in paragraphs:
        candidate = "\n\n".join(buffer + [paragraph]).strip()
        if buffer and count_chars(candidate) > max_chars:
            text = "\n\n".join(buffer).strip()
            parts.append(Page(number=page.number, text=text, section=page.section or candidate_section(text)))
            buffer = [paragraph]
        else:
            buffer.append(paragraph)

    if buffer:
        text = "\n\n".join(buffer).strip()
        parts.append(Page(number=page.number, text=text, section=page.section or candidate_section(text)))
    return parts


def build_chunk_drafts(document: Document, *, target_chars: int, max_chars: int) -> list[ChunkDraft]:
    pieces: list[Page] = []
    for page in document.pages:
        pieces.extend(split_long_page(page, max_chars=max_chars))

    chunks: list[ChunkDraft] = []
    current: list[Page] = []

    for piece in pieces:
        if not current:
            current = [piece]
            continue

        current_text = "\n\n".join(page.text for page in current)
        next_text = f"{current_text}\n\n{piece.text}"
        same_page = piece.number == current[-1].number
        section_changes = bool(piece.section and current[-1].section and piece.section != current[-1].section)

        if count_chars(next_text) > max_chars or (count_chars(current_text) >= target_chars and section_changes and not same_page):
            chunks.append(ChunkDraft(pages=current))
            current = [piece]
        else:
            current.append(piece)

    if current:
        chunks.append(ChunkDraft(pages=current))
    return merge_small_chunks(chunks, min_chars=max(1, target_chars // 2), max_chars=max_chars)


def merge_small_chunks(chunks: list[ChunkDraft], *, min_chars: int, max_chars: int) -> list[ChunkDraft]:
    if not chunks:
        return []

    merged: list[ChunkDraft] = []
    for chunk in chunks:
        if (
            merged
            and chunk.char_count < min_chars
            and merged[-1].char_count + chunk.char_count <= max_chars
        ):
            merged[-1] = ChunkDraft(pages=merged[-1].pages + chunk.pages)
        else:
            merged.append(chunk)

    if len(merged) <= 1:
        return merged

    compacted: list[ChunkDraft] = []
    index = 0
    while index < len(merged):
        chunk = merged[index]
        next_chunk = merged[index + 1] if index + 1 < len(merged) else None
        if (
            next_chunk
            and chunk.char_count < min_chars
            and chunk.char_count + next_chunk.char_count <= max_chars
        ):
            compacted.append(ChunkDraft(pages=chunk.pages + next_chunk.pages))
            index += 2
        else:
            compacted.append(chunk)
            index += 1
    return compacted


def stable_id(document: Document, chunk: ChunkDraft, index: int) -> str:
    base = f"{document.source_file}:{chunk.page_start}-{chunk.page_end}:{index}:{chunk.text[:80]}"
    digest = hashlib.sha1(base.encode("utf-8")).hexdigest()[:10]
    stem = re.sub(r"[^A-Za-z0-9_-]+", "_", Path(document.source_file).stem).strip("_")
    return f"{stem or 'document'}-{index:04d}-{digest}"


def chunk_to_record(document: Document, chunk: ChunkDraft, index: int) -> dict[str, Any]:
    return {
        "id": stable_id(document, chunk, index),
        "source_file": document.source_file,
        "source_title": document.title,
        "page_start": chunk.page_start,
        "page_end": chunk.page_end,
        "section": chunk.section,
        "text": chunk.text,
        "char_count": chunk.char_count,
    }


def output_name(path: Path) -> str:
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", path.stem).strip("_")
    return f"{safe or 'document'}.jsonl"


def iter_input_files(paths: list[Path], input_dir: Path) -> list[Path]:
    if paths:
        files: list[Path] = []
        for path in paths:
            resolved = path.expanduser().resolve()
            if resolved.is_dir():
                files.extend(sorted(p for p in resolved.rglob("*") if p.suffix.lower() in {".md", ".txt"}))
            else:
                files.append(resolved)
        return files
    return sorted(p for p in input_dir.rglob("*") if p.suffix.lower() in {".md", ".txt"})


def process_file(path: Path, args: argparse.Namespace) -> int:
    document = load_document(path)
    if not document.pages:
        print(f"SKIP no text pages: {path}")
        return 0

    chunks = build_chunk_drafts(
        document,
        target_chars=args.target_chars,
        max_chars=args.max_chars,
    )
    args.output_dir.mkdir(parents=True, exist_ok=True)
    out_path = args.output_dir / output_name(path)

    with out_path.open("w", encoding="utf-8") as f:
        for index, chunk in enumerate(chunks, 1):
            record = chunk_to_record(document, chunk, index)
            f.write(json.dumps(record, ensure_ascii=False) + "\n")

    counts = [chunk.char_count for chunk in chunks]
    min_chars = min(counts) if counts else 0
    max_chars = max(counts) if counts else 0
    avg_chars = sum(counts) / len(counts) if counts else 0
    rel_out = out_path.relative_to(ROOT) if out_path.is_relative_to(ROOT) else out_path
    print(
        f"WROTE {rel_out} "
        f"(chunks={len(chunks)}, pages={len(document.pages)}, "
        f"chars min/avg/max={min_chars}/{avg_chars:.1f}/{max_chars})"
    )
    return len(chunks)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Chunk extracted Markdown/text files into local JSONL records."
    )
    parser.add_argument("paths", nargs="*", type=Path, help="Files or directories. Defaults to data/processed.")
    parser.add_argument("--input-dir", type=Path, default=DEFAULT_INPUT_DIR)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--target-chars", type=int, default=1000)
    parser.add_argument("--max-chars", type=int, default=1200)
    args = parser.parse_args()

    args.input_dir = args.input_dir.expanduser().resolve()
    args.output_dir = args.output_dir.expanduser().resolve()
    if args.target_chars <= 0 or args.max_chars <= 0:
        raise SystemExit("target/max chars must be positive")
    if args.target_chars > args.max_chars:
        raise SystemExit("--target-chars must be less than or equal to --max-chars")

    files = iter_input_files(args.paths, args.input_dir)
    if not files:
        print(f"No .md or .txt files found in {args.input_dir}")
        return 0

    total_chunks = 0
    for path in files:
        total_chunks += process_file(path, args)
    print(f"Done: {total_chunks} chunk(s) from {len(files)} file(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
