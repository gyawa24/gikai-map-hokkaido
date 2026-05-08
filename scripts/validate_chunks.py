#!/usr/bin/env python3
"""
RAG投入前のチャンクJSONL構造・品質チェック。

AWSやRAG APIには接続しない。data/chunks/ の .jsonl を読み、
必須項目、ID重複、文字数、ページ範囲、メタデータ欠落率を確認する。
"""

from __future__ import annotations

import argparse
import json
import re
import statistics
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INPUT_DIR = ROOT / "data" / "chunks"
DEFAULT_REPORT_DIR = ROOT / "reports"
REQUIRED_FIELDS = [
    "id",
    "source_file",
    "source_title",
    "page_start",
    "page_end",
    "section",
    "text",
    "char_count",
]


@dataclass
class Finding:
    level: str
    file: Path
    line: int
    message: str


@dataclass
class FileStats:
    path: Path
    total_lines: int = 0
    valid_records: int = 0
    json_errors: int = 0
    char_counts: list[int] = field(default_factory=list)
    missing_source_title: int = 0
    missing_section: int = 0
    empty_text: int = 0
    short_text: int = 0
    too_large_text: int = 0

    @property
    def avg_chars(self) -> float:
        return sum(self.char_counts) / len(self.char_counts) if self.char_counts else 0.0

    @property
    def median_chars(self) -> float:
        return float(statistics.median(self.char_counts)) if self.char_counts else 0.0

    @property
    def min_chars(self) -> int:
        return min(self.char_counts) if self.char_counts else 0

    @property
    def max_chars(self) -> int:
        return max(self.char_counts) if self.char_counts else 0

    def rate(self, count: int) -> float:
        return count / self.valid_records if self.valid_records else 0.0


def count_chars(text: str) -> int:
    return len(re.sub(r"\s+", "", text))


def is_missing(value: Any) -> bool:
    return value is None or (isinstance(value, str) and value.strip() == "")


def iter_jsonl_files(paths: list[Path], input_dir: Path) -> list[Path]:
    if paths:
        files: list[Path] = []
        for path in paths:
            resolved = path.expanduser().resolve()
            if resolved.is_dir():
                files.extend(sorted(resolved.rglob("*.jsonl")))
            else:
                files.append(resolved)
        return files
    return sorted(input_dir.rglob("*.jsonl"))


def rel(path: Path) -> str:
    return str(path.relative_to(ROOT)) if path.is_relative_to(ROOT) else str(path)


def validate_record(
    record: dict[str, Any],
    *,
    path: Path,
    line_no: int,
    stats: FileStats,
    id_locations: dict[str, list[tuple[Path, int]]],
    short_threshold: int,
    max_chars: int,
) -> list[Finding]:
    findings: list[Finding] = []

    for field_name in REQUIRED_FIELDS:
        if field_name not in record:
            findings.append(Finding("ERROR", path, line_no, f"missing required field: {field_name}"))

    record_id = record.get("id")
    if isinstance(record_id, str) and record_id.strip():
        id_locations[record_id].append((path, line_no))
    elif "id" in record:
        findings.append(Finding("ERROR", path, line_no, "id is empty or not a string"))

    text = record.get("text")
    if not isinstance(text, str):
        findings.append(Finding("ERROR", path, line_no, "text is not a string"))
        text_value = ""
    else:
        text_value = text.strip()

    actual_chars = count_chars(text_value)
    stats.char_counts.append(actual_chars)

    if actual_chars == 0:
        stats.empty_text += 1
        findings.append(Finding("ERROR", path, line_no, "text is empty"))
    elif actual_chars < short_threshold:
        stats.short_text += 1
        findings.append(Finding("WARN", path, line_no, f"text is short: {actual_chars} chars"))

    if actual_chars > max_chars:
        stats.too_large_text += 1
        findings.append(Finding("WARN", path, line_no, f"text is too large: {actual_chars} chars > {max_chars}"))

    declared_chars = record.get("char_count")
    if not isinstance(declared_chars, int):
        findings.append(Finding("ERROR", path, line_no, "char_count is not an integer"))
    elif declared_chars != actual_chars:
        findings.append(
            Finding(
                "ERROR",
                path,
                line_no,
                f"char_count mismatch: declared={declared_chars}, actual={actual_chars}",
            )
        )

    page_start = record.get("page_start")
    page_end = record.get("page_end")
    if not isinstance(page_start, int):
        findings.append(Finding("ERROR", path, line_no, "page_start is not an integer"))
    if not isinstance(page_end, int):
        findings.append(Finding("ERROR", path, line_no, "page_end is not an integer"))
    if isinstance(page_start, int) and isinstance(page_end, int):
        if page_start <= 0:
            findings.append(Finding("ERROR", path, line_no, "page_start must be positive"))
        if page_end <= 0:
            findings.append(Finding("ERROR", path, line_no, "page_end must be positive"))
        if page_start > page_end:
            findings.append(Finding("ERROR", path, line_no, f"page_start > page_end: {page_start} > {page_end}"))

    for field_name in ["source_file", "source_title"]:
        value = record.get(field_name)
        if not isinstance(value, str) or not value.strip():
            findings.append(Finding("ERROR", path, line_no, f"{field_name} is empty or not a string"))

    if is_missing(record.get("source_title")):
        stats.missing_source_title += 1
    if is_missing(record.get("section")):
        stats.missing_section += 1

    return findings


def validate_file(
    path: Path,
    *,
    id_locations: dict[str, list[tuple[Path, int]]],
    short_threshold: int,
    max_chars: int,
) -> tuple[FileStats, list[Finding]]:
    stats = FileStats(path=path)
    findings: list[Finding] = []

    with path.open("r", encoding="utf-8", errors="replace") as f:
        for line_no, line in enumerate(f, 1):
            stats.total_lines += 1
            stripped = line.strip()
            if not stripped:
                findings.append(Finding("WARN", path, line_no, "blank line"))
                continue
            try:
                value = json.loads(stripped)
            except json.JSONDecodeError as exc:
                stats.json_errors += 1
                findings.append(Finding("ERROR", path, line_no, f"invalid JSON: {exc.msg}"))
                continue
            if not isinstance(value, dict):
                findings.append(Finding("ERROR", path, line_no, "JSON value is not an object"))
                continue

            stats.valid_records += 1
            findings.extend(validate_record(
                value,
                path=path,
                line_no=line_no,
                stats=stats,
                id_locations=id_locations,
                short_threshold=short_threshold,
                max_chars=max_chars,
            ))

    return stats, findings


def duplicate_id_findings(id_locations: dict[str, list[tuple[Path, int]]]) -> list[Finding]:
    findings: list[Finding] = []
    for record_id, locations in sorted(id_locations.items()):
        if len(locations) <= 1:
            continue
        joined = ", ".join(f"{rel(path)}:{line}" for path, line in locations)
        for path, line in locations:
            findings.append(Finding("ERROR", path, line, f"duplicate id `{record_id}` also found at {joined}"))
    return findings


def format_findings(findings: list[Finding], *, limit: int) -> list[str]:
    if not findings:
        return ["- none"]

    lines: list[str] = []
    for finding in findings[:limit]:
        lines.append(f"- [{finding.level}] {rel(finding.file)}:{finding.line} - {finding.message}")
    if len(findings) > limit:
        lines.append(f"- ... +{len(findings) - limit} more")
    return lines


def build_report(
    *,
    files: list[Path],
    stats_by_file: list[FileStats],
    findings: list[Finding],
    args: argparse.Namespace,
) -> str:
    now = datetime.now(timezone.utc).isoformat()
    level_counts = Counter(finding.level for finding in findings)
    total_records = sum(stats.valid_records for stats in stats_by_file)
    total_lines = sum(stats.total_lines for stats in stats_by_file)
    all_chars = [count for stats in stats_by_file for count in stats.char_counts]
    missing_titles = sum(stats.missing_source_title for stats in stats_by_file)
    missing_sections = sum(stats.missing_section for stats in stats_by_file)

    lines = [
        "# Chunk Validation Report",
        "",
        f"- generated_at: {now}",
        f"- files: {len(files)}",
        f"- lines: {total_lines}",
        f"- valid_records: {total_records}",
        f"- errors: {level_counts.get('ERROR', 0)}",
        f"- warnings: {level_counts.get('WARN', 0)}",
        f"- short_threshold: {args.short_threshold}",
        f"- max_chars: {args.max_chars}",
        "",
    ]

    if all_chars:
        lines.extend([
            "## Character Counts",
            "",
            f"- min: {min(all_chars)}",
            f"- avg: {sum(all_chars) / len(all_chars):.1f}",
            f"- median: {statistics.median(all_chars):.1f}",
            f"- max: {max(all_chars)}",
            "",
        ])

    title_rate = missing_titles / total_records if total_records else 0.0
    section_rate = missing_sections / total_records if total_records else 0.0
    lines.extend([
        "## Metadata Coverage",
        "",
        f"- missing source_title: {missing_titles}/{total_records} ({title_rate:.1%})",
        f"- missing section: {missing_sections}/{total_records} ({section_rate:.1%})",
        "",
        "## Files",
        "",
    ])

    for stats in stats_by_file:
        lines.extend([
            f"### {rel(stats.path)}",
            "",
            f"- lines: {stats.total_lines}",
            f"- valid_records: {stats.valid_records}",
            f"- json_errors: {stats.json_errors}",
            f"- chars min/avg/median/max: {stats.min_chars}/{stats.avg_chars:.1f}/{stats.median_chars:.1f}/{stats.max_chars}",
            f"- empty_text: {stats.empty_text}",
            f"- short_text: {stats.short_text}",
            f"- too_large_text: {stats.too_large_text}",
            f"- missing source_title: {stats.missing_source_title} ({stats.rate(stats.missing_source_title):.1%})",
            f"- missing section: {stats.missing_section} ({stats.rate(stats.missing_section):.1%})",
            "",
        ])

    error_findings = [finding for finding in findings if finding.level == "ERROR"]
    warn_findings = [finding for finding in findings if finding.level == "WARN"]
    lines.extend([
        "## Errors",
        "",
        *format_findings(error_findings, limit=args.finding_limit),
        "",
        "## Warnings",
        "",
        *format_findings(warn_findings, limit=args.finding_limit),
        "",
    ])
    return "\n".join(lines).rstrip() + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate local chunk JSONL files before RAG ingestion."
    )
    parser.add_argument("paths", nargs="*", type=Path, help="Files or directories. Defaults to data/chunks.")
    parser.add_argument("--input-dir", type=Path, default=DEFAULT_INPUT_DIR)
    parser.add_argument("--report-dir", type=Path, default=DEFAULT_REPORT_DIR)
    parser.add_argument("--write-report", action="store_true", help="Write reports/chunk-validation-report.md")
    parser.add_argument("--report-name", default="chunk-validation-report.md")
    parser.add_argument("--short-threshold", type=int, default=200)
    parser.add_argument("--max-chars", type=int, default=1400)
    parser.add_argument("--finding-limit", type=int, default=80)
    args = parser.parse_args()

    args.input_dir = args.input_dir.expanduser().resolve()
    args.report_dir = args.report_dir.expanduser().resolve()
    files = iter_jsonl_files(args.paths, args.input_dir)
    if not files:
        print(f"No .jsonl files found in {args.input_dir}")
        return 0

    id_locations: dict[str, list[tuple[Path, int]]] = defaultdict(list)
    stats_by_file: list[FileStats] = []
    findings: list[Finding] = []
    for path in files:
        stats, file_findings = validate_file(
            path,
            id_locations=id_locations,
            short_threshold=args.short_threshold,
            max_chars=args.max_chars,
        )
        stats_by_file.append(stats)
        findings.extend(file_findings)

    findings.extend(duplicate_id_findings(id_locations))
    findings.sort(key=lambda finding: (0 if finding.level == "ERROR" else 1, rel(finding.file), finding.line, finding.message))

    report = build_report(files=files, stats_by_file=stats_by_file, findings=findings, args=args)
    print(report)

    if args.write_report:
        args.report_dir.mkdir(parents=True, exist_ok=True)
        report_path = args.report_dir / args.report_name
        report_path.write_text(report, encoding="utf-8")
        print(f"Wrote {rel(report_path)}")

    return 1 if any(finding.level == "ERROR" for finding in findings) else 0


if __name__ == "__main__":
    raise SystemExit(main())
