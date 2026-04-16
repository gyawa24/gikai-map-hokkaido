"""
稚内市議会 議員名簿スクレイパー
出力: data/wakkanai/members.json

ページ構造:
  - 議員一覧は1ページに全員掲載（個別ページなし）
  - 各議員: h2.pagetitle_a3（氏名）、div.box_2col_3_7（写真＋テーブル）
  - テーブル行: 会派・所属名 / 当選回数 / 所属委員会
  - ふりがなは掲載なし
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.city.wakkanai.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/gikai/kousei/meibo/"
ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = ROOT / "data" / "wakkanai"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = ROOT / "site" / "public" / "members" / "wakkanai"
PHOTO_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

# 委員会として認識するキーワード
COMMITTEE_PATTERN = re.compile(r"常任委員会|特別委員会|議会運営委員会")

# 委員会以外（役職）のキーワード
ROLE_PATTERN = re.compile(r"^(議長|副議長)$")


def fetch(url: str) -> BeautifulSoup | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def download_photo(src: str, seat: int) -> str:
    """写真をダウンロードしてローカルパスを返す。失敗時は空文字。"""
    remote_url = src if src.startswith("http") else BASE_URL + src
    ext = remote_url.split(".")[-1].split("?")[0] or "jpg"
    fname = f"seat_{seat}.{ext}"
    try:
        img_resp = requests.get(remote_url, headers=HEADERS, timeout=10)
        img_resp.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(img_resp.content)
        print(f"    写真保存: {fname}")
        return f"/members/wakkanai/{fname}"
    except Exception as e:
        print(f"  [WARN] 写真取得失敗 seat {seat}: {e}")
        return ""


def parse_committee_cell(td) -> tuple[list[str], str]:
    """
    所属委員会セルから委員会リストと役職を抽出する。
    <br> で複数行に分かれている場合もある。
    returns (committees, role)
    """
    # br を改行に変換してテキスト取得
    for br in td.find_all("br"):
        br.replace_with("\n")
    text = td.get_text("\n")

    committees = []
    role = ""
    for line in text.split("\n"):
        line = line.strip()
        if not line:
            continue
        if COMMITTEE_PATTERN.search(line):
            committees.append(line)
        elif ROLE_PATTERN.search(line):
            role = line
    return committees, role


def scrape_members():
    print("稚内市議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return

    members = []

    # 議員名はすべて h2.pagetitle_a3
    member_h2s = soup.find_all("h2", class_="pagetitle_a3")
    # 「お問い合わせ」「マイリスト」など非議員のh2を除外（漢字名前パターンで絞り込む）
    member_h2s = [
        h for h in member_h2s
        if re.search(r"[\u4e00-\u9fff]", h.get_text())
        and not re.search(r"名簿|一覧|議会|問い合わせ|リスト", h.get_text())
        and len(h.get_text(strip=True)) <= 15
    ]

    print(f"  議員 {len(member_h2s)} 名発見")

    for i, h2 in enumerate(member_h2s):
        seat = i + 1
        # 全角スペース（　）を半角スペースに統一
        name = h2.get_text(strip=True).replace("\u3000", " ")
        print(f"  [{seat}] {name}")

        member = {
            "seat_number": seat,
            "name": name,
            "furigana": "",
            "party": "",
            "faction": "",
            "committees": [],
            "photo_url": "",
        }

        # 直後の兄弟divを探す
        info_div = h2.find_next_sibling("div")
        if info_div is None:
            members.append(member)
            continue

        # 写真
        img = info_div.find("img")
        if img and img.get("src"):
            member["photo_url"] = download_photo(img["src"], seat)
            time.sleep(0.3)

        # テーブルから会派・委員会を取得
        table = info_div.find("table")
        if table:
            for row in table.find_all("tr"):
                th = row.find("th")
                td = row.find("td")
                if not th or not td:
                    continue
                label = th.get_text(strip=True)
                if "会派" in label or "所属名" in label:
                    member["faction"] = td.get_text(strip=True)
                elif "所属委員会" in label:
                    committees, _role = parse_committee_cell(td)
                    member["committees"] = committees

        members.append(member)

    if members:
        out_path = OUTPUT_DIR / "members.json"
        out_path.write_text(
            json.dumps(members, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"\n-> 保存: {out_path} ({len(members)}名)")
    else:
        print("  議員データが取得できませんでした。ページ構造を再確認してください。")
        print(f"  対象URL: {MEMBERS_URL}")


if __name__ == "__main__":
    scrape_members()
