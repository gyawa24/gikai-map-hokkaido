"""
東神楽町議会 議員名簿スクレイパー
出力: site/data/higashikagura/members.json
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.higashikagura.lg.jp"
MEMBERS_URL = f"{BASE_URL}/docs/373.html"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "site" / "data" / "higashikagura"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = Path(__file__).parent.parent.parent / "site" / "public" / "members" / "higashikagura"
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


def download_photo(src: str, seat_number: int) -> str:
    """写真をダウンロードして保存。成功したらローカルパスを返す。"""
    url = src if src.startswith("http") else BASE_URL + src
    ext = src.split(".")[-1].split("?")[0] or "jpg"
    fname = f"seat_{seat_number}.{ext}"
    dest = PHOTO_DIR / fname
    try:
        resp = requests.get(url, headers=HEADERS, timeout=10)
        resp.raise_for_status()
        dest.write_bytes(resp.content)
        return f"/members/higashikagura/{fname}"
    except Exception as e:
        print(f"  [WARN] 写真取得失敗 seat={seat_number}: {e}")
        return ""


def scrape_members():
    print("東神楽町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return

    members = []

    # テーブル行を走査（列構成: 議席番号, 写真, 氏名, 住所, 電話, 当選回数, 所属党派）
    rows = soup.select("table tr")
    print(f"  テーブル行数: {len(rows)}")

    for row in rows:
        cells = row.find_all(["td", "th"])
        if len(cells) < 7:
            continue

        seat_text = cells[0].get_text(strip=True)
        if not re.match(r"^\d+$", seat_text):
            continue

        seat_number = int(seat_text)

        # 氏名とふりがな（3列目）
        name_cell = cells[2]
        name_texts = list(name_cell.stripped_strings)
        name = ""
        furigana = ""
        for t in name_texts:
            if re.search(r"[ぁ-ん]", t):
                furigana = t.strip()
            elif re.search(r"[^\s]", t):
                name = t.strip()

        if not name:
            continue

        # 所属党派（7列目）
        party_text = cells[6].get_text(strip=True)
        # 空白・なし系の表現を統一
        party = party_text if party_text and party_text not in ("－", "-", "　", "") else ""

        # 写真（2列目）
        photo_url = ""
        img = cells[1].find("img")
        if img and img.get("src"):
            photo_url = download_photo(img["src"], seat_number)
            time.sleep(0.3)

        member = {
            "seat_number": seat_number,
            "name": name,
            "furigana": furigana,
            "party": party,
            "faction": "",
            "committees": [],
            "photo_url": photo_url,
        }
        members.append(member)
        print(f"  [{seat_number}] {name}（{furigana}）/ {party}")

    if not members:
        print("  議員データが取得できませんでした")
        return

    members.sort(key=lambda m: m["seat_number"])

    out_path = OUTPUT_DIR / "members.json"
    out_path.write_text(json.dumps(members, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n完了: {len(members)}名 -> {out_path}")


if __name__ == "__main__":
    scrape_members()
