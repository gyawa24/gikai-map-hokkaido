"""
北見市議会 議員名簿スクレイパー
出力: data/kitami/members.json

ページ構造（会派別名簿 /administration/town/detail.php?content=8993）:
  cassette-item (head_block):
    <h4>新市政みらい（７名）</h4>
  cassette-item (table_block):
    <table class="c-table">
      <tr><th>会長</th><td>高橋　克博</td></tr>
      ...
    </table>
  → head_block と table_block が交互に並ぶ構造
  → td に議員名、th に役職名
"""

import json
import re
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.city.kitami.lg.jp"
FACTION_URL = f"{BASE_URL}/administration/town/detail.php?content=8993"

OUTPUT_DIR = Path(__file__).parent.parent.parent / "data" / "kitami"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = Path(__file__).parent.parent.parent / "site" / "public" / "members" / "kitami"
PHOTO_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

# 会派名から政党を推定するマッピング
FACTION_TO_PARTY = {
    "公明党": "公明党",
    "日本共産党北見市議会議員団": "日本共産党",
}

# 会派名パターン（「○○（N名）」形式）
FACTION_PATTERN = re.compile(r"(.+?)（(\d+)名）")


def fetch(url: str) -> BeautifulSoup | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def scrape_members():
    print("北見市議会 議員名簿を収集中...")
    soup = fetch(FACTION_URL)
    if soup is None:
        print("  ページ取得失敗")
        return

    members = []
    seat_number = 1

    # cassette-item ブロックを順番に処理
    # head_block → faction name, table_block → member table
    cassettes = soup.find_all("div", class_="cassette-item")
    print(f"  cassette-item ブロック数: {len(cassettes)}")

    current_faction = ""
    current_party = ""

    for cassette in cassettes:
        classes = cassette.get("class", [])

        # 会派名ブロック（head_block）
        if "head_block" in classes:
            h4 = cassette.find("h4")
            if h4:
                text = h4.get_text(strip=True)
                m = FACTION_PATTERN.search(text)
                if m:
                    current_faction = m.group(1).strip()
                    current_party = FACTION_TO_PARTY.get(current_faction, "")
                    print(f"  会派: {current_faction} ({m.group(2)}名)")

        # 議員名テーブルブロック（table_block）
        elif "table_block" in classes and current_faction:
            table = cassette.find("table", class_="c-table")
            if table:
                for row in table.find_all("tr"):
                    td = row.find("td")
                    if td:
                        name = td.get_text(strip=True)
                        if name and re.search(r"[\u4e00-\u9fff髙]", name):
                            member = {
                                "seat_number": seat_number,
                                "name": name,
                                "furigana": "",
                                "party": current_party,
                                "faction": current_faction,
                                "committees": [],
                            }
                            members.append(member)
                            print(f"  [{seat_number}] {name} / {current_faction}")
                            seat_number += 1

    print(f"\n  取得議員数: {len(members)}名")

    if members:
        out_path = OUTPUT_DIR / "members.json"
        out_path.write_text(
            json.dumps(members, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"  -> 保存: {out_path} ({len(members)}名)")
    else:
        print("  議員データが取得できませんでした。")
        print(f"  対象URL: {FACTION_URL}")


if __name__ == "__main__":
    scrape_members()
