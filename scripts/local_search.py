#!/usr/bin/env python3
"""
ローカルJSONLチャンクの簡易キーワード検索。

AWS、LLM API、ベクトル検索は使わない。data/chunks/ の .jsonl を読み、
資料名・ページ範囲・見出し・抜粋つきで関連チャンクを表示する。
"""

from __future__ import annotations

import argparse
import json
import math
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CHUNKS_DIR = ROOT / "data" / "chunks"


@dataclass
class Chunk:
    id: str
    source_file: str
    source_title: str
    page_start: int
    page_end: int
    section: str | None
    text: str
    char_count: int


@dataclass
class SearchResult:
    chunk: Chunk
    score: float
    matched_terms: list[str]
    excerpt: str


def normalize(text: str) -> str:
    return unicodedata.normalize("NFKC", text).casefold()


def query_terms(query: str) -> list[str]:
    normalized = normalize(query)
    parts = [part.strip() for part in re.split(r"\s+", normalized) if part.strip()]
    seen: set[str] = set()
    terms: list[str] = []
    for part in parts:
        if part not in seen:
            seen.add(part)
            terms.append(part)
    return terms


def iter_jsonl_files(paths: list[Path], chunks_dir: Path) -> list[Path]:
    if paths:
        files: list[Path] = []
        for path in paths:
            resolved = path.expanduser().resolve()
            if resolved.is_dir():
                files.extend(sorted(resolved.rglob("*.jsonl")))
            else:
                files.append(resolved)
        return files
    return sorted(chunks_dir.rglob("*.jsonl"))


def chunk_from_record(record: dict[str, Any]) -> Chunk:
    return Chunk(
        id=str(record.get("id", "")),
        source_file=str(record.get("source_file", "")),
        source_title=str(record.get("source_title", "")),
        page_start=int(record.get("page_start", 0)),
        page_end=int(record.get("page_end", 0)),
        section=record.get("section") if record.get("section") is not None else None,
        text=str(record.get("text", "")),
        char_count=int(record.get("char_count", 0)),
    )


def load_chunks(files: list[Path]) -> list[Chunk]:
    chunks: list[Chunk] = []
    for path in files:
        with path.open("r", encoding="utf-8", errors="replace") as f:
            for line_no, line in enumerate(f, 1):
                stripped = line.strip()
                if not stripped:
                    continue
                try:
                    value = json.loads(stripped)
                except json.JSONDecodeError as exc:
                    raise RuntimeError(f"invalid JSON: {path}:{line_no}: {exc}") from exc
                if not isinstance(value, dict):
                    raise RuntimeError(f"JSON value is not an object: {path}:{line_no}")
                chunks.append(chunk_from_record(value))
    return chunks


def count_occurrences(haystack: str, needle: str) -> int:
    if not needle:
        return 0
    return haystack.count(needle)


def build_idf(chunks: list[Chunk], terms: list[str]) -> dict[str, float]:
    if not chunks:
        return {term: 1.0 for term in terms}

    idf: dict[str, float] = {}
    for term in terms:
        document_frequency = 0
        for chunk in chunks:
            haystack = normalize(" ".join([
                chunk.text,
                chunk.section or "",
                chunk.source_title,
                chunk.source_file,
            ]))
            if term in haystack:
                document_frequency += 1
        idf[term] = math.log((len(chunks) + 1) / (document_frequency + 1)) + 1
    return idf


def score_chunk(chunk: Chunk, *, query: str, terms: list[str], idf: dict[str, float]) -> tuple[float, list[str]]:
    text = normalize(chunk.text)
    section = normalize(chunk.section or "")
    title = normalize(chunk.source_title)
    source_file = normalize(chunk.source_file)
    full_query = normalize(query).strip()

    score = 0.0
    matched_terms: list[str] = []

    if full_query and full_query in text:
        score += 5.0
    if full_query and full_query in section:
        score += 3.0
    if full_query and full_query in title:
        score += 3.0

    for term in terms:
        text_hits = count_occurrences(text, term)
        section_hits = count_occurrences(section, term)
        title_hits = count_occurrences(title, term)
        file_hits = count_occurrences(source_file, term)

        if text_hits or section_hits or title_hits or file_hits:
            matched_terms.append(term)

        weight = idf.get(term, 1.0)
        score += min(text_hits, 8) * 1.0 * weight
        score += min(section_hits, 4) * 2.5 * weight
        score += min(title_hits, 4) * 2.0 * weight
        score += min(file_hits, 2) * 1.0 * weight

    if terms and len(set(matched_terms)) == len(terms):
        score += 2.0

    return score, matched_terms


def excerpt_for(chunk: Chunk, terms: list[str], *, length: int) -> str:
    text = re.sub(r"\s+", " ", chunk.text).strip()
    if len(text) <= length:
        return text

    normalized_text = normalize(text)
    positions = [normalized_text.find(term) for term in terms if normalized_text.find(term) >= 0]
    if positions:
        center = min(positions)
        start = max(0, center - length // 3)
    else:
        start = 0
    end = min(len(text), start + length)
    start = max(0, end - length)
    prefix = "..." if start > 0 else ""
    suffix = "..." if end < len(text) else ""
    return f"{prefix}{text[start:end]}{suffix}"


def search(chunks: list[Chunk], *, query: str, top_k: int, excerpt_chars: int) -> list[SearchResult]:
    terms = query_terms(query)
    idf = build_idf(chunks, terms)
    results: list[SearchResult] = []
    for chunk in chunks:
        score, matched_terms = score_chunk(chunk, query=query, terms=terms, idf=idf)
        if score <= 0:
            continue
        results.append(SearchResult(
            chunk=chunk,
            score=score,
            matched_terms=matched_terms,
            excerpt=excerpt_for(chunk, matched_terms or terms, length=excerpt_chars),
        ))
    results.sort(key=lambda result: (-result.score, result.chunk.source_title, result.chunk.page_start, result.chunk.id))
    return results[:top_k]


def page_label(chunk: Chunk) -> str:
    if chunk.page_start == chunk.page_end:
        return str(chunk.page_start)
    return f"{chunk.page_start}-{chunk.page_end}"


def print_text_results(results: list[SearchResult], *, query: str) -> None:
    print(f"Query: {query}")
    print(f"Results: {len(results)}")
    print("")
    for index, result in enumerate(results, 1):
        chunk = result.chunk
        print(f"{index}. score={result.score:.2f}")
        print(f"   source_title: {chunk.source_title}")
        print(f"   source_file: {chunk.source_file}")
        print(f"   pages: {page_label(chunk)}")
        print(f"   section: {chunk.section or '-'}")
        print(f"   matched_terms: {', '.join(result.matched_terms) if result.matched_terms else '-'}")
        print(f"   excerpt: {result.excerpt}")
        print("")


def result_to_json(result: SearchResult) -> dict[str, Any]:
    chunk = result.chunk
    return {
        "score": result.score,
        "id": chunk.id,
        "source_title": chunk.source_title,
        "source_file": chunk.source_file,
        "page_start": chunk.page_start,
        "page_end": chunk.page_end,
        "section": chunk.section,
        "matched_terms": result.matched_terms,
        "excerpt": result.excerpt,
        "char_count": chunk.char_count,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Search local chunk JSONL files with simple keyword scoring."
    )
    parser.add_argument("query", help="Search query. Use spaces between important keywords.")
    parser.add_argument("--chunks-dir", type=Path, default=DEFAULT_CHUNKS_DIR)
    parser.add_argument("--paths", nargs="*", type=Path, default=[], help="Optional JSONL files or directories.")
    parser.add_argument("--top-k", type=int, default=5)
    parser.add_argument("--excerpt-chars", type=int, default=260)
    parser.add_argument("--json", action="store_true", dest="json_output")
    args = parser.parse_args()

    if args.top_k <= 0:
        raise SystemExit("--top-k must be positive")
    if args.excerpt_chars <= 0:
        raise SystemExit("--excerpt-chars must be positive")

    args.chunks_dir = args.chunks_dir.expanduser().resolve()
    files = iter_jsonl_files(args.paths, args.chunks_dir)
    if not files:
        raise SystemExit(f"No .jsonl files found in {args.chunks_dir}")

    chunks = load_chunks(files)
    results = search(chunks, query=args.query, top_k=args.top_k, excerpt_chars=args.excerpt_chars)

    if args.json_output:
        payload = {
            "query": args.query,
            "top_k": args.top_k,
            "total_chunks": len(chunks),
            "results": [result_to_json(result) for result in results],
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print_text_results(results, query=args.query)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
