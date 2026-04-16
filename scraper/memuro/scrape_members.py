"""
芽室町議会 議員名簿スクレイパー
出力: data/memuro/members.json
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://mgikai.memuro.net"
MEMBERS_URL = f"{BASE_URL}/about/member/assembly.html"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "data" / "memuro"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = Path(__file__).parent.parent.parent / "site" / "public" / "members" / "memuro"
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
        return f"/members/memuro/{fname}"
    except Exception as e:
        print(f"  [PHOTO ERROR] {remote_url} -> {e}")
        return ""


def scrape_members():
    print("芽室町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return []

    # 各議員は div.giin-box に格納されている
    boxes = soup.find_all("div", class_="giin-box")
    print(f"  議員ブロック {len(boxes)} 件発見")

    members = []

    for box in boxes:
        member = {
            "seat_number": 0,
            "name": "",
            "furigana": "",
            "party": "",
            "faction": "",
            "committees": [],
            "photo_url": "",
        }

        # 議席番号: div.nam 内のテキスト（<span>議席番号</span>の後の数字）
        nam_div = box.find("div", class_="nam")
        if nam_div:
            nam_text = nam_div.get_text(strip=True)
            seat_match = re.search(r"(\d+)", nam_text)
            if seat_match:
                member["seat_number"] = int(seat_match.group(1))

        # ふりがな: div.kana
        kana_div = box.find("div", class_="kana")
        if kana_div:
            member["furigana"] = kana_div.get_text(strip=True).replace("　", " ")

        # 氏名: div.name > p
        name_div = box.find("div", class_="name")
        if name_div:
            p = name_div.find("p")
            if p:
                member["name"] = p.get_text(strip=True).replace("　", " ")

        # ul > li: 1件目が政党、2件目以降が委員会
        ul = box.find("div", class_="text")
        if ul:
            li_items = ul.find_all("li")
            committees = []
            for i, li in enumerate(li_items):
                text = li.get_text(strip=True)
                if i == 0:
                    member["party"] = text
                else:
                    committees.append(text)
            member["committees"] = committees

        # 写真: div.image > img
        img_tag = box.find("div", class_="image")
        if img_tag:
            img = img_tag.find("img")
            if img and img.get("src"):
                src = img["src"].split("?")[0]  # クエリパラメータ除去
                remote_url = src if src.startswith("http") else BASE_URL + src
                seat = member["seat_number"]
                ext = remote_url.rsplit(".", 1)[-1] or "jpg"
                fname = f"seat_{seat}.{ext}"
                photo_url = download_photo(remote_url, fname)
                member["photo_url"] = photo_url
                time.sleep(0.3)

        print(f"  [{member['seat_number']}] {member['name']} ({member['furigana']}) / {member['party']} / 委員会: {len(member['committees'])}件")
        members.append(member)

    # 議席番号でソート
    members.sort(key=lambda m: m["seat_number"])
    return members


def main():
    members = scrape_members()

    if not members:
        print("  [ERROR] 議員データを取得できませんでした")
        return

    output_path = OUTPUT_DIR / "members.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(members, f, ensure_ascii=False, indent=2)

    print(f"\n取得議員数: {len(members)}名")
    print(f"出力先: {output_path}")


if __name__ == "__main__":
    main()
