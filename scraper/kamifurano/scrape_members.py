"""
上富良野町議会 議員名簿スクレイパー
出力: site/data/kamifurano/members.json
"""

import json
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.kamifurano.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/index.php?id=46"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "site" / "data" / "kamifurano"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = Path(__file__).parent.parent.parent / "site" / "public" / "members" / "kamifurano"
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


def scrape_members():
    print("上富良野町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return []

    # 議長・副議長の特定（ページ内テキストから）
    speaker = ""
    vice_speaker = ""
    page_text = soup.get_text()
    for line in page_text.splitlines():
        line = line.strip()
        if "議長" in line and not "副議長" in line and not speaker:
            # テーブル外テキストから議長名を抽出しない（テーブル内で判断）
            pass

    # メインテーブルを探す
    tables = soup.find_all("table")
    member_table = None
    for table in tables:
        headers = [th.get_text(strip=True) for th in table.find_all("th")]
        if any("氏名" in h or "議席" in h for h in headers):
            member_table = table
            break

    if member_table is None:
        # テーブルヘッダーなしの場合、最初の大きなテーブルを使用
        for table in tables:
            rows = table.find_all("tr")
            if len(rows) >= 10:
                member_table = table
                break

    if member_table is None:
        print("  議員テーブルが見つかりませんでした")
        return []

    # 2行ヘッダー構造: row0に議席/氏名/年齢/所属委員会(colspan4)/当選回数, row1に委員会小見出し
    # データ行のカラム: [0]=議席, [1]=氏名, [2]=年齢, [3]=総務産建, [4]=厚生文教, [5]=議会運営, [6]=議会広報, [7]=当選回数
    COMMITTEE_NAMES = ["総務産建委員会", "厚生文教委員会", "議会運営委員会", "議会広報委員会"]
    COL_SEAT = 0
    COL_NAME = 1
    COL_COMMITTEES_START = 3  # インデックス3〜6が各委員会役職

    members = []
    rows = member_table.find_all("tr")[2:]  # 2行ヘッダーをスキップ

    for row in rows:
        cells = row.find_all(["td", "th"])
        if len(cells) < 2:
            continue

        def cell_text(idx):
            if idx >= len(cells):
                return ""
            return cells[idx].get_text(strip=True)

        seat_text = cell_text(COL_SEAT)
        name = cell_text(COL_NAME)

        # 欠員・空行をスキップ
        if not name or "欠員" in name or "欠" in seat_text:
            print(f"  席 {seat_text}: 欠員 -> スキップ")
            continue

        # 議席番号のパース
        try:
            seat_number = int(seat_text)
        except ValueError:
            seat_number = len(members) + 1

        # 委員会情報の収集
        committees = []
        for i, committee_name in enumerate(COMMITTEE_NAMES):
            role = cell_text(COL_COMMITTEES_START + i)
            if role and role not in ("－", "-", ""):
                committees.append(f"{committee_name}{role}")

        member = {
            "seat_number": seat_number,
            "name": name,
            "furigana": "",
            "party": "",
            "faction": "",
            "committees": committees,
            "photo_url": "",
        }
        members.append(member)
        print(f"  [{seat_number}] {name} / {committees}")

    return members


def main():
    members = scrape_members()
    if not members:
        print("議員データを取得できませんでした。members.json は作成しません。")
        return

    output_path = OUTPUT_DIR / "members.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(members, f, ensure_ascii=False, indent=2)

    print(f"\n完了: {len(members)}名 -> {output_path}")


if __name__ == "__main__":
    main()
