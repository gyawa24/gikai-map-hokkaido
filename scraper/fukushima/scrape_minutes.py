"""
福島町議会 議事録スクレイパー

取得元:
- 会議資料・映像: https://www.town.fukushima.hokkaido.jp/gikai/会議資料・映像/

実装方針:
- 会議資料ページの見出しから会期を拾う
- 各会期配下の「議事録」PDFリンクを取得する
- PDF本文を抽出して data/fukushima/minutes/ に保存する
"""

from __future__ import annotations

import argparse
import io
import json
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urljoin

import pdfplumber
import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).parent.parent.parent
DATA_DIR = ROOT / "data" / "fukushima" / "minutes"
INDEX_URL = "https://www.town.fukushima.hokkaido.jp/gikai/%E4%BC%9A%E8%AD%B0%E8%B3%87%E6%96%99%E3%83%BB%E6%98%A0%E5%83%8F/"
PAGE_ID = "72"
KIND_OF_CONFERENCE = "17"
DEFAULT_YEARS = {"2024", "2025"}
REQUEST_INTERVAL = 0.8

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

HEADING_RE = re.compile(
    r"(?P<label>.+?)\((?P<year>20\d{2})[./年](?P<month>\d{1,2})[./月](?P<day>\d{1,2})日?\)"
)


@dataclass
class SchedulePdf:
    name: str
    url: str


@dataclass
class Meeting:
    label: str
    year: int
    month: int
    day: int
    type_name: str
    pdfs: list[SchedulePdf] = field(default_factory=list)

    @property
    def council_id(self) -> int:
        type_flag = 10 if self.type_name == "定例会" else 20
        return int(f"{self.year}{type_flag:02d}{self.month:02d}{self.day:02d}")

    @property
    def council_name(self) -> str:
        return f"{self.label} ({self.year}-{self.month:02d}-{self.day:02d})"

    @property
    def japanese_year(self) -> str:
        return f"令和{self.year - 2018}年"

    @property
    def type_label(self) -> str:
        return f"全会議 > 本会議 > {self.type_name}"


def normalize_text(text: str) -> str:
    return re.sub(r"[\u3000\s]+", "", text or "")


def clean_pdf_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = [line.rstrip() for line in text.splitlines()]
    cleaned: list[str] = []
    prev_empty = False
    for line in lines:
        if line.strip():
            cleaned.append(line)
            prev_empty = False
        elif not prev_empty:
            cleaned.append("")
            prev_empty = True
    return "\n".join(cleaned).strip()


def fetch_html(url: str, params: dict[str, str] | None = None) -> BeautifulSoup:
    response = requests.get(url, headers=HEADERS, params=params, timeout=30)
    response.raise_for_status()
    response.encoding = response.apparent_encoding
    return BeautifulSoup(response.text, "html.parser")


def extract_meetings(target_years: set[str]) -> list[Meeting]:
    meetings: list[Meeting] = []
    for fiscal_year in sorted(target_years):
        soup = fetch_html(
            INDEX_URL,
            params={
                "page_id": PAGE_ID,
                "year_of_conferenceMaterial": fiscal_year,
                "kind_of_conferenceMaterial": KIND_OF_CONFERENCE,
            },
        )
        content = soup.select_one("#conferenceMaterial-content")
        if content is None:
            continue

        for heading in content.find_all("p"):
            text = heading.get_text(" ", strip=True)
            match = HEADING_RE.search(text)
            if not match:
                continue

            label = match.group("label").strip()
            normalized = normalize_text(label)
            if "定例会" not in normalized and "臨時会" not in normalized:
                continue

            table = heading.find_next_sibling("table")
            if table is None or "council" not in (table.get("class") or []):
                continue

            pdf_links: list[SchedulePdf] = []
            for anchor in table.find_all("a", href=True):
                href = anchor["href"].strip()
                link_text = anchor.get_text(" ", strip=True)
                if ".pdf" not in href.lower():
                    continue
                if "議事録" not in normalize_text(link_text):
                    continue
                pdf_links.append(
                    SchedulePdf(
                        name=label,
                        url=urljoin(INDEX_URL, href),
                    )
                )

            if not pdf_links:
                continue

            meetings.append(
                Meeting(
                    label=label,
                    year=int(match.group("year")),
                    month=int(match.group("month")),
                    day=int(match.group("day")),
                    type_name="臨時会" if "臨時会" in normalized else "定例会",
                    pdfs=pdf_links,
                )
            )

    seen_ids: set[int] = set()
    unique_meetings: list[Meeting] = []
    for meeting in meetings:
        if not meeting.pdfs:
            continue
        if meeting.council_id in seen_ids:
            continue
        seen_ids.add(meeting.council_id)
        unique_meetings.append(meeting)
    return unique_meetings


def extract_pdf_text(url: str) -> str:
    response = requests.get(url, headers=HEADERS, timeout=60)
    response.raise_for_status()

    parts: list[str] = []
    with pdfplumber.open(io.BytesIO(response.content)) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            if text.strip():
                parts.append(text)
    return clean_pdf_text("\n\n".join(parts))


def scrape(target_years: set[str], force: bool = False) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    meetings = [m for m in extract_meetings(target_years) if str(m.year) in target_years]
    meetings.sort(key=lambda item: (item.year, item.month, item.day, item.type_name))

    index: list[dict] = []
    for i, meeting in enumerate(meetings, start=1):
        out_path = DATA_DIR / f"{meeting.council_id}.json"
        print(f"[{i}/{len(meetings)}] {meeting.council_name}")

        if out_path.exists() and not force:
            print("  skip existing")
            index.append(
                {
                    "council_id": meeting.council_id,
                    "name": meeting.council_name,
                    "year": str(meeting.year),
                    "japanese_year": meeting.japanese_year,
                    "type_label": meeting.type_label,
                    "file": out_path.name,
                    "schedule_count": len(meeting.pdfs),
                }
            )
            continue

        schedules = []
        for schedule_id, pdf in enumerate(meeting.pdfs, start=1):
            print(f"  pdf {schedule_id}/{len(meeting.pdfs)}: {pdf.name}")
            text = extract_pdf_text(pdf.url)
            schedules.append(
                {
                    "schedule_id": schedule_id,
                    "name": pdf.name,
                    "page_no": schedule_id,
                    "minutes": [
                        {
                            "minute_id": 1,
                            "title": pdf.name,
                            "minute_type": "本会議",
                            "text": text,
                            "source_url": pdf.url,
                        }
                    ],
                }
            )
            time.sleep(REQUEST_INTERVAL)

        council = {
            "council_id": meeting.council_id,
            "name": meeting.council_name,
            "year": str(meeting.year),
            "japanese_year": meeting.japanese_year,
            "type_label": meeting.type_label,
            "schedules": schedules,
        }
        out_path.write_text(json.dumps(council, ensure_ascii=False, indent=2), encoding="utf-8")
        index.append(
            {
                "council_id": meeting.council_id,
                "name": meeting.council_name,
                "year": str(meeting.year),
                "japanese_year": meeting.japanese_year,
                "type_label": meeting.type_label,
                "file": out_path.name,
                "schedule_count": len(meeting.pdfs),
            }
        )

    (DATA_DIR / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"saved {len(index)} councils -> {DATA_DIR}")


def main() -> None:
    parser = argparse.ArgumentParser(description="福島町議会 議事録スクレイパー")
    parser.add_argument("--years", default="2024,2025", help="対象年度（カンマ区切り）")
    parser.add_argument("--force", action="store_true", help="既存ファイルを上書き")
    args = parser.parse_args()

    target_years = {year.strip() for year in args.years.split(",") if year.strip()}
    if not target_years:
        target_years = DEFAULT_YEARS

    scrape(target_years=target_years, force=args.force)


if __name__ == "__main__":
    main()
