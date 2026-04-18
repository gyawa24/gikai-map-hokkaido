"""
新得町議会 議員名簿スクレイパー
出力: data/shintoku/members.json
"""

import json
import re
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://shintoku-town.jp"
MEMBERS_URL = f"{BASE_URL}/gyousei/gikai/giinmeibo/"

REPO_ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = REPO_ROOT / "data" / "shintoku"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = REPO_ROOT / "site" / "public" / "members" / "shintoku"
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


def normalize_name(text: str) -> str:
    text = re.sub(r"[\s\u3000]+", "\u3000", text).strip()
    return text


def parse_basic_table(table) -> list[dict]:
    # thead の列順: 議席 / 氏名 / 年齢 / 党派 / 当選回数 / 職業
    rows = table.select("tbody tr")
    members: list[dict] = []
    prev_party = ""
    for tr in rows:
        th = tr.find("th")
        tds = tr.find_all("td")
        if not th or len(tds) < 5:
            continue
        seat_txt = th.get_text(strip=True)
        seat_match = re.search(r"(\d+)", seat_txt)
        if not seat_match:
            continue
        seat = int(seat_match.group(1))
        name = normalize_name(tds[0].get_text(" ", strip=True))
        party_raw = tds[2].get_text(strip=True)
        # 「〃」は直前と同じ党派
        if party_raw in ("〃", "々", "同上", ""):
            party = prev_party
        else:
            party = party_raw
            prev_party = party
        members.append({
            "seat_number": seat,
            "name": name,
            "furigana": "",
            "party": party,
            "faction": "",
            "committees": [],
            "photo_url": "",
        })
    return members


def parse_role_table(table) -> dict[str, str]:
    # 議長/副議長 → 氏名 の対応
    mapping: dict[str, str] = {}
    for tr in table.select("tbody tr"):
        th = tr.find("th")
        td = tr.find("td")
        if not th or not td:
            continue
        role = th.get_text(strip=True)
        name = normalize_name(td.get_text(" ", strip=True))
        if role and name:
            mapping[name] = role
    return mapping


def parse_committee_table(table) -> dict[str, list[str]]:
    # 表頭にある委員会名ごとに、委員/副委員長/委員長 を拾って氏名→委員会リストを作る
    header_row = table.select_one("thead tr") or table.select_one("tr")
    if not header_row:
        return {}
    header_cells = header_row.find_all(["td", "th"])
    # 最初の列は役職ラベル（空欄）、以降が委員会名
    committee_names = [
        re.sub(r"\s+", "", c.get_text(" ", strip=True))
        for c in header_cells[1:]
    ]
    result: dict[str, list[str]] = {}
    for tr in table.select("tbody tr"):
        tds = tr.find_all("td")
        for idx, td in enumerate(tds):
            if idx >= len(committee_names):
                break
            name = normalize_name(td.get_text(" ", strip=True))
            if not name:
                continue
            committee = committee_names[idx]
            if not committee:
                continue
            result.setdefault(name, []).append(committee)
    return result


def scrape_members():
    print("新得町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return None

    tables = soup.find_all("table")
    if len(tables) < 3:
        print(f"  テーブル数不足: {len(tables)}")
        return None

    members = parse_basic_table(tables[0])
    if not members:
        print("  基本情報テーブルから議員を抽出できず")
        return None
    print(f"  議員 {len(members)} 名を基本テーブルから取得")

    roles = parse_role_table(tables[1])
    print(f"  役職 {len(roles)} 件")

    # tables[2] は常任委員会・議会運営委員会
    committees_by_name = parse_committee_table(tables[2])
    print(f"  委員会所属 {len(committees_by_name)} 名分")

    for m in members:
        name = m["name"]
        committees = list(committees_by_name.get(name, []))
        # 議長・副議長 は faction ではなく役職なので、faction に入れるのではなく
        # DESIGN に従い committees/party のみ使用。役職は committees 先頭に追加。
        role = roles.get(name)
        if role:
            committees.insert(0, role)
        m["committees"] = committees

    for m in members:
        print(f"  [{m['seat_number']}] {m['name']} ({m['party']}) 委員会{len(m['committees'])}件")

    members.sort(key=lambda x: x["seat_number"])
    return members


def main():
    members = scrape_members()
    if not members:
        print("取得不可: 議員一覧を抽出できませんでした")
        return
    out_path = OUTPUT_DIR / "members.json"
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(members, f, ensure_ascii=False, indent=2)
    print(f"取得議員数: {len(members)}名")
    print(f"出力: {out_path}")


if __name__ == "__main__":
    main()
