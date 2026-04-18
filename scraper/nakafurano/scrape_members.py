"""
中富良野町議会 議員名簿スクレイパー
出力: site/data/nakafurano/members.json
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.nakafurano.lg.jp"
MEMBERS_URL = f"{BASE_URL}/hotnews/detail/00000135.html"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "site" / "data" / "nakafurano"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = Path(__file__).parent.parent.parent / "site" / "public" / "members" / "nakafurano"
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


def normalize_committee(text: str) -> str:
    # 括弧内の役職を除去して委員会名だけ返す
    return re.sub(r"[（(][^）)]*[）)]", "", text).strip()


def extract_role(notes: str, committees: str) -> str:
    roles = []
    for src in [notes, committees]:
        if "議長" in src and "副議長" not in src:
            roles.append("議長")
        if "副議長" in src:
            roles.append("副議長")
        if "委員長" in src and "副委員長" not in src:
            m = re.search(r"([^\s]+委員長)", src)
            if m:
                roles.append(m.group(1))
        if "副委員長" in src:
            m = re.search(r"([^\s]+副委員長)", src)
            if m:
                roles.append(m.group(1))
    return "、".join(roles)


def scrape_members():
    print("中富良野町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return

    # テーブルを探す
    table = soup.find("table")
    if table is None:
        print("  テーブルが見つかりません")
        return

    rows = table.find_all("tr")
    members = []

    for row in rows:
        cols = row.find_all(["td", "th"])
        if not cols:
            continue

        texts = [c.get_text(strip=True) for c in cols]

        # ヘッダー行スキップ
        if not texts or texts[0] in ("議席", "番号", "No"):
            continue

        # 議席番号が数字かチェック
        try:
            seat_number = int(texts[0])
        except (ValueError, IndexError):
            continue

        name = texts[1] if len(texts) > 1 else ""
        if not name:
            continue

        # 列構成: 議席, 氏名, 職業, 当選回数, 党派, 所属委員会, 備考
        party = texts[4] if len(texts) > 4 else ""
        committee_raw = texts[5] if len(texts) > 5 else ""
        notes = texts[6] if len(texts) > 6 else ""

        # 委員会名（役職括弧を除去）
        committees = []
        if committee_raw:
            c_name = normalize_committee(committee_raw)
            if c_name:
                committees.append(c_name)

        # 写真を試みる（このサイトは一覧ページのみで個人ページなし）
        photo_url = ""

        member = {
            "seat_number": seat_number,
            "name": name,
            "furigana": "",
            "party": party if party not in ("無所属", "") else "",
            "faction": party if party else "",
            "committees": committees,
            "photo_url": photo_url,
        }

        print(f"  [{seat_number}] {name} / 党派: {party} / 委員会: {committee_raw}")
        members.append(member)

    if not members:
        print("  議員データを取得できませんでした")
        return

    out_path = OUTPUT_DIR / "members.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(members, f, ensure_ascii=False, indent=2)

    print(f"\n完了: {len(members)} 名 -> {out_path}")


if __name__ == "__main__":
    scrape_members()
