"""
伊達市議会 議員名簿スクレイパー
出力: data/date/members.json
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.city.date.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/gikai/detail/00000748.html"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "data" / "date"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = Path(__file__).parent.parent.parent / "site" / "public" / "members" / "date"
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


def download_photo(remote_url: str, fname: str) -> str:
    try:
        resp = requests.get(remote_url, headers=HEADERS, timeout=10)
        resp.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(resp.content)
        return f"/members/date/{fname}"
    except Exception as e:
        print(f"    [PHOTO ERROR] {remote_url} -> {e}")
        return ""


def parse_name_furigana(text: str):
    """'田中　秀幸（たなか　ひでゆき）' を name, furigana に分割"""
    text = text.strip()
    m = re.match(r"^(.+?)[\（(]([^）)]+)[\）)]", text)
    if m:
        name = re.sub(r"\s+", "", m.group(1)).strip()
        furigana = re.sub(r"\s+", " ", m.group(2)).strip()
        return name, furigana
    return re.sub(r"\s+", "", text).strip(), ""


def parse_faction_party(text: str):
    """'あらた・無所属' を faction, party に分割"""
    text = text.strip()
    parts = re.split(r"[・・]", text)
    faction = parts[0].strip() if parts else ""
    party = parts[1].strip() if len(parts) > 1 else ""
    return faction, party


def parse_committees(text: str) -> list:
    """'総務文教常任委員会（委員長）・予算決算常任委員会' をリストに分割"""
    if not text:
        return []
    items = re.split(r"[・・]", text)
    return [item.strip() for item in items if item.strip()]


def scrape_members():
    print("伊達市議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return []

    # 議員写真imgタグを順番に取得（hotnewsのjpg）
    member_imgs = [
        img for img in soup.find_all("img")
        if "hotnews" in img.get("src", "") and img.get("src", "").endswith(".jpg")
    ]
    print(f"  議員写真: {len(member_imgs)} 件")

    members = []

    for img in member_imgs:
        # 写真の直後のテーブルを取得
        table = img.find_next("table")
        if table is None:
            continue

        # テーブルの各行をキー→値マッピングで取得
        data = {}
        for row in table.find_all("tr"):
            cells = row.find_all(["th", "td"])
            if len(cells) >= 2:
                key = cells[0].get_text(strip=True)
                val = cells[1].get_text(strip=True)
                data[key] = val

        seat_str = data.get("議席番号", "").strip()
        if not seat_str or not re.match(r"^\d+$", seat_str):
            continue

        seat_num = int(seat_str)
        name_raw = data.get("氏名（ふりがな）", "")
        name, furigana = parse_name_furigana(name_raw)

        faction_raw = data.get("所属会派・党派", "")
        faction, party = parse_faction_party(faction_raw)

        committee_raw = data.get("役職・所属委員会", "")
        committees = parse_committees(committee_raw)

        # 写真ダウンロード
        src = img.get("src", "")
        remote_url = src if src.startswith("http") else BASE_URL + src
        ext = remote_url.split(".")[-1].split("?")[0] or "jpg"
        fname = f"seat_{seat_num}.{ext}"
        print(f"  [{seat_num}] {name} ({furigana}) / {faction} - 写真DL中...")
        photo_url = download_photo(remote_url, fname)
        time.sleep(0.3)

        member = {
            "seat_number": seat_num,
            "name": name,
            "furigana": furigana,
            "party": party,
            "faction": faction,
            "committees": committees,
            "photo_url": photo_url,
        }
        members.append(member)

    return members


def main():
    members = scrape_members()

    if not members:
        print("議員データが取得できませんでした")
        return

    members.sort(key=lambda m: m["seat_number"])

    output_path = OUTPUT_DIR / "members.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(members, f, ensure_ascii=False, indent=2)

    print(f"\n完了: {len(members)} 名を {output_path} に保存しました")
    print(f"取得議員数: {len(members)}名")


if __name__ == "__main__":
    main()
