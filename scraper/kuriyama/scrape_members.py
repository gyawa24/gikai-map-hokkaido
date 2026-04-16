"""
栗山町議会 議員名簿スクレイパー
出力: data/kuriyama/members.json
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.kuriyama.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/site/gikai/29824.html"

ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = ROOT / "data" / "kuriyama"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = ROOT / "site" / "public" / "members" / "kuriyama"
PHOTO_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

# 役職・委員会として扱うキーワード。これに合致するセル値のみ committees に入れる
ROLE_KEYWORDS = ("議長", "委員", "組合議会")


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
    # 全角/半角空白と改行を除去
    return re.sub(r"[\s\u3000]+", "", text or "")


def parse_member_table(table) -> dict | None:
    tds = table.find_all("td")
    if not tds:
        return None

    # 議員番号
    seat_match = re.search(r"議員番号\s*(\d+)", normalize(tds[0].get_text()))
    if not seat_match:
        return None
    seat_number = int(seat_match.group(1))

    # 氏名とふりがな（2番目のセル）
    name_cell = normalize(tds[1].get_text())
    m = re.match(r"(.+?)[\(（](.+?)[\)）]", name_cell)
    if m:
        name = m.group(1)
        furigana = m.group(2)
    else:
        name = name_cell
        furigana = ""

    # 党派を探す（「党派」の次のセル）
    party = ""
    for i, td in enumerate(tds):
        if normalize(td.get_text()) == "党派" and i + 1 < len(tds):
            party = normalize(tds[i + 1].get_text())
            break

    # 委員会・役職セルを収集
    # 「党派」「期数」「生年月日」「議員ログ」等のラベル系と、議員番号・名前・日付・数字・PDFリンクセルを除外
    label_values = {
        "議員番号", "生年月日", "党派", "期数", "議員ログ",
        "選挙公報", "過去の一般質問", "政務活動費", "出席状況", "",
    }
    seen = set()
    committees = []
    for td in tds:
        text = normalize(td.get_text())
        if not text or text in label_values:
            continue
        # 数値のみ（期数や議員番号の値）は除外
        if re.fullmatch(r"\d+", text):
            continue
        # 生年月日
        if re.search(r"(明治|大正|昭和|平成|令和|\d{4}年)", text):
            continue
        # 氏名（カッコ付き）は除外
        if "（" in td.get_text() or "(" in td.get_text():
            continue
        # 「議員番号1」のようなセル
        if "議員番号" in text:
            continue
        # 役職・委員会っぽいものだけ追加
        if any(k in text for k in ROLE_KEYWORDS):
            if text not in seen:
                seen.add(text)
                committees.append(text)

    # 写真
    photo_url = ""
    img = table.find("img")
    if img and img.get("src"):
        src = img["src"]
        remote_url = src if src.startswith("http") else BASE_URL + src
        ext = remote_url.split(".")[-1].split("?")[0].lower() or "jpg"
        if ext not in ("jpg", "jpeg", "png", "gif", "webp"):
            ext = "jpg"
        fname = f"seat_{seat_number}.{ext}"
        try:
            img_resp = requests.get(remote_url, headers=HEADERS, timeout=10)
            img_resp.raise_for_status()
            (PHOTO_DIR / fname).write_bytes(img_resp.content)
            photo_url = f"/members/kuriyama/{fname}"
        except Exception as e:
            print(f"  [IMG ERROR] {remote_url} -> {e}")

    return {
        "seat_number": seat_number,
        "name": name,
        "furigana": furigana,
        "party": party,
        "faction": "",
        "committees": committees,
        "photo_url": photo_url,
    }


def scrape_members():
    print("栗山町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return

    tables = soup.find_all("table")
    members = []
    for table in tables:
        first_td = table.find("td")
        if not first_td:
            continue
        if "議員番号" not in normalize(first_td.get_text()):
            continue
        member = parse_member_table(table)
        if member:
            print(f"  [{member['seat_number']}] {member['name']} ({member['furigana']}) / {member['party']} / {len(member['committees'])}役職")
            members.append(member)
            time.sleep(0.3)

    members.sort(key=lambda m: m["seat_number"])

    if not members:
        print("  議員データを取得できませんでした")
        return

    out_path = OUTPUT_DIR / "members.json"
    out_path.write_text(
        json.dumps(members, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\n取得議員数: {len(members)}名")
    print(f"出力: {out_path}")


if __name__ == "__main__":
    scrape_members()
