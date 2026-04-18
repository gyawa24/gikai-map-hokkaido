"""
和寒町議会 議員名簿スクレイパー
出力: site/data/wassamu/members.json

テーブル列構成: 写真 | 氏名・ふりがな | 役職 | 議席番号 | 期数
"""

import json
import re
import unicodedata
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.wassamu.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/congress-secretariat/member-introduction/"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "site" / "data" / "wassamu"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = Path(__file__).parent.parent.parent / "site" / "public" / "members" / "wassamu"
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


def normalize(text: str) -> str:
    """全角数字・スペースを正規化する。"""
    return unicodedata.normalize("NFKC", text).strip()


def split_furigana_name(cell_text: str) -> tuple[str, str]:
    """
    「おのだ　くみこ小野田 久美子」のようなテキストから
    ふりがなと氏名を分離する。
    ひらがな部分がふりがな、漢字部分が氏名。
    """
    text = normalize(cell_text)
    # ひらがな連続部分と漢字・カタカナ連続部分を分ける
    furigana_match = re.match(r"^([ぁ-ん\s　]+)", text)
    if furigana_match:
        furigana = re.sub(r"\s+", " ", furigana_match.group(1)).strip()
        name_part = text[furigana_match.end():].strip()
        name = re.sub(r"\s+", "", name_part)
        return furigana, name
    return "", re.sub(r"\s+", "", text)


def parse_committees(role_text: str) -> list[str]:
    """役職テキストから委員会リストを抽出する。"""
    text = normalize(role_text)
    if not text:
        return []
    return [p.strip() for p in re.split(r"[、,，\n]", text) if p.strip()]


def download_photo(img_tag, seat_number: int) -> str:
    if not img_tag or not img_tag.get("src"):
        return ""
    src = img_tag["src"]
    remote_url = src if src.startswith("http") else BASE_URL + src
    ext = remote_url.split(".")[-1].split("?")[0] or "jpg"
    fname = f"seat_{seat_number}.{ext}"
    try:
        resp = requests.get(remote_url, headers=HEADERS, timeout=10)
        resp.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(resp.content)
        print(f"    写真保存: {fname}")
        return f"/members/wassamu/{fname}"
    except Exception as e:
        print(f"    写真取得失敗: {e}")
        return ""


def scrape_members():
    print("和寒町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return

    members = []

    tables = soup.find_all("table")
    if not tables:
        print("  テーブルが見つかりません。取得不可。")
        return

    for table in tables:
        rows = table.find_all("tr")
        for row in rows:
            cells = row.find_all(["td", "th"])
            # 列構成: 写真(0) | 氏名・ふりがな(1) | 役職(2) | 議席番号(3) | 期数(4)
            if len(cells) < 4:
                continue

            # ヘッダー行をスキップ
            header_keywords = {"氏名", "名前", "議員名", ""}
            if cells[1].name == "th" or normalize(cells[1].get_text()) in header_keywords:
                continue

            # 議席番号 (列3)
            seat_str = normalize(cells[3].get_text(strip=True))
            seat_number = int(seat_str) if re.match(r"^\d+$", seat_str) else 0
            if seat_number == 0:
                continue

            # 氏名・ふりがな (列1)
            name_cell_text = cells[1].get_text(separator=" ", strip=True)
            furigana, name = split_furigana_name(name_cell_text)

            if not name or len(name) < 2:
                continue

            # 役職 (列2)
            role_text = cells[2].get_text(separator="、", strip=True)
            committees = parse_committees(role_text)

            # 写真 (列0)
            img = cells[0].find("img")
            photo_url = download_photo(img, seat_number)

            member = {
                "seat_number": seat_number,
                "name": name,
                "furigana": furigana,
                "party": "",
                "faction": "",
                "committees": committees,
                "photo_url": photo_url,
            }
            members.append(member)
            print(f"  [{seat_number}] {name}（{furigana}）{committees}")

    if not members:
        print("  議員データが取得できませんでした。取得不可。")
        return

    members.sort(key=lambda m: m["seat_number"])

    out_path = OUTPUT_DIR / "members.json"
    out_path.write_text(json.dumps(members, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n完了: {len(members)}名 -> {out_path}")
    return members


if __name__ == "__main__":
    scrape_members()
