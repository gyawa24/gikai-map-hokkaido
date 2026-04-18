"""
利尻町議会 議員名簿スクレイパー
出力: data/rishiri/members.json
"""

import json
import re
from pathlib import Path

import requests
from bs4 import BeautifulSoup

MEMBERS_URL = "https://rishiri-town.jp/%e7%94%ba%e8%ad%b0%e4%bc%9a/%e8%ad%b0%e4%bc%9a%e6%a7%8b%e6%88%90/"
ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = ROOT / "data" / "rishiri"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def normalize_name(raw: str) -> str:
    # 全角スペース・半角スペースを除去し姓名を連結（氏名内の空白は区切り用）
    # 例: "中 川 原　　潔" -> "中川原 潔"
    # ただし姓名の区切りは識別困難なため、すべての空白を除去した形で保持
    return re.sub(r"[\s\u3000]+", "", raw).strip()


def scrape_members():
    print("利尻町議会 議員名簿を収集中...")
    resp = requests.get(MEMBERS_URL, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding
    soup = BeautifulSoup(resp.text, "html.parser")

    article = soup.find("article")
    if article is None:
        print("  [ERROR] 記事本文が見つかりません")
        return

    table = article.find("table")
    if table is None:
        print("  [ERROR] 議員テーブルが見つかりません")
        return

    members = []
    rows = table.find_all("tr")
    for row in rows:
        cells = [c.get_text(strip=True) for c in row.find_all("td")]
        if len(cells) < 4:
            continue
        seat_raw, name_raw, _terms, party_raw = cells[:4]
        if not seat_raw.isdigit():
            continue
        name = normalize_name(name_raw)
        if not name:
            continue
        party = party_raw.strip()
        members.append({
            "seat_number": int(seat_raw),
            "name": name,
            "furigana": "",
            "party": party,
            "faction": "",
            "committees": [],
        })

    if not members:
        print("  [ERROR] 議員が1名も抽出できませんでした")
        return

    out = OUTPUT_DIR / "members.json"
    with out.open("w", encoding="utf-8") as f:
        json.dump(members, f, ensure_ascii=False, indent=2)

    print(f"  抽出完了: {len(members)} 名 -> {out}")
    for m in members:
        print(f"    {m['seat_number']:>2}. {m['name']} ({m['party']})")


if __name__ == "__main__":
    scrape_members()
