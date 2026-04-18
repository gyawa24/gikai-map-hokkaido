"""
士幌町議会 議員名簿スクレイパー
出力: data/shihoro/members.json
写真: site/public/members/shihoro/seat_N.jpg
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.shihoro.jp"
MEMBERS_URL = f"{BASE_URL}/assembly/introduction/"

REPO_ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = REPO_ROOT / "data" / "shihoro"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = REPO_ROOT / "site" / "public" / "members" / "shihoro"
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


def download_photo(remote_url: str, seat: int) -> str:
    ext = remote_url.split(".")[-1].split("?")[0].lower() or "jpg"
    if ext not in ("jpg", "jpeg", "png", "gif"):
        ext = "jpg"
    fname = f"seat_{seat}.{ext}"
    try:
        resp = requests.get(remote_url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(resp.content)
        return f"/members/shihoro/{fname}"
    except Exception as e:
        print(f"    [WARN] 写真DL失敗 {remote_url} -> {e}")
        return ""


def normalize_name(text: str) -> str:
    # 全角/半角スペースを一つに正規化
    text = re.sub(r"[\s\u3000]+", "\u3000", text).strip()
    return text


def scrape_members():
    print("士幌町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return None

    items = soup.select("li.c-introList_item")
    print(f"  議員項目 {len(items)} 件発見")

    if not items:
        print("  議員一覧がHTML上に見つかりません")
        return None

    members = []
    for item in items:
        num_el = item.select_one(".c-introList_item_num")
        name_el = item.select_one(".c-introList_item_name")
        if not num_el or not name_el:
            continue

        num_match = re.search(r"(\d+)", num_el.get_text(strip=True))
        if not num_match:
            continue
        seat_number = int(num_match.group(1))

        # rubyタグ等が混入している場合があるのでtext抽出後に正規化
        raw_name = name_el.get_text(" ", strip=True)
        # タグ残骸除去（</ruby>などがテキスト化されるケースは無いが念のため）
        raw_name = re.sub(r"<[^>]+>", "", raw_name)
        name = normalize_name(raw_name)

        committees = [
            li.get_text(strip=True)
            for li in item.select(".c-introList_item_type li")
            if li.get_text(strip=True)
        ]

        photo_url = ""
        img = item.select_one("figure img")
        if img and img.get("src"):
            src = img["src"]
            remote = src if src.startswith("http") else BASE_URL + src
            photo_url = download_photo(remote, seat_number)
            time.sleep(0.3)

        member = {
            "seat_number": seat_number,
            "name": name,
            "furigana": "",
            "party": "",
            "faction": "",
            "committees": committees,
            "photo_url": photo_url,
        }
        print(f"  [{seat_number}] {name} 委員会{len(committees)}件 photo={'o' if photo_url else 'x'}")
        members.append(member)

    members.sort(key=lambda m: m["seat_number"])
    return members


def main():
    members = scrape_members()
    if not members:
        print("取得不可: 議員一覧を抽出できませんでした")
        return

    out_path = OUTPUT_DIR / "members.json"
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(members, f, ensure_ascii=False, indent=2)
    print(f"取得議員数: {len(members)}名")
    print(f"出力: {out_path}")


if __name__ == "__main__":
    main()
