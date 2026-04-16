"""
根室市議会 議員名簿スクレイパー
出力: data/nemuro/members.json

ページ構造:
- h2タグ: 「氏名（ふりがな）」
- img src: //www.city.nemuro.hokkaido.jp/... (protocol-relative)
- grandparent div テキスト: 「議席番号 N|会派 X|当選回数 N」
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.city.nemuro.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/lifeinfo/kakuka/gikai/nemuroshigi/giinsyoukai/1432.html"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "data" / "nemuro"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = Path(__file__).parent.parent.parent / "site" / "public" / "members" / "nemuro"
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


def resolve_url(src: str) -> str:
    """protocol-relative URL を https に変換"""
    if src.startswith("//"):
        return "https:" + src
    elif src.startswith("/"):
        return BASE_URL + src
    elif src.startswith("http"):
        return src
    else:
        return BASE_URL + "/" + src


def download_photo(remote_url: str, fname: str) -> str:
    try:
        img_resp = requests.get(remote_url, headers=HEADERS, timeout=10)
        img_resp.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(img_resp.content)
        return f"/members/nemuro/{fname}"
    except Exception as e:
        print(f"  [WARN] 写真取得失敗 {remote_url} -> {e}")
        return ""


def scrape_members():
    print("根室市議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return []

    members = []

    # 画像を起点に各議員ブロックを処理
    imgs = soup.find_all("img", src=lambda s: s and "group/27" in s)
    print(f"  議員画像 {len(imgs)} 件発見")

    for img in imgs:
        # grandparent div からプロフィールテキストを取得
        gp = img.parent.parent if img.parent else None
        if gp is None:
            continue

        gp_text = gp.get_text(separator="\n", strip=True)

        # 議席番号
        seat_m = re.search(r"議席番号[\s\u3000]+(\d+)", gp_text)
        seat_num = int(seat_m.group(1)) if seat_m else 0

        # 会派
        faction_m = re.search(r"会[\s\u3000]*派[\s\u3000]+(.+?)(?:\n|当選|$)", gp_text)
        faction = faction_m.group(1).strip().replace("\u3000", "").replace(" ", "") if faction_m else ""

        # h2 から名前とふりがなを取得（gp の直前のh2を使う）
        name = ""
        furigana = ""

        h2 = None
        for el in gp.find_all_previous("h2", limit=1):
            h2 = el
            break

        if h2:
            h2_text = h2.get_text(strip=True)
            # 「氏名（ふりがな）」パターン
            name_m = re.match(r"^(.+?)（(.+?)）", h2_text)
            if name_m:
                name = name_m.group(1).strip().replace("\u3000", " ").replace("　", " ")
                furigana = name_m.group(2).strip().replace("\u3000", " ").replace("　", " ")
            else:
                name = h2_text.strip()

        # 写真ダウンロード
        src = img.get("src", "")
        remote_url = resolve_url(src)
        ext = remote_url.split(".")[-1].split("?")[0].lower()
        if ext not in ("jpg", "jpeg", "png", "gif", "webp"):
            ext = "jpg"
        fname = f"seat_{seat_num}.{ext}"
        print(f"  [{seat_num}] {name} ({furigana}) 会派: {faction}")
        photo_url = download_photo(remote_url, fname)
        time.sleep(0.3)

        member = {
            "seat_number": seat_num,
            "name": name,
            "furigana": furigana,
            "party": "",
            "faction": faction,
            "committees": [],
            "photo_url": photo_url,
        }
        members.append(member)

    return members


def main():
    members = scrape_members()

    if not members:
        print("議員データが取得できませんでした")
        return

    # seat_number でソート
    members.sort(key=lambda m: m["seat_number"])

    output_path = OUTPUT_DIR / "members.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(members, f, ensure_ascii=False, indent=2)

    print(f"\n完了: {len(members)} 名を {output_path} に保存")
    print(f"取得議員数: {len(members)}名")


if __name__ == "__main__":
    main()
