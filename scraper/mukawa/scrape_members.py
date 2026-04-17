"""
むかわ町議会 議員名簿スクレイパー
出力: data/mukawa/members.json

公式ページ: http://www.town.mukawa.lg.jp/3043.htm
HTMLテーブルから議員情報を動的に取得する（ハードコード禁止）。
写真・ふりがなは公式ページに掲載されていないため空欄となる。
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "http://www.town.mukawa.lg.jp"
MEMBERS_URL = f"{BASE_URL}/3043.htm"

ROOT = Path(__file__).parent.parent.parent
DATA_DIR = ROOT / "data" / "mukawa"
SITE_DATA_DIR = ROOT / "site" / "data" / "mukawa"
PHOTO_DIR = ROOT / "site" / "public" / "members" / "mukawa"
DATA_DIR.mkdir(parents=True, exist_ok=True)
SITE_DATA_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

# 「所属委員会」列に含まれがちな常任・特別委員会名。これらを検出して委員会リストに分解する。
COMMITTEE_KEYWORDS = ("委員会",)

# 「役職等」列に入るが議員の役職として扱うべきキーワード（議長・副議長など）
LEADERSHIP_KEYWORDS = ("議長", "副議長")


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
    # 全角/半角スペースを1個に畳む
    return re.sub(r"[\s\u3000]+", " ", text).strip()


def split_committee_cell(text: str) -> list[str]:
    """「総務厚生常任委員会 副委員長 議会運営委員会」のような文字列を
    ["総務厚生常任委員会 副委員長", "議会運営委員会"] のように分解する。

    原文は「委員会名 役職 委員会名 役職 …」の順に並んでおり、役職トークンは
    直前の委員会に紐付けて結合する。
    """
    text = normalize_name(text)
    if not text:
        return []
    role_pattern = re.compile(r"^(副?委員長|委員)$")
    result: list[str] = []
    for tok in text.split():
        if tok.endswith("委員会"):
            result.append(tok)
        elif result and role_pattern.match(tok):
            result[-1] = f"{result[-1]} {tok}"
        else:
            # 想定外のトークン（単独項目）。そのまま追加してログに残す。
            result.append(tok)
    return result


def parse_members(soup: BeautifulSoup) -> list[dict]:
    table = soup.find("table")
    if not table:
        return []

    rows = table.find_all("tr")
    if len(rows) < 2:
        return []

    # ヘッダー確認
    header_cells = [c.get_text(strip=True) for c in rows[0].find_all(["th", "td"])]
    expected = ["議席", "氏名", "所属政党", "所属委員会", "役職等"]
    if header_cells != expected:
        print(f"  [WARN] 予期しないヘッダー: {header_cells}")

    members = []
    for row in rows[1:]:
        cells = row.find_all(["th", "td"])
        if len(cells) < 5:
            continue

        seat_text = normalize_name(cells[0].get_text(" ", strip=True))
        name_text = normalize_name(cells[1].get_text(" ", strip=True))
        party_text = normalize_name(cells[2].get_text(" ", strip=True))
        committee_text = normalize_name(cells[3].get_text(" ", strip=True))
        role_text = normalize_name(cells[4].get_text(" ", strip=True))

        if not seat_text or not name_text:
            continue

        try:
            seat_number = int(seat_text)
        except ValueError:
            continue

        committees = split_committee_cell(committee_text)

        # 役職列から議長・副議長を抽出して faction とは別に保持
        role_items = [r.strip() for r in re.split(r"\s+", role_text) if r.strip()]
        leadership = [r for r in role_items if r in LEADERSHIP_KEYWORDS]
        other_roles = [r for r in role_items if r not in LEADERSHIP_KEYWORDS]

        faction = " / ".join(leadership) if leadership else ""

        members.append(
            {
                "seat_number": seat_number,
                "name": name_text,
                "furigana": "",
                "party": party_text,
                "faction": faction,
                "committees": committees,
                "positions": other_roles,
                "photo_url": "",
            }
        )

    return members


def scrape():
    print("むかわ町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return

    members = parse_members(soup)
    if not members:
        print("  議員情報を抽出できませんでした")
        return

    print(f"  議員 {len(members)} 名を抽出")

    out_payload = {
        "source_url": MEMBERS_URL,
        "fetched_at": time.strftime("%Y-%m-%d"),
        "members": members,
    }

    for out_dir in (DATA_DIR, SITE_DATA_DIR):
        out_file = out_dir / "members.json"
        out_file.write_text(
            json.dumps(out_payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"  書き込み: {out_file}")

    for m in members:
        print(f"  [{m['seat_number']:>2}] {m['name']} / {m['party']} / {'・'.join(m['committees'])}")


if __name__ == "__main__":
    scrape()
