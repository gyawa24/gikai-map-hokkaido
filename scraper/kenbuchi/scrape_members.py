"""
剣淵町議会 議員名簿スクレイパー
出力: site/data/kenbuchi/members.json

テーブル列構成:
  0: 議席番号
  1: ふりがな + 氏名 (+ 写真)
  2: 期数
  3: 党派
  4: 生年月日
  5: 職業
  6: 役職（委員会・議長等、・区切り）
"""

import json
import re
import unicodedata
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.kembuchi.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/gikai/%E7%94%BA%E8%AD%B0%E4%BC%9A/"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "site" / "data" / "kenbuchi"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = Path(__file__).parent.parent.parent / "site" / "public" / "members" / "kenbuchi"
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
    return unicodedata.normalize("NFKC", text).strip()


def split_furigana_name(cell_text: str) -> tuple[str, str]:
    """「さおとめ　てるたか 早乙女 晃隆」→ ("さおとめ てるたか", "早乙女晃隆")"""
    text = normalize(cell_text)
    furigana_match = re.match(r"^([ぁ-ん\s　]+)", text)
    if furigana_match:
        furigana = re.sub(r"\s+", " ", furigana_match.group(1)).strip()
        name_part = text[furigana_match.end():].strip()
        name = re.sub(r"\s+", "", name_part)
        return furigana, name
    return "", re.sub(r"\s+", "", text)


def parse_committees(role_text: str) -> list[str]:
    """「・議会運営委員 ・総務厚生常任委員 ...」から委員会・役職を抽出する。"""
    text = normalize(role_text)
    if not text:
        return []
    # ・区切り（全角・半角どちらも）
    parts = re.split(r"[・･]", text)
    return [p.strip() for p in parts if p.strip()]


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
        return f"/members/kenbuchi/{fname}"
    except Exception as e:
        print(f"    写真取得失敗: {e}")
        return ""


def scrape_members():
    print("剣淵町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return

    table = soup.find("table")
    if table is None:
        print("  テーブルが見つかりません。取得不可。")
        return

    members = []
    for row in table.find_all("tr"):
        cells = row.find_all(["td", "th"])
        if len(cells) < 7:
            continue

        # ヘッダー行スキップ
        seat_str = normalize(cells[0].get_text(strip=True))
        if not re.match(r"^\d+$", seat_str):
            continue
        seat_number = int(seat_str)

        # 欠番スキップ
        name_cell_text = cells[1].get_text(separator=" ", strip=True)
        if "欠番" in name_cell_text or not name_cell_text.strip():
            print(f"  [{seat_number}] 欠番 - スキップ")
            continue

        furigana, name = split_furigana_name(name_cell_text)
        if not name or len(name) < 2:
            continue

        party = normalize(cells[3].get_text(strip=True))
        role_text = cells[6].get_text(separator=" ", strip=True)
        committees = parse_committees(role_text)

        img = cells[1].find("img")
        photo_url = download_photo(img, seat_number)

        member = {
            "seat_number": seat_number,
            "name": name,
            "furigana": furigana,
            "party": party,
            "faction": party,
            "committees": committees,
            "photo_url": photo_url,
        }
        members.append(member)
        print(f"  [{seat_number}] {name}（{furigana}）{party} {committees}")

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
