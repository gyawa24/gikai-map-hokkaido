"""
平取町議会 議員名簿スクレイパー
出力: site/data/biratori/members.json
"""

import json
import re
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.biratori.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/choseijoho/biratorichogikai/1504.html"

OUTPUT_DIR = Path(__file__).parent.parent.parent / "site" / "data" / "biratori"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = Path(__file__).parent.parent.parent / "site" / "public" / "members" / "biratori"
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


def parse_name_furigana(cell_text: str) -> tuple[str, str]:
    """
    "中川 嘉久（ナカガワ ヨシヒサ）" → ("中川 嘉久", "ナカガワ ヨシヒサ")
    全角/半角括弧の両方に対応。
    """
    m = re.match(r"^(.+?)[（(]([^）)]+)[）)]\s*$", cell_text)
    if m:
        name = m.group(1).strip()
        furigana = m.group(2).strip()
        return name, furigana
    return cell_text.strip(), ""


def scrape_members():
    print("平取町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return False

    tables = soup.find_all("table")
    if not tables:
        print("  テーブルが見つかりません")
        return False

    # 議員名簿のテーブルを特定：ヘッダに「議員氏名」を含むもの
    target_table = None
    for t in tables:
        header_cells = [c.get_text(strip=True) for c in t.find_all(["th", "td"])[:10]]
        header_text = " ".join(header_cells)
        if "議員氏名" in header_text or "氏名" in header_text:
            target_table = t
            break

    if target_table is None:
        print("  議員名簿テーブルが特定できません")
        return False

    rows = target_table.find_all("tr")
    if len(rows) < 2:
        print("  データ行がありません")
        return False

    # ヘッダ行から列インデックスを特定
    header_cells = [c.get_text(strip=True) for c in rows[0].find_all(["th", "td"])]
    print(f"  ヘッダ: {header_cells}")

    def find_col(keywords: list[str]) -> int:
        for i, h in enumerate(header_cells):
            for k in keywords:
                if k in h:
                    return i
        return -1

    col_name = find_col(["議員氏名", "氏名", "名前"])
    col_party = find_col(["党派", "政党", "会派"])

    if col_name < 0:
        print("  氏名列が見つかりません")
        return False

    members = []
    for i, row in enumerate(rows[1:], start=1):
        cells = [c.get_text(strip=True) for c in row.find_all(["th", "td"])]
        if len(cells) <= col_name:
            continue

        name_cell = cells[col_name]
        if not name_cell:
            continue

        name, furigana = parse_name_furigana(name_cell)
        party = cells[col_party] if col_party >= 0 and col_party < len(cells) else ""

        member = {
            "seat_number": i,
            "name": name,
            "furigana": furigana,
            "party": party,
            "faction": "",
            "committees": [],
        }
        members.append(member)
        print(f"  [{i}] {name} ({furigana}) / {party}")

    if not members:
        print("  議員データが抽出できませんでした")
        return False

    output_path = OUTPUT_DIR / "members.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(members, f, ensure_ascii=False, indent=2)

    print(f"\n取得議員数: {len(members)}名")
    print(f"出力: {output_path}")
    return True


if __name__ == "__main__":
    ok = scrape_members()
    exit(0 if ok else 1)
