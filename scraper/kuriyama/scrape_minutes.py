#!/usr/bin/env python3
"""
栗山町議会 議事録スクレイパー

取得元:
- 会議録一覧: https://www.town.kuriyama.hokkaido.jp/site/gikai/7389.html

実装方針:
- 一覧ページから対象年度に関係する会議リンクを抽出する
- 定例会の HTML 会議録は frameset -> 目次 -> 日別本文を辿って minutes 形式へ変換する
- 臨時会の PDF 会議録は本文を抽出して minutes 形式へ変換する
"""

from __future__ import annotations

import argparse
import io
import json
import re
import tempfile
import time
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from urllib.parse import urljoin

import pdfplumber
import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).parent.parent.parent
DATA_DIR = ROOT / "data" / "kuriyama" / "minutes"
INDEX_URL = "https://www.town.kuriyama.hokkaido.jp/site/gikai/7389.html"


def default_target_years(today: date | None = None) -> set[str]:
    current_year = (today or date.today()).year
    return {str(year) for year in range(current_year - 2, current_year + 1)}


DEFAULT_YEARS = default_target_years()
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


@dataclass
class Meeting:
    label: str
    source_url: str
    year: int
    month: int
    day: int
    type_name: str
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
        if re.fullmatch(r"\s*-\s*\d+\s*-\s*", line):
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


def fetch_text(url: str, *, html: bool = True) -> str:
    response = requests.get(url, headers=HEADERS, timeout=60)
    response.raise_for_status()
    if html:
        return decode_html(response.content)
    response.encoding = response.apparent_encoding or "utf-8"
    return response.text


def extract_actual_date(text: str) -> tuple[int, int, int]:
    normalized = zen_to_half(text)
    match = DATE_RE.search(normalized)
    if not match:
        raise ValueError("会議本文から開催日を抽出できませんでした")
    reiwa_year, month, day = (int(match.group(i)) for i in range(1, 4))
    return 2018 + reiwa_year, month, day


def extract_links(target_years: set[int]) -> list[dict]:
    soup = BeautifulSoup(fetch_text(INDEX_URL, html=False), "html.parser")
    links: list[dict] = []
    seen_urls: set[str] = set()

    for heading in soup.find_all("h3"):
        heading_text = normalize_whitespace(zen_to_half(heading.get_text(" ", strip=True)))
        year_match = re.search(r"令和(\d+)年", heading_text)
        if not year_match:
            continue

        heading_year = 2018 + int(year_match.group(1))
        relevant_years = {heading_year}
        if "定例会" in heading_text:
            relevant_years.add(heading_year + 1)
        if not (relevant_years & target_years):
            continue

        node = heading.find_next_sibling()
        while node is not None and getattr(node, "name", None) != "h3":
            anchors = node.find_all("a", href=True) if hasattr(node, "find_all") else []
            for anchor in anchors:
                label = normalize_whitespace(zen_to_half(anchor.get_text(" ", strip=True)))
                href = anchor["href"].strip()
                full_url = urljoin(INDEX_URL, href)
                if not label or "会議" not in label:
                    continue
                if not (
                    full_url.lower().endswith(".pdf")
                    or "/gikai/minutes/kaigiroku/" in full_url
                ):
                    continue
                if full_url in seen_urls:
                    continue
                seen_urls.add(full_url)
                links.append(
                    {
                        "heading": heading_text,
                        "label": label,
                        "url": full_url,
                    }
                )
            node = node.find_next_sibling()

    return links


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


def write_json_atomic(path: Path, data: object) -> None:
    """同じディレクトリに書き切ってから置換し、途中書きの公開を防ぐ。"""
    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as temp_file:
            temp_path = Path(temp_file.name)
            temp_file.write(json.dumps(data, ensure_ascii=False, indent=2))
        temp_path.replace(path)
    finally:
        if temp_path is not None and temp_path.exists():
            temp_path.unlink()


def load_existing_index(index_path: Path) -> tuple[list[int], dict[int, dict]]:
    """既存indexはfail-closedで検証し、順序と未対象年をそのまま保持する。"""
    if not index_path.exists():
        return [], {}

    existing = json.loads(index_path.read_text(encoding="utf-8"))
    if not isinstance(existing, list):
        raise ValueError("index.json のルートが配列ではありません")

    order: list[int] = []
    index_map: dict[int, dict] = {}
    for position, entry in enumerate(existing):
        if not isinstance(entry, dict) or "council_id" not in entry:
            raise ValueError(f"index.json[{position}] に council_id がありません")
        council_id = entry["council_id"]
        if not isinstance(council_id, int) or isinstance(council_id, bool):
            raise ValueError(f"index.json[{position}] の council_id が整数ではありません")
        if council_id in index_map:
            raise ValueError(f"index.json に council_id={council_id} が重複しています")
        order.append(council_id)
        index_map[council_id] = entry
    return order, index_map


def parse_html_day_pages(frameset_url: str) -> list[tuple[str, str]]:
    frameset_html = fetch_text(frameset_url)
    soup = BeautifulSoup(frameset_html, "html.parser")

    index_frame = soup.find("frame", attrs={"name": "index"})
    if index_frame is None or not index_frame.get("src"):
        return [("本文", frameset_url)]

    index_url = urljoin(frameset_url, index_frame["src"])
    index_html = fetch_text(index_url)
    index_soup = BeautifulSoup(index_html, "html.parser")

    schedule_entries: list[tuple[str, str]] = []
    seen = set()
    for anchor in index_soup.find_all("a", href=True):
        href = anchor["href"].strip()
        if "#" in href or not href.lower().endswith(".html"):
            continue
        label = normalize_whitespace(zen_to_half(anchor.get_text(" ", strip=True)))
        if not label.startswith("第"):
            continue
        full_url = urljoin(index_url, href)
        if full_url in seen:
            continue
        seen.add(full_url)
        schedule_entries.append((label, full_url))

    return schedule_entries or [("本文", frameset_url)]


def extract_html_minutes(url: str) -> str:
    html = fetch_text(url)
    soup = BeautifulSoup(html, "html.parser")
    pre = soup.find("pre")
    body_text = pre.get_text() if pre else soup.get_text("\n")
    return clean_text(body_text)


def scrape_pdf_meeting(label: str, url: str) -> Meeting:
    text = extract_pdf_text(url)
    if not text.strip():
        raise ValueError("PDF会議録本文が空です")
    year, month, day = extract_actual_date(text)
    type_name = "臨時会" if "臨時会" in text else "定例会"
    schedule = Schedule(name=label, url=url, text=text)
    return Meeting(
        label=label,
        source_url=url,
        year=year,
        month=month,
        day=day,
        type_name=type_name,
        schedules=[schedule],
    )


def scrape_html_meeting(label: str, url: str) -> Meeting:
    schedule_pages = parse_html_day_pages(url)
    schedules: list[Schedule] = []
    first_text = ""
    for schedule_name, schedule_url in schedule_pages:
        text = extract_html_minutes(schedule_url)
        if not text.strip():
            raise ValueError(f"HTML会議録本文が空です: {schedule_url}")
        if not first_text:
            first_text = text
        schedules.append(Schedule(name=schedule_name, url=schedule_url, text=text))
        time.sleep(REQUEST_INTERVAL)

    if not first_text:
        raise ValueError(f"HTML会議録本文を取得できませんでした: {url}")

    year, month, day = extract_actual_date(first_text)
    type_name = "臨時会" if "臨時会" in first_text else "定例会"
    return Meeting(
        label=label,
        source_url=url,
        year=year,
        month=month,
        day=day,
        type_name=type_name,
        schedules=schedules,
    )


def scrape(target_years: set[int], force: bool = False) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    index_path = DATA_DIR / "index.json"
    try:
        index_order, index_map = load_existing_index(index_path)
    except Exception as exc:
        raise ValueError(f"index.json を安全に読めないため更新中止: {exc}") from exc

    source_links = extract_links(target_years)
    meetings: list[Meeting] = []
    for item in source_links:
        url = item["url"]
        label = item["label"]
        try:
            meeting = scrape_pdf_meeting(label, url) if url.lower().endswith(".pdf") else scrape_html_meeting(label, url)
        except Exception as exc:
            print(f"skip {label}: {exc}")
            continue

        if meeting.year not in target_years:
            continue
        meetings.append(meeting)
        time.sleep(REQUEST_INTERVAL)

    unique: dict[int, Meeting] = {}
    for meeting in meetings:
        unique[meeting.council_id] = meeting
    sorted_meetings = sorted(unique.values(), key=lambda item: (item.year, item.month, item.day, item.type_name))

    for i, meeting in enumerate(sorted_meetings, start=1):
        out_path = DATA_DIR / f"{meeting.council_id}.json"
        print(f"[{i}/{len(sorted_meetings)}] {meeting.council_name}")

        if out_path.exists() and not force:
            if meeting.council_id in index_map:
                print("  skip existing")
            else:
                print("  keep unpublished orphan (indexにない既存ファイルのため更新保留)")
            continue
        else:
            schedules = []
            for schedule_id, schedule in enumerate(meeting.schedules, start=1):
                if not schedule.text.strip():
                    raise ValueError(
                        f"{meeting.council_name} の全日程を取得できないため更新中止: {schedule.url}"
                    )
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
            write_json_atomic(out_path, council)

        if meeting.council_id not in index_map:
            index_order.append(meeting.council_id)
        index_map[meeting.council_id] = {
            **index_map.get(meeting.council_id, {}),
            "council_id": meeting.council_id,
            "name": meeting.council_name,
            "year": str(meeting.year),
            "japanese_year": meeting.japanese_year,
            "type_label": meeting.type_label,
            "file": out_path.name,
            "schedule_count": len(meeting.schedules),
        }

    index = sorted(
        (index_map[council_id] for council_id in index_order),
        key=lambda entry: (
            str(entry.get("year", "")),
            int(entry["council_id"]) % 10000,
            int(entry["council_id"]),
        ),
        reverse=True,
    )
    if index or index_path.exists():
        write_json_atomic(index_path, index)
    print(f"saved {len(index)} meetings -> {DATA_DIR}")


def main() -> None:
    parser = argparse.ArgumentParser(description="栗山町議会 会議録スクレイパー")
    parser.add_argument("--years", default=",".join(sorted(DEFAULT_YEARS)), help="対象年度（カンマ区切り）")
    parser.add_argument("--force", action="store_true", help="既存ファイルを上書き")
    args = parser.parse_args()

    target_years = {
        int(year.strip())
        for year in args.years.split(",")
        if year.strip()
    }
    scrape(target_years, force=args.force)


if __name__ == "__main__":
    main()
