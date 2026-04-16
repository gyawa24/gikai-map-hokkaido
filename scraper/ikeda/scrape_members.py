"""
北海道池田町議会 議員名簿スクレイパー
出力: data/ikeda/members.json
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.hokkaido-ikeda.lg.jp"
MEMBERS_URL = f"{BASE_URL}/kikan/gikai/chogikai/955.html"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "data" / "ikeda"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = Path(__file__).parent.parent.parent / "site" / "public" / "members" / "ikeda"
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


def normalize_party(raw: str) -> str:
    raw = raw.strip()
    if raw in ("無", "無所属", ""):
        return "無所属"
    if "共産" in raw:
        return "日本共産党"
    return raw


def scrape_members():
    print("北海道池田町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return

    members = []

    # テーブルから議員情報を取得
    tables = soup.find_all("table")
    print(f"  テーブル数: {len(tables)}")

    target_table = None
    for table in tables:
        text = table.get_text()
        if "氏名" in text or "議席" in text or "大島" in text:
            target_table = table
            break

    if target_table is None:
        print("  議員テーブルが見つかりません。全テキストを確認します。")
        print(soup.get_text()[:3000])
        return

    rows = target_table.find_all("tr")
    print(f"  行数: {len(rows)}")

    # ヘッダー行を確認
    header_row = rows[0] if rows else None
    if header_row:
        headers = [th.get_text(strip=True) for th in header_row.find_all(["th", "td"])]
        print(f"  ヘッダー: {headers}")

    # 列インデックスを動的に特定
    seat_idx = None
    name_idx = None
    furigana_idx = None
    party_idx = None
    role_idx = None

    if header_row:
        for i, h in enumerate(headers):
            if "議席" in h or "番号" in h:
                seat_idx = i
            elif "氏名" in h or "名前" in h:
                name_idx = i
            elif "ふりがな" in h or "読み" in h or "フリガナ" in h:
                furigana_idx = i
            elif "党派" in h or "会派" in h:
                party_idx = i
            elif "役職" in h or "職" in h:
                role_idx = i

    print(f"  列: 議席={seat_idx}, 氏名={name_idx}, ふりがな={furigana_idx}, 党派={party_idx}, 役職={role_idx}")

    for row in rows[1:]:
        cells = row.find_all(["td", "th"])
        if len(cells) < 2:
            continue

        cell_texts = [c.get_text(strip=True) for c in cells]

        # 議席番号
        seat_number = None
        if seat_idx is not None and seat_idx < len(cell_texts):
            try:
                seat_number = int(re.sub(r"\D", "", cell_texts[seat_idx]))
            except ValueError:
                pass

        # 氏名・ふりがなを名前セルから取得（<br> で区切られている）
        name = ""
        furigana = ""
        if name_idx is not None and name_idx < len(cells):
            name_cell = cells[name_idx]
            # <br> タグで分割して最初の部分を氏名、次の部分をふりがなとして取得
            parts = []
            for content in name_cell.descendants:
                if hasattr(content, "name") and content.name == "br":
                    pass
                elif hasattr(content, "string") and content.string:
                    text = content.string.strip()
                    if text:
                        parts.append(text)
            # parts[0] = 氏名, parts[1] = ふりがな
            if parts:
                name = parts[0].replace("\u3000", "").strip()  # 全角スペース除去
            if len(parts) > 1:
                furigana = parts[1].strip()

        if not name or len(name) < 2:
            continue

        # 党派
        party = "無所属"
        if party_idx is not None and party_idx < len(cell_texts):
            party = normalize_party(cell_texts[party_idx])

        # 役職
        role = ""
        if role_idx is not None and role_idx < len(cell_texts):
            role = cell_texts[role_idx]

        member = {
            "seat_number": seat_number,
            "name": name,
            "furigana": furigana,
            "party": party,
            "faction": "",
            "committees": [],
            "photo_url": "",
            "role": role,
        }
        members.append(member)
        print(f"  -> {seat_number}: {name} ({furigana}) [{party}] {role}")

    # seat_number でソート
    members.sort(key=lambda m: m["seat_number"] if m["seat_number"] is not None else 999)

    # 写真がない場合はフィールドだけ残す
    for m in members:
        if not m["photo_url"]:
            m["photo_url"] = ""

    print(f"\n  合計: {len(members)} 名")
    return members


def main():
    members = scrape_members()
    if not members:
        print("議員データが取得できませんでした。")
        return

    output_path = OUTPUT_DIR / "members.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(members, f, ensure_ascii=False, indent=2)

    print(f"\n保存完了: {output_path}")
    print(f"取得議員数: {len(members)}名")


if __name__ == "__main__":
    main()
