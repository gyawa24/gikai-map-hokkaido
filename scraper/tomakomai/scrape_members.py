"""
苫小牧市議会 議員名簿スクレイパー
出力: site/data/tomakomai/members.json
写真: site/public/members/tomakomai/
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.city.tomakomai.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/gikai/shokai/giinmeibo.html"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "site" / "data" / "tomakomai"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = Path(__file__).parent.parent.parent / "site" / "public" / "members" / "tomakomai"
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
        resp.encoding = "utf-8"
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def download_photo(remote_url: str, seat: int) -> str:
    ext = remote_url.split(".")[-1].split("?")[0] or "jpg"
    fname = f"seat_{seat}.{ext}"
    dest = PHOTO_DIR / fname
    try:
        resp = requests.get(remote_url, headers=HEADERS, timeout=10)
        resp.raise_for_status()
        dest.write_bytes(resp.content)
        return f"/members/tomakomai/{fname}"
    except Exception as e:
        print(f"  [WARN] 写真取得失敗 seat {seat}: {e}")
        return remote_url


def scrape_members():
    print("苫小牧市議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return

    table = soup.find("table")
    if not table:
        print("  テーブルが見つかりません")
        return

    rows = table.find_all("tr")
    print(f"  総行数: {len(rows)}")

    members_raw = []
    current: dict = {}

    for row in rows:
        cells = row.find_all(["td", "th"])
        cell_texts = [c.get_text(strip=True).replace("\u3000", " ") for c in cells]

        # 写真があれば新しい議員ブロックの開始
        img = row.find("img")
        if img and img.get("src") and "/files/" in img["src"]:
            if current.get("name"):
                members_raw.append(current)
            photo_src = img["src"]
            current = {
                "photo_remote": photo_src if photo_src.startswith("http") else BASE_URL + photo_src,
                "furigana": cell_texts[-1] if cell_texts else "",
                "name": "",
                "faction": "",
                "seat_number": 0,
            }
            continue

        if not current:
            continue

        # 氏名行（漢字を含む1セル）
        if len(cell_texts) == 1 and re.search(r"[\u4e00-\u9fff]", cell_texts[0]) and not current["name"]:
            current["name"] = cell_texts[0]

        # 会派・議席番号行（4セル）
        elif len(cell_texts) >= 4:
            for i in range(0, len(cell_texts) - 1, 2):
                label = cell_texts[i]
                value = cell_texts[i + 1]
                if label == "会派":
                    current["faction"] = value
                elif label == "議席番号":
                    try:
                        current["seat_number"] = int(value)
                    except ValueError:
                        pass

    if current.get("name"):
        members_raw.append(current)

    # 写真ダウンロード & 整形
    members = []
    for m in members_raw:
        if not m.get("name") or not m.get("seat_number"):
            continue
        seat = m["seat_number"]
        photo_url = ""
        if m.get("photo_remote"):
            photo_url = download_photo(m["photo_remote"], seat)
            time.sleep(0.3)

        member = {
            "seat_number": seat,
            "name": m["name"],
            "furigana": m.get("furigana", ""),
            "party": "",
            "faction": m.get("faction", ""),
            "committees": [],
            "photo_url": photo_url,
        }
        members.append(member)
        print(f"  {seat}: {m['name']}（{m['furigana']}）/ {m['faction']}")

    members.sort(key=lambda x: x["seat_number"])

    if members:
        out_path = OUTPUT_DIR / "members.json"
        out_path.write_text(
            json.dumps(members, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"  -> 保存: {out_path} ({len(members)}名)")
    else:
        print("  議員データが取得できませんでした。")


if __name__ == "__main__":
    scrape_members()
