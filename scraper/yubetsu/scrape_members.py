"""
湧別町議会 議員名簿スクレイパー

公式議会ページ:
  https://www.town.yubetsu.lg.jp/administration/town/detail.html?content=15

各議員は <div class="c-pouring"> 単位で
  - <figure class="c-pouring_img"><img src="..."></figure> に写真
  - <p class="c-pouring_txt"> に「氏名（ふりがな）」と議席番号・党派・職業・期数・所属委員会
をテキストで保持している。

出力: site/data/yubetsu/members.json
写真: site/public/members/yubetsu/seat_N.<ext>
"""

import json
import re
import sys
import time
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.yubetsu.lg.jp"
MEMBERS_URL = f"{BASE_URL}/administration/town/detail.html?content=15"

ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = ROOT / "site" / "data" / "yubetsu"
PHOTO_DIR = ROOT / "site" / "public" / "members" / "yubetsu"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

ZEN2HAN = str.maketrans("０１２３４５６７８９", "0123456789")

NAME_FURIGANA_RE = re.compile(r"^\s*(\S+?)\s*（\s*([ぁ-んー\s]+?)\s*）\s*$")
SEAT_RE = re.compile(r"議席番号\s*[:：]\s*(\S+)")
PARTY_RE = re.compile(r"党派\s*[:：]\s*(\S+)")
COMMITTEE_RE = re.compile(r"所属委員会\s*[:：]\s*(.+)$")

# 委員会名の区切り（全角読点）。役職カッコはそのまま残す。
COMMITTEE_SPLIT_RE = re.compile(r"[、,]")


def fetch_html(url: str) -> BeautifulSoup:
    resp = requests.get(url, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding
    return BeautifulSoup(resp.text, "html.parser")


def parse_lines(p_tag) -> list[str]:
    """<br> を改行として <p> の中身を行リスト化。"""
    # get_text(separator='\n') で <br> が改行になる
    text = p_tag.get_text(separator="\n")
    return [ln.strip() for ln in text.splitlines() if ln.strip()]


def parse_member(pouring_div) -> dict | None:
    p = pouring_div.find("p", class_="c-pouring_txt")
    if p is None:
        return None
    lines = parse_lines(p)
    if not lines:
        return None

    # 1行目: 氏名（ふりがな）
    m = NAME_FURIGANA_RE.match(lines[0])
    if not m:
        return None
    name = m.group(1)
    furigana = re.sub(r"\s+", " ", m.group(2)).strip()

    seat: int | None = None
    party = ""
    committees: list[str] = []

    for ln in lines[1:]:
        if (sm := SEAT_RE.search(ln)):
            try:
                seat = int(sm.group(1).translate(ZEN2HAN))
            except ValueError:
                pass
        elif (pm := PARTY_RE.search(ln)):
            party = pm.group(1).strip()
        elif (cm := COMMITTEE_RE.search(ln)):
            raw = cm.group(1).strip()
            committees = [c.strip() for c in COMMITTEE_SPLIT_RE.split(raw) if c.strip()]

    if seat is None:
        return None

    # 写真
    photo_url = ""
    img = pouring_div.find("img")
    if img and img.get("src"):
        remote = urljoin(MEMBERS_URL, img["src"])
        ext = remote.split("?")[0].rsplit(".", 1)[-1].lower()
        if ext not in ("jpg", "jpeg", "png", "gif", "webp"):
            ext = "jpg"
        fname = f"seat_{seat}.{ext}"
        try:
            r = requests.get(remote, headers=HEADERS, timeout=15)
            r.raise_for_status()
            (PHOTO_DIR / fname).write_bytes(r.content)
            photo_url = f"/members/yubetsu/{fname}"
        except Exception as e:
            print(f"    [WARN] 写真取得失敗 {remote} -> {e}")

    return {
        "seat_number": seat,
        "name": name,
        "furigana": furigana,
        "party": party,
        "faction": party,  # 全議員無所属のため会派=党派相当。後段UI互換のため埋める。
        "committees": committees,
        "photo_url": photo_url,
    }


def main() -> int:
    print("湧別町議会 議員名簿を収集中...")
    soup = fetch_html(MEMBERS_URL)

    blocks = soup.find_all("div", class_="c-pouring")
    print(f"  議員ブロック {len(blocks)} 件発見")

    members: list[dict] = []
    for i, blk in enumerate(blocks):
        mem = parse_member(blk)
        if mem is None:
            continue
        members.append(mem)
        print(f"    [{i+1}] 議席{mem['seat_number']:>2} {mem['name']} ({mem['furigana']})")
        time.sleep(0.3)

    if not members:
        print("  [ERROR] 議員データを抽出できませんでした")
        return 1

    members.sort(key=lambda m: m["seat_number"])

    out = OUTPUT_DIR / "members.json"
    out.write_text(
        json.dumps(members, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"  出力: {out}")
    print(f"取得議員数: {len(members)}名")
    return 0


if __name__ == "__main__":
    sys.exit(main())
