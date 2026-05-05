#!/usr/bin/env python3
"""
新ひだか町議会 議事録スクレイパー

取得元:
- 会議録一覧: https://www.shinhidaka-hokkaido.jp/gikai/detail/00000185.html

実装方針:
- 令和7年系は日別PDFリンクを会期単位に束ねる
- 令和6年系は frameset 型 HTML 会議録を日別HTMLごとに取得する
- 取得結果を data/shinhidaka/minutes/ に DNP互換スキーマで保存する
"""

from __future__ import annotations

import argparse
import io
import json
import re
import time
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urljoin

import pdfplumber
import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).parent.parent.parent
DATA_DIR = ROOT / "data" / "shinhidaka" / "minutes"
INDEX_URL = "https://www.shinhidaka-hokkaido.jp/gikai/detail/00000185.html"
DEFAULT_YEARS = {"2024", "2025"}
REQUEST_INTERVAL = 0.4

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

FULLWIDTH_DIGITS = str.maketrans("０１２３４５６７８９　", "0123456789 ")
DATE_RE = re.compile(r"令和\s*([0-9]+)年\s*([0-9]+)月\s*([0-9]+)日")


@dataclass
class Schedule:
    name: str
    url: str
    text: str
    year: int
    month: int
    day: int


@dataclass
class Meeting:
    label: str
    year: int
    month: int
    day: int
    type_name: str
    source_url: str
    schedules: list[Schedule]

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


def zen_to_half(text: str) -> str:
    return (text or "").translate(FULLWIDTH_DIGITS)


def normalize_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def clean_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = [line.rstrip() for line in text.splitlines()]
    cleaned: list[str] = []
    prev_empty = False
    for line in lines:
        if re.fullmatch(r"\s*[－-]\s*\d+\s*[－-]\s*", line):
            continue
        if line.strip():
            cleaned.append(line)
            prev_empty = False
        elif not prev_empty:
            cleaned.append("")
            prev_empty = True
    return "\n".join(cleaned).strip()


def decode_html(content: bytes) -> str:
    for encoding in ("cp932", "shift_jis", "utf-8"):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    return content.decode("utf-8", errors="ignore")


def fetch_html(url: str) -> str:
    response = requests.get(url, headers=HEADERS, timeout=60)
    response.raise_for_status()
    return decode_html(response.content)


def extract_actual_date(text: str) -> tuple[int, int, int]:
    match = DATE_RE.search(zen_to_half(text))
    if not match:
        raise ValueError("会議本文から開催日を抽出できませんでした")
    reiwa_year, month, day = (int(match.group(i)) for i in range(1, 4))
    return 2018 + reiwa_year, month, day


def extract_date_from_labels(year: int, meeting_label: str, schedule_name: str) -> tuple[int, int, int]:
    normalized_meeting = zen_to_half(meeting_label)
    normalized_schedule = zen_to_half(schedule_name)
    exact = re.search(r"(\d+)月\s*(\d+)日", normalized_schedule)
    if exact:
        return year, int(exact.group(1)), int(exact.group(2))

    month_match = re.search(r"(\d+)月", normalized_meeting)
    day_matches = re.findall(r"(\d+)日", normalized_schedule)
    if not month_match or not day_matches:
        raise ValueError("一覧ラベルから開催日を補完できませんでした")
    return year, int(month_match.group(1)), int(day_matches[-1])


def collect_section_nodes(soup: BeautifulSoup, target_years: set[int]) -> list[tuple[int, list[tuple[str, str]]]]:
    sections: list[tuple[int, list[tuple[str, str]]]] = []
    for heading in soup.find_all("h2"):
        heading_text = normalize_whitespace(zen_to_half(heading.get_text(" ", strip=True)))
        year_match = re.search(r"令和(\d+)年", heading_text)
        if not year_match:
            continue
        year = 2018 + int(year_match.group(1))
        if year not in target_years:
            continue

        links: list[tuple[str, str]] = []
        node = heading.find_next_sibling()
        while node is not None and getattr(node, "name", None) != "h2":
            anchors = []
            if getattr(node, "name", None) == "a" and node.get("href"):
                anchors.append(node)
            if hasattr(node, "find_all"):
                anchors.extend(node.find_all("a", href=True))
            for anchor in anchors:
                text = normalize_whitespace(zen_to_half(anchor.get_text(" ", strip=True)))
                href = anchor["href"].strip()
                full_url = urljoin(INDEX_URL, href)
                if not text:
                    continue
                if full_url.lower().endswith(".pdf") or "/gikai/kaigiroku/" in full_url:
                    links.append((text, full_url))
            node = node.find_next_sibling()
        sections.append((year, links))
    return sections


def extract_pdf_text(url: str) -> str:
    response = requests.get(url, headers=HEADERS, timeout=60)
    response.raise_for_status()
    parts: list[str] = []
    with pdfplumber.open(io.BytesIO(response.content)) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            if text.strip():
                parts.append(text)
    return clean_text("\n\n".join(parts))


def split_pdf_groups(links: list[tuple[str, str]]) -> list[tuple[str, list[tuple[str, str]]]]:
    groups: OrderedDict[str, list[tuple[str, str]]] = OrderedDict()
    for raw_text, url in links:
        text = raw_text.replace("【未定稿】", "").strip()
        meeting_match = re.match(r"(?P<label>.+?会（第\d+回）)(?P<rest>.*)", text)
        if meeting_match:
            label = meeting_match.group("label").strip()
            schedule = meeting_match.group("rest").replace("◆", " ").strip()
        else:
            label = text
            schedule = text
        groups.setdefault(label, []).append((schedule or text, url))
    return list(groups.items())


def scrape_pdf_meeting(year_hint: int, label: str, items: list[tuple[str, str]]) -> Meeting:
    schedules: list[Schedule] = []
    for schedule_name, url in items:
        text = extract_pdf_text(url)
        year, month, day = extract_date_from_labels(year_hint, label, schedule_name)
        fallback_name = f"{month}月{day}日"
        schedules.append(
            Schedule(
                name=schedule_name or fallback_name,
                url=url,
                text=text,
                year=year,
                month=month,
                day=day,
            )
        )
        time.sleep(REQUEST_INTERVAL)

    schedules.sort(key=lambda item: (item.year, item.month, item.day, item.name))
    first = schedules[0]
    type_name = "臨時会" if "臨時会" in label else "定例会"
    return Meeting(
        label=label,
        year=first.year,
        month=first.month,
        day=first.day,
        type_name=type_name,
        source_url=schedules[0].url,
        schedules=schedules,
    )


def parse_html_day_pages(frameset_url: str) -> list[tuple[str, str]]:
    frameset_html = fetch_html(frameset_url)
    soup = BeautifulSoup(frameset_html, "html.parser")
    index_frame = soup.find("frame", attrs={"name": "index"})
    if index_frame is None or not index_frame.get("src"):
        return [("本文", frameset_url)]

    index_url = urljoin(frameset_url, index_frame["src"])
    index_html = fetch_html(index_url)
    index_soup = BeautifulSoup(index_html, "html.parser")

    schedules: list[tuple[str, str]] = []
    seen = set()
    for anchor in index_soup.find_all("a", href=True):
        href = anchor["href"].strip()
        if "#" in href or not href.lower().endswith(".html"):
            continue
        label = normalize_whitespace(zen_to_half(anchor.get_text(" ", strip=True)))
        if not re.match(r"^\d+号", label):
            continue
        full_url = urljoin(index_url, href)
        if full_url in seen:
            continue
        seen.add(full_url)
        schedules.append((label, full_url))
    return schedules or [("本文", frameset_url)]


def extract_html_text(url: str) -> str:
    soup = BeautifulSoup(fetch_html(url), "html.parser")
    pre_blocks = soup.find_all("pre")
    if pre_blocks:
        body = max((block.get_text("\n") for block in pre_blocks), key=len)
    else:
        body = soup.get_text("\n")
    return clean_text(body)


def scrape_html_meeting(year_hint: int, label: str, url: str) -> Meeting:
    schedules: list[Schedule] = []
    for schedule_name, schedule_url in parse_html_day_pages(url):
        text = extract_html_text(schedule_url)
        year, month, day = extract_date_from_labels(year_hint, label, schedule_name)
        schedules.append(
            Schedule(
                name=schedule_name,
                url=schedule_url,
                text=text,
                year=year,
                month=month,
                day=day,
            )
        )
        time.sleep(REQUEST_INTERVAL)

    schedules.sort(key=lambda item: (item.year, item.month, item.day, item.name))
    first = schedules[0]
    type_name = "臨時会" if "臨時会" in label else "定例会"
    return Meeting(
        label=label,
        year=first.year,
        month=first.month,
        day=first.day,
        type_name=type_name,
        source_url=url,
        schedules=schedules,
    )


def scrape(target_years: set[int], force: bool = False) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    soup = BeautifulSoup(fetch_html(INDEX_URL), "html.parser")
    sections = collect_section_nodes(soup, target_years)

    meetings: list[Meeting] = []
    for section_year, links in sections:
        pdf_links = [(text, url) for text, url in links if url.lower().endswith(".pdf")]
        html_links = [(text, url) for text, url in links if not url.lower().endswith(".pdf")]

        for label, items in split_pdf_groups(pdf_links):
            meetings.append(scrape_pdf_meeting(section_year, label, items))

        for label, url in html_links:
            meetings.append(scrape_html_meeting(section_year, label, url))

    unique: dict[int, Meeting] = {}
    for meeting in meetings:
        if meeting.year not in target_years:
            continue
        unique[meeting.council_id] = meeting
    sorted_meetings = sorted(unique.values(), key=lambda item: (item.year, item.month, item.day, item.type_name))

    index: list[dict] = []
    for i, meeting in enumerate(sorted_meetings, start=1):
        out_path = DATA_DIR / f"{meeting.council_id}.json"
        print(f"[{i}/{len(sorted_meetings)}] {meeting.council_name}")

        if out_path.exists() and not force:
            print("  skip existing")
        else:
            schedules = []
            for schedule_id, schedule in enumerate(meeting.schedules, start=1):
                schedules.append(
                    {
                        "schedule_id": schedule_id,
                        "name": schedule.name,
                        "page_no": schedule_id,
                        "minutes": [
                            {
                                "minute_id": 1,
                                "title": schedule.name,
                                "minute_type": "本会議",
                                "text": schedule.text,
                                "source_url": schedule.url,
                            }
                        ],
                    }
                )

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
                "schedule_count": len(meeting.schedules),
            }
        )

    (DATA_DIR / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"saved {len(index)} meetings -> {DATA_DIR}")


def main() -> None:
    parser = argparse.ArgumentParser(description="新ひだか町議会 会議録スクレイパー")
    parser.add_argument("--years", default=",".join(sorted(DEFAULT_YEARS)), help="対象年度（カンマ区切り）")
    parser.add_argument("--force", action="store_true", help="既存ファイルを上書き")
    args = parser.parse_args()

    target_years = {int(year.strip()) for year in args.years.split(",") if year.strip()}
    scrape(target_years, force=args.force)


if __name__ == "__main__":
    main()
