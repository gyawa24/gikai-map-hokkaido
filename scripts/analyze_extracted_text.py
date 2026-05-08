#!/usr/bin/env python3
"""
ローカル抽出済みテキストの簡易品質チェック。

data/processed/ の .md / .txt を読み、ページごとの文字数、短すぎるページ、
文字化け候補、繰り返し行によるヘッダー・フッター候補を確認する。
AWSやRAG APIには接続しない。
"""

from __future__ import annotations

import argparse
import re
import statistics
import unicodedata
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INPUT_DIR = ROOT / "data" / "processed"
DEFAULT_REPORT_DIR = ROOT / "reports"
PAGE_HEADING_RE = re.compile(r"^## Page\s+(\d+)\s*$", re.MULTILINE)
HTML_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)
FRONTMATTER_RE = re.compile(r"\A---\n.*?\n---\n", re.DOTALL)
NO_TEXT_MARKER = "[No extractable text on this page]"
SUSPECT_CHARS = set("�□■◆◇●○◎※＊★☆♪♬�")


@dataclass
class Page:
    number: int
    text: str

    @property
    def char_count(self) -> int:
        return len(re.sub(r"\s+", "", self.text))


@dataclass
class DocumentAnalysis:
    path: Path
    pages: list[Page]
    empty_pages: list[Page]
    short_pages: list[Page]
    suspect_chars: Counter[str]
    symbol_ratio: float
    repeated_lines: list[tuple[str, int]]

    @property
    def total_chars(self) -> int:
        return sum(page.char_count for page in self.pages)

    @property
    def page_count(self) -> int:
        return len(self.pages)

    @property
    def avg_chars(self) -> float:
        return self.total_chars / self.page_count if self.page_count else 0.0

    @property
    def median_chars(self) -> float:
        if not self.pages:
            return 0.0
        return float(statistics.median(page.char_count for page in self.pages))


def strip_frontmatter(text: str) -> str:
    return FRONTMATTER_RE.sub("", text, count=1)


def strip_page_boilerplate(text: str) -> str:
    text = HTML_COMMENT_RE.sub("", text)
    text = text.replace(NO_TEXT_MARKER, "")
    return text.strip()


def parse_markdown_pages(text: str) -> list[Page]:
    body = strip_frontmatter(text)
    matches = list(PAGE_HEADING_RE.finditer(body))
    if not matches:
        return [Page(number=1, text=strip_page_boilerplate(body))]

    pages: list[Page] = []
    for index, match in enumerate(matches):
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(body)
        pages.append(Page(number=int(match.group(1)), text=strip_page_boilerplate(body[start:end])))
    return pages


def parse_text_pages(text: str) -> list[Page]:
    if "\f" in text:
        parts = text.split("\f")
        return [Page(number=index, text=part.strip()) for index, part in enumerate(parts, 1)]
    return [Page(number=1, text=text.strip())]


def load_pages(path: Path) -> list[Page]:
    text = path.read_text(encoding="utf-8", errors="replace")
    if path.suffix.lower() == ".md":
        return parse_markdown_pages(text)
    return parse_text_pages(text)


def normalized_line(line: str) -> str:
    line = re.sub(r"\s+", " ", line).strip()
    line = re.sub(r"\d+", "<num>", line)
    return line


def has_word_character(line: str) -> bool:
    line = line.replace("<num>", "")
    return any(
        char.isalpha()
        or ("\u3040" <= char <= "\u30ff")
        or ("\u4e00" <= char <= "\u9fff")
        for char in line
    )


def repeated_line_candidates(pages: list[Page], *, min_repeat: int, max_line_chars: int) -> list[tuple[str, int]]:
    counter: Counter[str] = Counter()
    for page in pages:
        seen_on_page: set[str] = set()
        for raw_line in page.text.splitlines():
            line = normalized_line(raw_line)
            if len(line) < 4 or len(line) > max_line_chars:
                continue
            if not has_word_character(line):
                continue
            if line in seen_on_page:
                continue
            seen_on_page.add(line)
            counter[line] += 1
    return [(line, count) for line, count in counter.most_common() if count >= min_repeat]


def is_symbol_like(char: str) -> bool:
    if char.isspace() or char.isalnum():
        return False
    category = unicodedata.category(char)
    return category.startswith("S") or category.startswith("P") or category.startswith("C")


def suspect_character_counts(text: str) -> tuple[Counter[str], float]:
    chars = [char for char in text if not char.isspace()]
    if not chars:
        return Counter(), 0.0

    suspect: Counter[str] = Counter()
    symbol_like = 0
    for char in chars:
        if char in SUSPECT_CHARS or char == "\ufffd":
            suspect[char] += 1
        if unicodedata.category(char).startswith("C") and char not in "\n\t":
            suspect[repr(char)] += 1
        if is_symbol_like(char):
            symbol_like += 1
    return suspect, symbol_like / len(chars)


def analyze_document(
    path: Path,
    *,
    empty_threshold: int,
    short_threshold: int,
    min_repeat: int,
    max_line_chars: int,
) -> DocumentAnalysis:
    pages = load_pages(path)
    empty_pages = [page for page in pages if page.char_count <= empty_threshold]
    short_pages = [page for page in pages if empty_threshold < page.char_count <= short_threshold]
    full_text = "\n".join(page.text for page in pages)
    suspect_chars, symbol_ratio = suspect_character_counts(full_text)
    repeated_lines = repeated_line_candidates(
        pages,
        min_repeat=min_repeat,
        max_line_chars=max_line_chars,
    )
    return DocumentAnalysis(
        path=path,
        pages=pages,
        empty_pages=empty_pages,
        short_pages=short_pages,
        suspect_chars=suspect_chars,
        symbol_ratio=symbol_ratio,
        repeated_lines=repeated_lines,
    )


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


def pages_label(pages: list[Page], *, limit: int = 20) -> str:
    numbers = [str(page.number) for page in pages]
    if not numbers:
        return "-"
    if len(numbers) > limit:
        return ", ".join(numbers[:limit]) + f", ... (+{len(numbers) - limit})"
    return ", ".join(numbers)


def format_analysis(analysis: DocumentAnalysis, *, repeated_limit: int, suspect_limit: int) -> str:
    rel_path = analysis.path.relative_to(ROOT) if analysis.path.is_relative_to(ROOT) else analysis.path
    lines = [
        f"## {rel_path}",
        "",
        f"- pages: {analysis.page_count}",
        f"- total chars: {analysis.total_chars}",
        f"- avg chars/page: {analysis.avg_chars:.1f}",
        f"- median chars/page: {analysis.median_chars:.1f}",
        f"- empty-ish pages: {len(analysis.empty_pages)} ({pages_label(analysis.empty_pages)})",
        f"- short pages: {len(analysis.short_pages)} ({pages_label(analysis.short_pages)})",
        f"- symbol ratio: {analysis.symbol_ratio:.3f}",
        "",
    ]

    if analysis.suspect_chars:
        suspect = ", ".join(
            f"`{char}`:{count}"
            for char, count in analysis.suspect_chars.most_common(suspect_limit)
        )
        lines.extend(["### Suspect Characters", "", suspect, ""])

    if analysis.repeated_lines:
        lines.extend(["### Repeated Line Candidates", ""])
        for line, count in analysis.repeated_lines[:repeated_limit]:
            lines.append(f"- {count} pages: `{line}`")
        if len(analysis.repeated_lines) > repeated_limit:
            lines.append(f"- ... +{len(analysis.repeated_lines) - repeated_limit} more")
        lines.append("")

    if analysis.empty_pages or analysis.short_pages or analysis.suspect_chars or analysis.repeated_lines:
        lines.extend([
            "### Human Check",
            "",
            "- ページ見出しと本文が対応しているか確認する。",
            "- 短いページが表紙・目次・図表ページとして妥当か確認する。",
            "- 繰り返し行がヘッダー・フッターなら、後段で除去候補にする。",
            "",
        ])

    return "\n".join(lines).rstrip()


def build_report(analyses: list[DocumentAnalysis], args: argparse.Namespace) -> str:
    now = datetime.now(timezone.utc).isoformat()
    total_pages = sum(analysis.page_count for analysis in analyses)
    total_chars = sum(analysis.total_chars for analysis in analyses)
    total_empty = sum(len(analysis.empty_pages) for analysis in analyses)
    total_short = sum(len(analysis.short_pages) for analysis in analyses)
    repeated_docs = sum(1 for analysis in analyses if analysis.repeated_lines)
    suspect_docs = sum(1 for analysis in analyses if analysis.suspect_chars)

    lines = [
        "# Extraction Quality Report",
        "",
        f"- generated_at: {now}",
        f"- documents: {len(analyses)}",
        f"- pages: {total_pages}",
        f"- total chars: {total_chars}",
        f"- empty-ish pages: {total_empty}",
        f"- short pages: {total_short}",
        f"- docs with suspect chars: {suspect_docs}",
        f"- docs with repeated line candidates: {repeated_docs}",
        f"- empty_threshold: {args.empty_threshold}",
        f"- short_threshold: {args.short_threshold}",
        "",
    ]

    for analysis in analyses:
        lines.append(format_analysis(
            analysis,
            repeated_limit=args.repeated_limit,
            suspect_limit=args.suspect_limit,
        ))
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Analyze extracted Markdown/text files before RAG ingestion."
    )
    parser.add_argument("paths", nargs="*", type=Path, help="Files or directories. Defaults to data/processed.")
    parser.add_argument("--input-dir", type=Path, default=DEFAULT_INPUT_DIR)
    parser.add_argument("--report-dir", type=Path, default=DEFAULT_REPORT_DIR)
    parser.add_argument("--write-report", action="store_true", help="Write a Markdown report under reports/.")
    parser.add_argument("--report-name", default="extraction-quality-report.md")
    parser.add_argument("--empty-threshold", type=int, default=20)
    parser.add_argument("--short-threshold", type=int, default=120)
    parser.add_argument("--min-repeat", type=int, default=3)
    parser.add_argument("--max-line-chars", type=int, default=80)
    parser.add_argument("--repeated-limit", type=int, default=20)
    parser.add_argument("--suspect-limit", type=int, default=20)
    args = parser.parse_args()

    args.input_dir = args.input_dir.expanduser().resolve()
    args.report_dir = args.report_dir.expanduser().resolve()

    files = iter_input_files(args.paths, args.input_dir)
    if not files:
        print(f"No .md or .txt files found in {args.input_dir}")
        return 0

    analyses = [
        analyze_document(
            path,
            empty_threshold=args.empty_threshold,
            short_threshold=args.short_threshold,
            min_repeat=args.min_repeat,
            max_line_chars=args.max_line_chars,
        )
        for path in files
    ]
    report = build_report(analyses, args)
    print(report)

    if args.write_report:
        args.report_dir.mkdir(parents=True, exist_ok=True)
        report_path = args.report_dir / args.report_name
        report_path.write_text(report, encoding="utf-8")
        print(f"Wrote {report_path.relative_to(ROOT)}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
