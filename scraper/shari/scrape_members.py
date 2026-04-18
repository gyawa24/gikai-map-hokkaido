"""
斜里町議会 議員名簿スクレイパー
出力: data/shari/members.json
"""

import json
import re
import time
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

BASE_URL = "http://gikai-sharitown.net/"
MEMBERS_URL = urljoin(BASE_URL, "meibo.html")

ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = ROOT / "data" / "shari"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = ROOT / "site" / "public" / "members" / "shari"
PHOTO_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def fetch_html(url: str) -> BeautifulSoup | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=30)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding or "utf-8"
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def parse_committees(text: str) -> tuple[list[str], str]:
    """
    "委員会／..." 部分から委員会リストを抽出。
    ◎ は委員長、○ は副委員長を示す（HTMLの凡例より）。
    また「副議長」「議長」が末尾に付く場合がある。
    """
    role = ""
    committees: list[str] = []
    if "議長" in text and "副議長" not in text:
        role = "議長"
    if "副議長" in text:
        role = "副議長"

    m = re.search(r"委員会／(.+)", text)
    if not m:
        return committees, role
    raw = m.group(1)
    raw = raw.replace("副議長", "")
    parts = re.split(r"[、,，・\s]+", raw)
    for p in parts:
        p = p.strip()
        if not p:
            continue
        # 役職マーカーを取り除き、委員会名のみ
        clean = p.lstrip("◎○●◯")
        if clean:
            committees.append(clean)
    return committees, role


def parse_member_cell(text: str) -> dict | None:
    """
    "氏名／○○ 住所／○○ 年齢／○○歳 当選回数／○ 委員会／..." からフィールド抽出。
    """
    text = re.sub(r"\s+", " ", text).strip()
    if "氏名／" not in text:
        return None

    name_m = re.search(r"氏名／([^\s住年当委議副]+(?:\s[^\s住年当委議副]+)?)", text)
    name = ""
    if name_m:
        name = name_m.group(1).replace("\u3000", " ").strip()

    # よりロバストに: 「氏名／」の直後から「住所／」の直前まで
    block_m = re.search(r"氏名／(.+?)(?=\s*住所／|\s*年齢／|\s*当選|\s*委員会|\s*議長|\s*副議長|$)", text)
    if block_m:
        name = block_m.group(1).replace("\u3000", " ").strip()

    committees, role = parse_committees(text)

    return {
        "name": name,
        "committees": committees,
        "role": role,
    }


def download_photo(remote_url: str, seat: int) -> str:
    ext = remote_url.rsplit(".", 1)[-1].split("?")[0].lower() or "jpg"
    if ext not in ("jpg", "jpeg", "png", "gif", "webp"):
        ext = "jpg"
    fname = f"seat_{seat}.{ext}"
    try:
        r = requests.get(remote_url, headers=HEADERS, timeout=20)
        r.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(r.content)
        return f"/members/shari/{fname}"
    except Exception as e:
        print(f"  [WARN] photo {remote_url} -> {e}")
        return ""


def scrape() -> None:
    print(f"斜里町議会 議員名簿を収集中... {MEMBERS_URL}")
    soup = fetch_html(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return

    table = soup.find("table")
    if table is None:
        print("  テーブルが見つかりません")
        return

    members: list[dict] = []
    seat = 0
    for row in table.find_all("tr"):
        cells = row.find_all(["td", "th"])
        # cells は [img, info, img, info] の繰り返しを想定
        i = 0
        while i < len(cells) - 1:
            img_cell = cells[i]
            info_cell = cells[i + 1]
            i += 2

            text = info_cell.get_text(" ", strip=True)
            if "氏名／" not in text:
                continue

            seat += 1
            parsed = parse_member_cell(text)
            if parsed is None or not parsed.get("name"):
                print(f"  [WARN] seat {seat}: 名前抽出失敗 text={text!r}")
                continue

            img = img_cell.find("img")
            photo_url = ""
            if img and img.get("src"):
                remote = urljoin(MEMBERS_URL, img["src"])
                time.sleep(0.3)
                photo_url = download_photo(remote, seat)

            member = {
                "seat_number": seat,
                "name": parsed["name"],
                "furigana": "",
                "party": "",
                "faction": "",
                "committees": parsed["committees"],
                "photo_url": photo_url,
            }
            if parsed.get("role"):
                member["role"] = parsed["role"]
            members.append(member)
            print(f"  [{seat}] {member['name']} 委員会={member['committees']} 役職={parsed.get('role','')}")

    if not members:
        print("  議員データが抽出できませんでした")
        return

    out_path = OUTPUT_DIR / "members.json"
    out_path.write_text(
        json.dumps(members, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\n  -> {out_path} ({len(members)}名)")


if __name__ == "__main__":
    scrape()
