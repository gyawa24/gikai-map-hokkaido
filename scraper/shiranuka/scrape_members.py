"""
白糠町議会 議員名簿スクレイパー
出力: data/shiranuka/members.json
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.shiranuka.lg.jp"
MEMBERS_URL = f"{BASE_URL}/section/gikai/qvum4j00000000y7.html"

ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = ROOT / "data" / "shiranuka"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
SITE_DATA_DIR = ROOT / "site" / "data" / "shiranuka"
SITE_DATA_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = ROOT / "site" / "public" / "members" / "shiranuka"
PHOTO_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def fetch_html(url: str) -> BeautifulSoup | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def parse_header(text: str) -> tuple[int | None, str, str]:
    # 例: "1.森 武人(もり たけと)"
    m = re.match(r"\s*(\d+)\s*[．.、]\s*(.+?)\s*[（(]\s*(.+?)\s*[)）]\s*$", text)
    if not m:
        return None, text.strip(), ""
    seat = int(m.group(1))
    name = m.group(2).replace(" ", "").replace("\u3000", "")
    furigana = m.group(3).strip()
    return seat, name, furigana


def extract_field(ul_items: list[str], label: str) -> str:
    for item in ul_items:
        if item.startswith(label):
            value = item.split("：", 1)[-1] if "：" in item else item.split(":", 1)[-1]
            return value.strip()
    return ""


def save_photo(img_src: str, seat: int) -> str:
    remote_url = img_src if img_src.startswith("http") else BASE_URL + img_src
    ext = remote_url.split(".")[-1].split("?")[0].lower() or "jpg"
    if ext not in ("jpg", "jpeg", "png", "gif", "webp"):
        ext = "jpg"
    fname = f"seat_{seat}.{ext}"
    try:
        img_resp = requests.get(remote_url, headers=HEADERS, timeout=15)
        img_resp.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(img_resp.content)
        return f"/members/shiranuka/{fname}"
    except Exception as e:
        print(f"    [IMG ERROR] {remote_url} -> {e}")
        return ""


def scrape_members():
    print("白糠町議会 議員名簿を収集中...")
    soup = fetch_html(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return None

    sections = soup.find_all("section", id=re.compile(r"^s\d+$"))
    print(f"  議員セクション {len(sections)} 件発見")

    if not sections:
        return None

    members = []
    for sec in sections:
        h3 = sec.find("h3")
        if not h3:
            continue
        seat, name, furigana = parse_header(h3.get_text(strip=True))
        if not name:
            continue
        if seat is None:
            seat = len(members) + 1

        ul = sec.find("ul")
        items = [li.get_text(strip=True) for li in ul.find_all("li")] if ul else []

        party = extract_field(items, "党派")
        # 会派情報はページに記載がないため空
        faction = ""

        photo_url = ""
        img = sec.find("img")
        if img and img.get("src"):
            photo_url = save_photo(img["src"], seat)
            time.sleep(0.3)

        members.append({
            "seat_number": seat,
            "name": name,
            "furigana": furigana,
            "party": party,
            "faction": faction,
            "committees": [],
            "photo_url": photo_url,
        })
        print(f"  [{seat}] {name} ({furigana}) 党派={party}")

    return members


def main():
    members = scrape_members()
    if not members:
        print("取得不可: 議員情報を抽出できませんでした")
        return

    members.sort(key=lambda m: m["seat_number"])
    out_json = json.dumps(members, ensure_ascii=False, indent=2)
    (OUTPUT_DIR / "members.json").write_text(out_json, encoding="utf-8")
    (SITE_DATA_DIR / "members.json").write_text(out_json, encoding="utf-8")
    print(f"\n保存完了: {len(members)} 名")
    print(f"  -> {OUTPUT_DIR / 'members.json'}")
    print(f"  -> {SITE_DATA_DIR / 'members.json'}")


if __name__ == "__main__":
    main()
