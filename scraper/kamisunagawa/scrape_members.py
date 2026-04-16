"""
上砂川町議会 議員名簿スクレイパー
出力: data/kamisunagawa/members.json
ソース: https://town.kamisunagawa.hokkaido.jp/gikai_jimukyoku/meibo/513.html
"""

import json
import re
from pathlib import Path

import requests
from bs4 import BeautifulSoup

MEMBERS_URL = "https://town.kamisunagawa.hokkaido.jp/gikai_jimukyoku/meibo/513.html"

REPO_ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = REPO_ROOT / "data" / "kamisunagawa"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = REPO_ROOT / "site" / "public" / "members" / "kamisunagawa"
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


def normalize_name(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def scrape_members():
    print("上砂川町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return None

    page_text = soup.get_text("\n", strip=True)

    # 議長・副議長を本文テキストから抽出（役職付与のため）
    role_map: dict[str, str] = {}
    m = re.search(r"議長\s*([^\s・\n、,]+[\u3000\s][^\s\n、,]+)", page_text)
    if m:
        role_map[normalize_name(m.group(1))] = "議長"
    m = re.search(r"副議長\s*([^\s・\n、,]+[\u3000\s][^\s\n、,]+)", page_text)
    if m:
        role_map[normalize_name(m.group(1))] = "副議長"

    # 議員一覧テーブルを探す（見出し "議席" + "氏名" を含むテーブル）
    target_table = None
    for t in soup.find_all("table"):
        header_cells = [th.get_text(strip=True) for th in t.find_all(["th", "td"], limit=8)]
        joined = "".join(header_cells)
        if "議席" in joined and "氏名" in joined:
            target_table = t
            break

    if target_table is None:
        print("  [ERROR] 議員一覧テーブルが見つかりません")
        return None

    # ヘッダー行から各列のインデックスを特定
    rows = target_table.find_all("tr")
    if not rows:
        print("  [ERROR] テーブルに行がありません")
        return None

    header_cells = [c.get_text(strip=True) for c in rows[0].find_all(["th", "td"])]
    def col_index(keyword: str) -> int:
        for i, h in enumerate(header_cells):
            if keyword in h:
                return i
        return -1

    idx_seat = col_index("議席")
    idx_name = col_index("氏名")
    idx_party = col_index("党派")
    if idx_party < 0:
        idx_party = col_index("会派")

    if idx_seat < 0 or idx_name < 0:
        print(f"  [ERROR] 必要な列が見つかりません headers={header_cells}")
        return None

    members = []
    for tr in rows[1:]:
        cells = [td.get_text(" ", strip=True) for td in tr.find_all(["td", "th"])]
        if len(cells) <= max(idx_seat, idx_name):
            continue
        seat_text = cells[idx_seat]
        name_raw = cells[idx_name]
        if not seat_text.strip().isdigit():
            continue
        seat = int(seat_text.strip())
        name = normalize_name(name_raw)
        if not name:
            continue

        party = cells[idx_party].strip() if 0 <= idx_party < len(cells) else ""

        member = {
            "seat_number": seat,
            "name": name,
            "furigana": "",
            "party": party,
            "faction": "",
            "committees": [],
            "photo_url": "",
        }
        role = role_map.get(name)
        if role:
            member["role"] = role
        members.append(member)

    members.sort(key=lambda m: m["seat_number"])
    print(f"  議員 {len(members)} 名を取得")
    return members


def main():
    members = scrape_members()
    if not members:
        print("取得不可: 議員データが空")
        return
    out_path = OUTPUT_DIR / "members.json"
    out_path.write_text(
        json.dumps(members, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"  保存: {out_path}")
    print(f"取得議員数: {len(members)}名")


if __name__ == "__main__":
    main()
