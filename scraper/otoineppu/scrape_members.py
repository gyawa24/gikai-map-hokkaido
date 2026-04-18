"""
音威子府村議会 議員名簿スクレイパー
出力: data/otoineppu/members.json
"""

import json
import re
import time
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.vill.otoineppu.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/kakuka/gikaijimu/"

REPO_ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = REPO_ROOT / "data" / "otoineppu"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
SITE_OUTPUT_DIR = REPO_ROOT / "site" / "data" / "otoineppu"
SITE_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = REPO_ROOT / "site" / "public" / "members" / "otoineppu"
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


def download_photo(url: str, seat_number: int) -> str:
    ext = url.split(".")[-1].split("?")[0].lower() or "jpg"
    if ext.lower() == "jpeg":
        ext = "jpg"
    fname = f"seat_{seat_number}.{ext}"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(resp.content)
        return f"/members/otoineppu/{fname}"
    except Exception as e:
        print(f"  [WARN] 写真取得失敗 {url} -> {e}")
        return ""


# 氏名とふりがなを分離。例: "杉山　均（すぎやま　ひとし）" -> ("杉山 均", "すぎやま ひとし")
NAME_RE = re.compile(r"^(.+?)\s*[（(]\s*(.+?)\s*[)）]\s*$")
# "議席番号3番" など先頭のラベル除去
SEAT_LABEL_RE = re.compile(r"^議席番号\s*(\d+)\s*番\s*")


def parse_member_cell(cell_text: str) -> tuple[int | None, str, str]:
    """先頭セルから (seat_number, 氏名, ふりがな) を抽出"""
    text = cell_text.strip()
    m = SEAT_LABEL_RE.match(text)
    seat = int(m.group(1)) if m else None
    rest = SEAT_LABEL_RE.sub("", text).strip()
    nm = NAME_RE.match(rest)
    if nm:
        name = re.sub(r"\s+", " ", nm.group(1)).strip()
        furigana = re.sub(r"\s+", " ", nm.group(2)).strip()
    else:
        name = re.sub(r"\s+", " ", rest).strip()
        furigana = ""
    return seat, name, furigana


def parse_committees(text: str) -> list[str]:
    """役職セルから委員会・役職リストを抽出。
    HTML上では「・」が項目の区切りで、改行は1項目内の折り返し表示。
    そのため「・」のみを区切り文字として扱い、項目内の改行は結合する。"""
    if not text:
        return []
    parts = text.split("・")
    items = []
    for p in parts:
        s = re.sub(r"\s+", "", p).strip()
        if s:
            items.append(s)
    return items


def scrape_members():
    print("音威子府村議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return

    table = soup.find("table")
    if table is None:
        print("  [ERROR] 議員一覧テーブルが見つかりません")
        return

    rows = table.find_all("tr")
    if len(rows) < 2:
        print("  [ERROR] テーブルの行数が不足")
        return

    members = []
    for row in rows[1:]:  # ヘッダー行を除く
        cells = row.find_all(["th", "td"])
        if not cells:
            continue
        first_text = cells[0].get_text(" ", strip=True)
        seat, name, furigana = parse_member_cell(first_text)
        if seat is None:
            continue
        # 欠員行はスキップ
        if "欠員" in first_text or not name or "欠員" in name:
            print(f"  議席{seat}: 欠員（スキップ）")
            continue

        party = cells[2].get_text(" ", strip=True) if len(cells) > 2 else ""
        role_text = cells[5].get_text("\n", strip=True) if len(cells) > 5 else ""
        committees = parse_committees(role_text)

        # 写真（先頭セル内のimg）
        photo_url = ""
        img = cells[0].find("img")
        if img and img.get("src"):
            src = img["src"]
            remote = urljoin(MEMBERS_URL, src)
            photo_url = download_photo(remote, seat)
            time.sleep(0.3)

        member = {
            "seat_number": seat,
            "name": name,
            "furigana": furigana,
            "party": party,
            "faction": "",
            "committees": committees,
            "photo_url": photo_url,
        }
        members.append(member)
        print(f"  議席{seat}: {name} ({furigana}) / {party} / 役職{len(committees)}件")

    if not members:
        print("  [ERROR] 議員を抽出できませんでした")
        return

    members.sort(key=lambda m: m["seat_number"])

    out_path = OUTPUT_DIR / "members.json"
    site_out_path = SITE_OUTPUT_DIR / "members.json"
    payload = json.dumps(members, ensure_ascii=False, indent=2)
    out_path.write_text(payload, encoding="utf-8")
    site_out_path.write_text(payload, encoding="utf-8")
    print(f"  -> {out_path} ({len(members)}名)")
    print(f"  -> {site_out_path}")


if __name__ == "__main__":
    scrape_members()
