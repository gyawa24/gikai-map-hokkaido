"""
豊頃町議会 議員名簿スクレイパー
出力: site/data/toyokoro/members.json
"""

import json
import re
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.toyokoro.jp"
MEMBERS_URL = f"{BASE_URL}/site/gikai/3886.html"

ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = ROOT / "site" / "data" / "toyokoro"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
DATA_DIR = ROOT / "data" / "toyokoro"
DATA_DIR.mkdir(parents=True, exist_ok=True)

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


def normalize_name(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("\u3000", " ")).strip()


def extract_committees(cell) -> list[str]:
    # 役職セル内の <br> で区切られた文字列を取り出す
    parts: list[str] = []
    for chunk in cell.get_text("\n", strip=True).split("\n"):
        chunk = chunk.strip()
        if chunk:
            parts.append(chunk)
    return parts


def scrape_members() -> list[dict]:
    print("豊頃町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return []

    table = soup.find("table")
    if table is None:
        print("  議員一覧テーブルが見つかりません")
        return []

    members: list[dict] = []
    rows = table.find_all("tr")
    for tr in rows[1:]:  # ヘッダー行をスキップ
        cells = tr.find_all(["td", "th"])
        if len(cells) < 4:
            continue
        seat_text = cells[0].get_text(strip=True)
        if not seat_text.isdigit():
            continue
        seat_number = int(seat_text)
        name = normalize_name(cells[2].get_text(strip=True))
        committees = extract_committees(cells[3])
        members.append(
            {
                "seat_number": seat_number,
                "name": name,
                "furigana": "",
                "party": "",
                "faction": "",
                "committees": committees,
            }
        )
        print(f"  [{seat_number}] {name} 委員会={committees}")

    return members


def main() -> None:
    members = scrape_members()
    if not members:
        print("取得不可: 議員データを抽出できませんでした")
        return

    out = OUTPUT_DIR / "members.json"
    out.write_text(
        json.dumps(members, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    # data/ にも同期コピー（同様の他市スクレイパーに合わせる）
    (DATA_DIR / "members.json").write_text(
        json.dumps(members, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"取得議員数: {len(members)}名")
    print(f"出力: {out}")


if __name__ == "__main__":
    main()
