"""
歌志内市議会 議員名簿スクレイパー
出力: data/utashinai/members.json
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.city.utashinai.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/hotnews/detail/00003807.html"

ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = ROOT / "data" / "utashinai"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
SITE_OUTPUT_DIR = ROOT / "site" / "data" / "utashinai"
SITE_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = ROOT / "site" / "public" / "members" / "utashinai"
PHOTO_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def strip_ideographic_space(s: str) -> str:
    # 全角スペース（U+3000）と半角スペースを除去
    return re.sub(r"[\s\u3000]+", "", s or "")


def fetch(url: str) -> BeautifulSoup | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def download_photo(remote_url: str, seat: int) -> str:
    ext = remote_url.split(".")[-1].split("?")[0].lower() or "jpg"
    if ext not in {"jpg", "jpeg", "png", "gif"}:
        ext = "jpg"
    fname = f"seat_{seat}.{ext}"
    try:
        resp = requests.get(remote_url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(resp.content)
        return f"/members/utashinai/{fname}"
    except Exception as e:
        print(f"    [IMG ERROR] {remote_url} -> {e}")
        return ""


def parse_name_cell(cell) -> tuple[str, str]:
    """名前セルは <br> で furigana と漢字名を分ける。"""
    parts = [t for t in cell.stripped_strings]
    furigana = strip_ideographic_space(parts[0]) if len(parts) >= 1 else ""
    name = strip_ideographic_space(parts[1]) if len(parts) >= 2 else ""
    if not name and furigana:
        name = furigana
        furigana = ""
    return name, furigana


def parse_roles_cell(cell) -> list[str]:
    """議会での役職セル。<br>区切りで複数項目が入る。"""
    items: list[str] = []
    for t in cell.stripped_strings:
        t = t.strip()
        if t:
            items.append(t)
    return items


def scrape_members():
    print("歌志内市議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return

    table = soup.find("table")
    if table is None:
        print("  テーブルが見つかりません")
        return

    rows = table.find_all("tr")
    members: list[dict] = []

    # ヘッダ2行を除き、以降は「基本情報行(rowspan=2)+生年月日行」の2行ペアで1議員。
    i = 2
    while i < len(rows):
        base = rows[i]
        cells = base.find_all("td")
        if len(cells) < 6:
            i += 1
            continue

        seat_text = cells[0].get_text(strip=True)
        try:
            seat_number = int(seat_text)
        except ValueError:
            i += 1
            continue

        img = cells[1].find("img")
        photo_url = ""
        if img and img.get("src"):
            src = img["src"]
            remote_url = src if src.startswith("http") else BASE_URL + src
            photo_url = download_photo(remote_url, seat_number)
            time.sleep(0.3)

        name, furigana = parse_name_cell(cells[2])
        party = cells[3].get_text(strip=True)
        roles = parse_roles_cell(cells[4])

        member = {
            "seat_number": seat_number,
            "name": name,
            "furigana": furigana,
            "party": party,
            "faction": "",
            "committees": roles,
            "photo_url": photo_url,
        }
        print(f"  [{seat_number}] {name} ({furigana}) / {party}")
        members.append(member)

        # 次の基本情報行は2行先
        i += 2

    if not members:
        print("  議員データが抽出できませんでした")
        return

    members.sort(key=lambda m: m["seat_number"])
    payload = {
        "source_url": MEMBERS_URL,
        "members": members,
    }

    for out in (OUTPUT_DIR, SITE_OUTPUT_DIR):
        (out / "members.json").write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    print(f"取得議員数: {len(members)}名")


if __name__ == "__main__":
    scrape_members()
