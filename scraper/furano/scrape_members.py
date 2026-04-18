"""
富良野市議会 議員名簿スクレイパー
出力: site/data/furano/members.json

ページ構造:
  テーブル1列: 議席順 / 顔写真 / 氏名・生年月日・会派 / 当選回数 / 自宅住所
  td[2] = "氏名 (カタカナ)\n年齢\n会派"
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.city.furano.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/shigikai/docs/9307.html"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "site" / "data" / "furano"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = Path(__file__).parent.parent.parent / "site" / "public" / "members" / "furano"
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


def katakana_to_hiragana(text: str) -> str:
    return "".join(
        chr(ord(c) - 0x60) if "ァ" <= c <= "ン" else c
        for c in text
    )


def download_photo(remote_url: str, dest_path: Path) -> bool:
    try:
        resp = requests.get(remote_url, headers=HEADERS, timeout=10)
        resp.raise_for_status()
        dest_path.write_bytes(resp.content)
        return True
    except Exception as e:
        print(f"  [PHOTO ERROR] {remote_url} -> {e}")
        return False


def scrape_members():
    print("富良野市議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return []

    table = soup.find("table")
    if table is None:
        print("  テーブルが見つかりません")
        return []

    rows = table.find_all("tr")
    print(f"  行数: {len(rows)} （ヘッダ含む）")

    members = []

    for row in rows:
        cells = row.find_all("td")
        if len(cells) < 3:
            continue

        # td[0]: 議席番号
        seat_text = cells[0].get_text(strip=True)
        if not re.match(r"^\d+$", seat_text):
            continue
        seat_number = int(seat_text)

        # td[2]: "氏名 (カタカナ)\n年齢\n会派"
        info_text = cells[2].get_text(separator="\n", strip=True)
        lines = [l.strip() for l in info_text.split("\n") if l.strip()]

        name = ""
        furigana = ""
        faction = ""

        if lines:
            # 1行目: "宮田 均 (ミヤタ ヒトシ)" のパターン
            first = lines[0]
            m = re.match(r"^(.+?)\s*[（(]([ァ-ヶーa-zA-Z\s]+)[）)]", first)
            if m:
                name = m.group(1).strip()
                furigana = katakana_to_hiragana(m.group(2).strip())
            else:
                name = first

        # 会派は最後の行（年齢行を除く）
        for line in lines[1:]:
            if not re.match(r"^\d+歳$", line):
                faction = line.strip()
                # 会派らしい文字列（クラブ、連合、未来、無会派など）か確認
                if any(kw in line for kw in ["クラブ", "連合", "未来", "無会派", "会", "議員"]):
                    faction = line.strip()
                    break

        # td[1]: 顔写真
        photo_url = ""
        img = cells[1].find("img") if len(cells) > 1 else None
        if img and img.get("src"):
            src = img["src"]
            remote_url = src if src.startswith("http") else BASE_URL + src
            ext = remote_url.split(".")[-1].split("?")[0] or "jpg"
            fname = f"seat_{seat_number}.{ext}"
            dest = PHOTO_DIR / fname
            print(f"  [{seat_number}] {name} ({furigana}) / {faction} -> 写真DL中...")
            if download_photo(remote_url, dest):
                photo_url = f"/members/furano/{fname}"
        else:
            print(f"  [{seat_number}] {name} ({furigana}) / {faction}")

        members.append({
            "seat_number": seat_number,
            "name": name,
            "furigana": furigana,
            "party": "",
            "faction": faction,
            "committees": [],
            "photo_url": photo_url,
        })

        time.sleep(0.3)

    return members


def main():
    members = scrape_members()

    if not members:
        print("議員データを取得できませんでした。")
        return

    members.sort(key=lambda m: m["seat_number"])
    out_path = OUTPUT_DIR / "members.json"
    out_path.write_text(
        json.dumps(members, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\n完了: {len(members)} 名 -> {out_path}")


if __name__ == "__main__":
    main()
