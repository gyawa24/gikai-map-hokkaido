"""
壮瞥町議会 議員名簿スクレイパー
出力: data/sobetsu/members.json および site/data/sobetsu/members.json
"""

import json
import re
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.sobetsu.lg.jp"
MEMBERS_URL = f"{BASE_URL}/gikai.html"

ROOT = Path(__file__).parent.parent.parent
DATA_DIR = ROOT / "data" / "sobetsu"
SITE_DATA_DIR = ROOT / "site" / "data" / "sobetsu"
PHOTO_DIR = ROOT / "site" / "public" / "members" / "sobetsu"
for d in (DATA_DIR, SITE_DATA_DIR, PHOTO_DIR):
    d.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

# 議員一覧テーブルだけが持つヘッダ列を識別子に使う
EXPECTED_HEADER_KEYS = {"職名", "氏名", "在職期間"}


def fetch(url: str) -> BeautifulSoup | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def normalize(text: str) -> str:
    return re.sub(r"\s+", "", text or "")


def find_members_table(soup: BeautifulSoup):
    for table in soup.find_all("table"):
        first_row = table.find("tr")
        if not first_row:
            continue
        headers = {normalize(c.get_text()) for c in first_row.find_all(["th", "td"])}
        if EXPECTED_HEADER_KEYS.issubset(headers):
            return table
    return None


def parse_committees(text: str) -> list[str]:
    if not text:
        return []
    parts = re.split(r"[・,、，]", text)
    return [p.strip() for p in parts if p.strip()]


def parse_extra_roles(text: str) -> list[str]:
    if not text:
        return []
    # 改行や全角空白で複数役職が並ぶことがある
    parts = re.split(r"[\s　]+", text)
    return [p.strip() for p in parts if p.strip()]


def normalize_name(text: str) -> str:
    # 「森 太郎」「森　太郎」のような姓名間の空白を1つの半角スペースに
    cleaned = re.sub(r"\s+", " ", text or "").strip()
    return cleaned


def scrape_members():
    print("壮瞥町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return

    table = find_members_table(soup)
    if table is None:
        print("  議員一覧テーブルが見つかりません（HTML構造変更の可能性）")
        return

    rows = table.find_all("tr")
    if len(rows) < 2:
        print("  議員行が見つかりません")
        return

    # ヘッダ行から列インデックスを決定（順序変更耐性）
    header_cells = [normalize(c.get_text()) for c in rows[0].find_all(["th", "td"])]

    def col(name: str) -> int | None:
        for i, h in enumerate(header_cells):
            if name in h:
                return i
        return None

    idx_role = col("職名")
    idx_name = col("氏名")
    idx_term = col("在職期間")
    idx_committee = col("所属委員会")
    idx_extra = col("役職")

    members = []
    for i, row in enumerate(rows[1:], start=1):
        cells = row.find_all(["th", "td"])
        if len(cells) < 2:
            continue

        def cell(idx):
            if idx is None or idx >= len(cells):
                return ""
            return cells[idx].get_text(" ", strip=True)

        name = normalize_name(cell(idx_name))
        if not name:
            continue

        role = cell(idx_role).strip()
        committees = parse_committees(cell(idx_committee))
        extra_roles = parse_extra_roles(cell(idx_extra))
        term = cell(idx_term).strip()

        # 議長・副議長等の役職を会派ではなく committees に追加
        # （壮瞥町は会派情報を公開していないため faction/party は空）
        role_tags = []
        if role and role != "議員":
            role_tags.append(role)
        role_tags.extend(extra_roles)

        member = {
            "seat_number": i,
            "name": name,
            "furigana": "",
            "party": "",
            "faction": "",
            "committees": committees,
            "role": role,
            "extra_roles": extra_roles,
            "term": term,
            "photo_url": "",
        }
        members.append(member)
        print(f"  [{i}] {name} ({role}) 委員会={committees} 役職={extra_roles}")

    if not members:
        print("  議員データが取得できませんでした")
        return

    payload = {
        "source_url": MEMBERS_URL,
        "members": members,
    }

    for path in (DATA_DIR / "members.json", SITE_DATA_DIR / "members.json"):
        path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"  書き出し: {path}")

    print(f"取得議員数: {len(members)}名")


if __name__ == "__main__":
    scrape_members()
