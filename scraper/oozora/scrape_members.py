"""
大空町議会 議員名簿スクレイパー
出力: data/oozora/members.json
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.ozora.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/machinoshirase/chogikai/2208.html"

ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = ROOT / "data" / "oozora"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
SITE_DIR = ROOT / "site" / "data" / "oozora"
SITE_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = ROOT / "site" / "public" / "members" / "oozora"
PHOTO_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def fetch(url: str) -> BeautifulSoup | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def absolutize(src: str) -> str:
    if src.startswith("http"):
        return src
    if src.startswith("//"):
        return "https:" + src
    if src.startswith("/"):
        return BASE_URL + src
    return BASE_URL + "/" + src


def parse_seat(caption: str) -> int | None:
    m = re.search(r"議席番号\s*(\d+)\s*番", caption)
    return int(m.group(1)) if m else None


def parse_role(caption: str) -> str:
    # 「議長（議席番号12番）の詳細」→「議長」、「議席番号1番の詳細」→""
    m = re.match(r"^(.+?)（議席番号", caption)
    return m.group(1).strip() if m else ""


def split_committees(text: str) -> list[str]:
    if not text:
        return []
    parts = re.split(r"[\s、,　]+", text.strip())
    return [p for p in parts if p]


def download_photo(url: str, seat: int) -> str:
    ext = url.split(".")[-1].split("?")[0].lower()
    if ext not in ("jpg", "jpeg", "png", "gif", "webp"):
        ext = "jpg"
    fname = f"seat_{seat}.{ext}"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(resp.content)
        return f"/members/oozora/{fname}"
    except Exception as e:
        print(f"  [WARN] photo download failed: {url} -> {e}")
        return ""


def scrape() -> list[dict]:
    print("大空町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        return []

    members: list[dict] = []
    for table in soup.find_all("table"):
        cap_el = table.find("caption")
        if not cap_el:
            continue
        caption = cap_el.get_text(strip=True)
        seat = parse_seat(caption)
        if seat is None:
            continue
        role = parse_role(caption)

        data: dict[str, str] = {}
        for row in table.find_all("tr"):
            th = row.find("th")
            td = row.find("td")
            if th and td:
                data[th.get_text(strip=True)] = td.get_text(" ", strip=True)

        name = data.get("氏名", "").strip()
        if not name:
            continue

        party = data.get("所属党派等", "").strip()
        committees = split_committees(data.get("所属委員会等", ""))
        if role and role not in committees:
            committees = [role] + committees

        img = table.find_previous("img")
        photo_url = ""
        if img and img.get("src"):
            photo_url = download_photo(absolutize(img["src"]), seat)
            time.sleep(0.3)

        members.append(
            {
                "seat_number": seat,
                "name": name,
                "furigana": "",
                "party": party,
                "faction": party,
                "committees": committees,
                "photo_url": photo_url,
            }
        )
        print(f"  議席{seat} {name} / {party} / 委員会{len(committees)}件")

    members.sort(key=lambda m: m["seat_number"])
    return members


def main():
    members = scrape()
    if not members:
        print("取得不可: 議員データが空")
        return

    for target in (OUTPUT_DIR / "members.json", SITE_DIR / "members.json"):
        target.write_text(
            json.dumps(members, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"  書き出し: {target}")

    print(f"取得議員数: {len(members)}名")


if __name__ == "__main__":
    main()
