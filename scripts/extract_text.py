#!/usr/bin/env python3
"""
公開PDFのテキスト抽出をローカルで検証する。

AWSやRAG APIには接続しない。data/raw/ に置いたPDFを読み、
ページ番号と資料メタ情報つきのMarkdownを data/processed/ に出力する。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_RAW_DIR = ROOT / "data" / "raw"
DEFAULT_PROCESSED_DIR = ROOT / "data" / "processed"


@dataclass
class PageText:
    page: int
    text: str
    char_count: int


@dataclass
class ExtractionResult:
    engine: str
    page_count: int
    pages: list[PageText]

    @property
    def total_chars(self) -> int:
        return sum(page.char_count for page in self.pages)

    @property
    def text_page_count(self) -> int:
        return sum(1 for page in self.pages if page.char_count > 0)


def compact_blank_lines(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{4,}", "\n\n\n", text)
    return text.strip()


def normalize_text(text: str) -> str:
    lines = [line.rstrip() for line in text.splitlines()]
    return compact_blank_lines("\n".join(lines))


def yaml_quote(value: Any) -> str:
    text = "" if value is None else str(value)
    return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'


def output_name(pdf_path: Path) -> str:
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", pdf_path.stem).strip("_")
    return f"{safe or 'document'}.md"


def load_sidecar_metadata(pdf_path: Path) -> dict[str, Any]:
    candidates = [
        pdf_path.with_suffix(pdf_path.suffix + ".metadata.json"),
        pdf_path.with_suffix(".metadata.json"),
    ]
    for candidate in candidates:
        if not candidate.exists():
            continue
        data = json.loads(candidate.read_text(encoding="utf-8"))
        attrs = data.get("metadataAttributes", data)
        if not isinstance(attrs, dict):
            raise ValueError(f"metadata must be an object: {candidate}")
        return attrs
    return {}


def extract_with_pdfplumber(pdf_path: Path, *, layout: bool) -> ExtractionResult:
    import pdfplumber

    pages: list[PageText] = []
    with pdfplumber.open(pdf_path) as pdf:
        for index, page in enumerate(pdf.pages, 1):
            try:
                raw_text = page.extract_text(layout=layout) or ""
            except TypeError:
                raw_text = page.extract_text() or ""
            text = normalize_text(raw_text)
            char_count = len(re.sub(r"\s+", "", text))
            pages.append(PageText(page=index, text=text, char_count=char_count))
        return ExtractionResult(
            engine="pdfplumber",
            page_count=len(pdf.pages),
            pages=pages,
        )


def extract_with_pymupdf(pdf_path: Path) -> ExtractionResult:
    import fitz

    pages: list[PageText] = []
    with fitz.open(pdf_path) as doc:
        for index, page in enumerate(doc, 1):
            text = normalize_text(page.get_text("text") or "")
            char_count = len(re.sub(r"\s+", "", text))
            pages.append(PageText(page=index, text=text, char_count=char_count))
        return ExtractionResult(
            engine="pymupdf",
            page_count=len(doc),
            pages=pages,
        )


def extract_pdf(pdf_path: Path, *, layout: bool) -> ExtractionResult:
    errors: list[str] = []
    try:
        return extract_with_pdfplumber(pdf_path, layout=layout)
    except ImportError as exc:
        errors.append(f"pdfplumber unavailable: {exc}")
    except Exception as exc:
        errors.append(f"pdfplumber failed: {exc}")

    try:
        return extract_with_pymupdf(pdf_path)
    except ImportError as exc:
        errors.append(f"pymupdf unavailable: {exc}")
    except Exception as exc:
        errors.append(f"pymupdf failed: {exc}")

    raise RuntimeError("; ".join(errors))


def is_ocr_required(
    result: ExtractionResult,
    *,
    min_document_chars: int,
    min_chars_per_text_page: int,
    min_text_page_ratio: float,
) -> tuple[bool, str]:
    if result.page_count == 0:
        return True, "page_count=0"

    usable_pages = sum(1 for page in result.pages if page.char_count >= min_chars_per_text_page)
    usable_ratio = usable_pages / result.page_count

    if result.total_chars < min_document_chars:
        return True, f"total_chars={result.total_chars} < {min_document_chars}"
    if usable_ratio < min_text_page_ratio:
        return True, f"usable_page_ratio={usable_ratio:.2f} < {min_text_page_ratio:.2f}"
    return False, "text layer detected"


def build_markdown(
    pdf_path: Path,
    result: ExtractionResult,
    *,
    metadata: dict[str, Any],
    title: str | None,
    source_url: str | None,
) -> str:
    now = datetime.now(timezone.utc).isoformat()
    doc_title = title or metadata.get("title") or pdf_path.stem
    doc_url = source_url or metadata.get("url") or metadata.get("source_url") or ""

    frontmatter = {
        "title": doc_title,
        "source_file": pdf_path.name,
        "source_url": doc_url,
        "extracted_at": now,
        "extractor": result.engine,
        "page_count": result.page_count,
        "text_page_count": result.text_page_count,
        "total_text_chars": result.total_chars,
    }

    for key in ["year", "category", "department", "priority", "source_type"]:
        if metadata.get(key) is not None:
            frontmatter[key] = metadata[key]

    lines = ["---"]
    for key, value in frontmatter.items():
        lines.append(f"{key}: {yaml_quote(value)}")
    lines.extend(["---", "", f"# {doc_title}", ""])

    if doc_url:
        lines.extend([f"- Source: {doc_url}", f"- Source file: `{pdf_path.name}`", ""])

    for page in result.pages:
        lines.append(f"## Page {page.page}")
        lines.append("")
        lines.append(f"<!-- source_file: {pdf_path.name}; page: {page.page}; chars: {page.char_count} -->")
        lines.append("")
        if page.text:
            lines.append(page.text)
        else:
            lines.append("[No extractable text on this page]")
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def iter_pdf_files(paths: list[Path], raw_dir: Path) -> list[Path]:
    if paths:
        return [path.expanduser().resolve() for path in paths]
    return sorted(raw_dir.glob("*.pdf"))


def process_pdf(pdf_path: Path, args: argparse.Namespace) -> bool:
    if not pdf_path.exists():
        print(f"SKIP missing: {pdf_path}", file=sys.stderr)
        return False
    if pdf_path.suffix.lower() != ".pdf":
        print(f"SKIP not a PDF: {pdf_path}", file=sys.stderr)
        return False

    metadata = load_sidecar_metadata(pdf_path)
    result = extract_pdf(pdf_path, layout=args.layout)
    requires_ocr, reason = is_ocr_required(
        result,
        min_document_chars=args.min_document_chars,
        min_chars_per_text_page=args.min_chars_per_text_page,
        min_text_page_ratio=args.min_text_page_ratio,
    )

    if requires_ocr:
        print(
            f"SKIP OCR likely required: {pdf_path.name} "
            f"({reason}, pages={result.page_count}, chars={result.total_chars})"
        )
        return False

    args.output_dir.mkdir(parents=True, exist_ok=True)
    out_path = args.output_dir / output_name(pdf_path)
    markdown = build_markdown(
        pdf_path,
        result,
        metadata=metadata,
        title=args.title,
        source_url=args.source_url,
    )
    out_path.write_text(markdown, encoding="utf-8")
    print(
        f"WROTE {out_path.relative_to(ROOT)} "
        f"(pages={result.page_count}, text_pages={result.text_page_count}, chars={result.total_chars})"
    )
    return True


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Extract text from public PDF files under data/raw into Markdown under data/processed."
    )
    parser.add_argument("pdfs", nargs="*", type=Path, help="PDF files. Defaults to all data/raw/*.pdf")
    parser.add_argument("--raw-dir", type=Path, default=DEFAULT_RAW_DIR)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_PROCESSED_DIR)
    parser.add_argument("--title", help="Document title. Use only when processing one PDF.")
    parser.add_argument("--source-url", help="Official source page URL. Sidecar metadata is preferred.")
    parser.add_argument("--layout", action="store_true", help="Ask pdfplumber to preserve layout spacing.")
    parser.add_argument("--min-document-chars", type=int, default=500)
    parser.add_argument("--min-chars-per-text-page", type=int, default=40)
    parser.add_argument("--min-text-page-ratio", type=float, default=0.30)
    args = parser.parse_args()

    args.raw_dir = args.raw_dir.expanduser().resolve()
    args.output_dir = args.output_dir.expanduser().resolve()

    pdfs = iter_pdf_files(args.pdfs, args.raw_dir)
    if not pdfs:
        print(f"No PDF files found in {args.raw_dir}")
        return 0
    if args.title and len(pdfs) != 1:
        print("--title can be used only when processing one PDF", file=sys.stderr)
        return 2
    if args.source_url and len(pdfs) != 1:
        print("--source-url can be used only when processing one PDF", file=sys.stderr)
        return 2

    successes = 0
    for pdf_path in pdfs:
        try:
            if process_pdf(pdf_path, args):
                successes += 1
        except Exception as exc:
            print(f"ERROR {pdf_path}: {exc}", file=sys.stderr)

    print(f"Done: {successes}/{len(pdfs)} PDF(s) extracted")
    return 0 if successes or len(pdfs) == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
