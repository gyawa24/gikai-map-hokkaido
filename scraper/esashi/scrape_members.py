"""
江差町議会 議員名簿スクレイパー
出力: data/esashi/members.json
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.hokkaido-esashi.jp"
MEMBERS_URL = f"{BASE_URL}/gikai/meibo/itiran.html"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "data" / "esashi"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = Path(__file__).parent.parent.parent / "site" / "public" / "members" / "esashi"
PHOTO_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def fetch_soup(url: str, encoding: str = "cp932") -> BeautifulSoup | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        resp.encoding = encoding
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def download_photo(remote_url: str, local_path: Path, retries: int = 2) -> bool:
    for attempt in range(retries + 1):
        try:
            resp = requests.get(remote_url, headers=HEADERS, timeout=15)
            resp.raise_for_status()
            local_path.write_bytes(resp.content)
            return True
        except Exception as e:
            if attempt < retries:
                print(f"    [PHOTO RETRY {attempt+1}] {remote_url}")
                time.sleep(1)
            else:
                print(f"    [PHOTO ERROR] {remote_url} -> {e}")
    return False


def normalize(text: str) -> str:
    """全角スペースや連続スペースを整理"""
    return re.sub(r"[\u3000\s]+", " ", text).strip()


def scrape_members():
    print("江差町議会 議員名簿を収集中...")

    soup = fetch_soup(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return []

    # 写真URLを順番に収集（bullet以外の画像タグ）
    img_tags = soup.find_all("img", src=re.compile(r"202[0-9]", re.I))
    photo_srcs = []
    for img in img_tags:
        src = img.get("src", "")
        if src:
            photo_srcs.append(src)
    print(f"  写真 {len(photo_srcs)} 件発見")

    # Table 2 (index 2) が議員一覧テーブル
    tables = soup.find_all("table")
    target_table = None
    for t in tables:
        rows = t.find_all("tr")
        if len(rows) >= 10:
            target_table = t
            break

    if target_table is None:
        print("  議員テーブルが見つかりません")
        return []

    rows = target_table.find_all("tr")
    print(f"  テーブル行数: {len(rows)}")

    members = []
    seat_num = 0

    for row in rows:
        cells = row.find_all(["td", "th"])
        texts = [normalize(c.get_text()) for c in cells]

        # データ行の条件: 2番目セルが漢字名前（2文字以上）、3番目セルがひらがな
        if len(texts) < 8:
            continue

        name_raw = texts[1] if len(texts) > 1 else ""
        furigana_raw = texts[2] if len(texts) > 2 else ""
        role_raw = texts[3] if len(texts) > 3 else ""
        # 党派・会派のスペースを除去（「日本 共産党」→「日本共産党」）
        party_raw = re.sub(r"\s+", "", texts[6]) if len(texts) > 6 else ""
        faction_raw = re.sub(r"\s+", "", texts[7]) if len(texts) > 7 else ""

        # 名前が漢字を含み、ふりがながひらがなであることを確認
        if not re.search(r"[\u4e00-\u9fff]", name_raw):
            continue
        if not re.search(r"[\u3041-\u3096]", furigana_raw):
            continue
        # ヘッダー行をスキップ
        if "氏" in name_raw and "名" in name_raw:
            continue

        seat_num += 1

        # 職名から委員会情報を抽出
        committees = []
        for kw in ["総務産業常任委員会", "社会文教常任委員会", "議会運営委員会", "議会広報特別委員会",
                   "南部桧山衛生施設組合", "檜山広域行政組合"]:
            if kw in role_raw:
                committees.append(kw)

        # 写真ダウンロード
        photo_url = ""
        if seat_num - 1 < len(photo_srcs):
            src = photo_srcs[seat_num - 1]
            photo_remote = BASE_URL + "/gikai/meibo/" + src.lstrip("./")
            ext = src.split(".")[-1].split("?")[0] or "jpg"
            fname = f"seat_{seat_num}.{ext}"
            local_path = PHOTO_DIR / fname
            if download_photo(photo_remote, local_path):
                photo_url = f"/members/esashi/{fname}"
                print(f"  [{seat_num}] {name_raw} ({furigana_raw}) [{party_raw}] -> 写真保存: {fname}")
            else:
                print(f"  [{seat_num}] {name_raw} ({furigana_raw}) [{party_raw}] -> 写真なし")
        else:
            print(f"  [{seat_num}] {name_raw} ({furigana_raw}) [{party_raw}]")

        members.append({
            "seat_number": seat_num,
            "name": name_raw,
            "furigana": furigana_raw,
            "party": party_raw,
            "faction": faction_raw,
            "committees": committees,
            "photo_url": photo_url,
        })

        time.sleep(0.2)

    return members


def main():
    members = scrape_members()

    if not members:
        print("  議員データを取得できませんでした")
        return

    output_path = OUTPUT_DIR / "members.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(members, f, ensure_ascii=False, indent=2)

    print(f"\n完了: {len(members)} 名の議員データを保存しました -> {output_path}")
    print(f"取得議員数: {len(members)}名")


if __name__ == "__main__":
    main()
