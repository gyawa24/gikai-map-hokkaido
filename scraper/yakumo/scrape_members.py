"""
八雲町議会 議員名簿スクレイパー
出力: data/yakumo/members.json
"""

import json
import re
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.yakumo.lg.jp"
MEMBERS_URL = f"{BASE_URL}/site/gikai/giinmeibo20251111.html"
FACTION_URL = f"{BASE_URL}/site/gikai/content0853.html"

ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = ROOT / "data" / "yakumo"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def fetch(url: str) -> BeautifulSoup:
    resp = requests.get(url, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding
    return BeautifulSoup(resp.text, "html.parser")


def normalize_name(s: str) -> str:
    return re.sub(r"[\s\u3000○]", "", s)


def parse_member_table(soup: BeautifulSoup) -> list[dict]:
    """議員名簿ページ: 氏名 / かな / 当選回数 / 所属政党 / 役職"""
    table = soup.find("table")
    if table is None:
        raise RuntimeError("議員名簿テーブルが見つかりません")

    members = []
    rows = table.find_all("tr")
    for i, tr in enumerate(rows[1:], start=1):  # skip header
        cells = [c.get_text(strip=True) for c in tr.find_all(["th", "td"])]
        if len(cells) < 4:
            continue
        name = re.sub(r"[\s\u3000]+", " ", cells[0])
        furigana = re.sub(r"[\s\u3000]+", " ", cells[1])
        party_raw = cells[3]
        role = cells[4] if len(cells) >= 5 else ""

        members.append({
            "seat_number": i,
            "name": name,
            "furigana": furigana,
            "party": "" if party_raw == "無所属" else party_raw,
            "faction": "",
            "committees": [role] if role else [],
        })
    return members


def parse_faction_table(soup: BeautifulSoup) -> dict[str, str]:
    """会派名簿ページ → {正規化氏名: 会派名}"""
    table = soup.find("table")
    if table is None:
        raise RuntimeError("会派テーブルが見つかりません")

    mapping: dict[str, str] = {}
    current_faction = ""
    for tr in table.find_all("tr")[1:]:  # skip header
        cells = [c.get_text(strip=True) for c in tr.find_all(["th", "td"])]
        # 会派名が含まれる行は 4 セル、継続行は 3 セル
        if len(cells) == 4:
            current_faction = cells[0]
            name_cells = cells[1:]
        else:
            name_cells = cells
        for raw in name_cells:
            if not raw:
                continue
            key = normalize_name(raw)
            if key:
                mapping[key] = current_faction
    return mapping


def main():
    print("八雲町議会 議員名簿を収集中...")
    members_soup = fetch(MEMBERS_URL)
    faction_soup = fetch(FACTION_URL)

    members = parse_member_table(members_soup)
    factions = parse_faction_table(faction_soup)

    print(f"  議員 {len(members)} 名 / 会派マッピング {len(factions)} 件")

    for m in members:
        key = normalize_name(m["name"])
        if key in factions:
            m["faction"] = factions[key]
        else:
            print(f"  [WARN] 会派不明: {m['name']}")

    out_path = OUTPUT_DIR / "members.json"
    out_path.write_text(
        json.dumps(members, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"  → {out_path} に {len(members)} 名を保存")


if __name__ == "__main__":
    main()
