"""
今金町議会 議員名簿スクレイパー
出力: data/imakane/members.json
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.imakane.lg.jp"
MEMBERS_URL = f"{BASE_URL}/ass/giin/index.html"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "data" / "imakane"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
SITE_OUTPUT_DIR = Path(__file__).parent.parent.parent / "site" / "data" / "imakane"
SITE_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = Path(__file__).parent.parent.parent / "site" / "public" / "members" / "imakane"
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


def download_photo(url: str, filename: str) -> str:
    """写真をダウンロードしてローカルパスを返す。失敗時は空文字。"""
    try:
        resp = requests.get(url, headers=HEADERS, timeout=10)
        resp.raise_for_status()
        (PHOTO_DIR / filename).write_bytes(resp.content)
        return f"/members/imakane/{filename}"
    except Exception as e:
        print(f"  [PHOTO ERROR] {url} -> {e}")
        return ""


def scrape_members():
    print("今金町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return []

    members = []

    # テーブルを探す
    tables = soup.find_all("table")
    print(f"  テーブル {len(tables)} 個発見")

    target_table = None
    for table in tables:
        rows = table.find_all("tr")
        if len(rows) >= 5:
            target_table = table
            break

    if target_table is None:
        print("  議員テーブルが見つかりません")
        return []

    rows = target_table.find_all("tr")
    print(f"  行数: {len(rows)}")

    for row in rows:
        cells = row.find_all(["td", "th"])
        if not cells:
            continue

        texts = [c.get_text(strip=True) for c in cells]

        # ヘッダー行をスキップ（議席・氏名などのラベル行）
        if not texts or texts[0] in ("", "議席", "No", "番号"):
            continue

        # 議席番号が数値かどうか確認
        seat_str = texts[0] if texts else ""
        if not re.match(r"^\d+$", seat_str):
            continue

        seat_number = int(seat_str)
        # 全角スペース・半角スペースを除去して氏名を正規化
        raw_name = texts[1] if len(texts) > 1 else ""
        name = re.sub(r"[\s\u3000]+", "", raw_name)
        if not name:
            continue

        # 列マッピング: 議席, 氏名, 年齢, 委員会, 党派, 職業, 当選回数, 備考
        committee = texts[3] if len(texts) > 3 else ""
        party = texts[4] if len(texts) > 4 else ""
        notes = texts[7] if len(texts) > 7 else ""

        # 委員会が「−」の場合は空にする
        if committee in ("−", "-", "ー"):
            committee = ""

        # 会派は今金町議会には記載なし（全員無所属か党派名のみ）
        faction = ""

        committees = [committee] if committee else []

        member = {
            "seat_number": seat_number,
            "name": name,
            "furigana": "",
            "party": party if party not in ("無所属", "") else "",
            "faction": faction,
            "committees": committees,
            "photo_url": "",
        }

        # 写真リンクを探す
        img = None
        for cell in cells:
            img = cell.find("img")
            if img:
                break
        if img and img.get("src"):
            src = img["src"]
            img_url = src if src.startswith("http") else BASE_URL + "/" + src.lstrip("/")
            ext = img_url.split(".")[-1].split("?")[0] or "jpg"
            fname = f"seat_{seat_number}.{ext}"
            photo_path = download_photo(img_url, fname)
            member["photo_url"] = photo_path

        # 個人ページへのリンクを探す（詳細情報取得用）
        link = None
        for cell in cells:
            a = cell.find("a", href=True)
            if a:
                link = a
                break

        if link:
            href = link["href"]
            detail_url = href if href.startswith("http") else BASE_URL + "/ass/giin/" + href.lstrip("/")
            print(f"  [{seat_number}] {name} -> 詳細ページ取得: {detail_url}")
            detail = fetch(detail_url)
            time.sleep(0.5)

            if detail:
                # ふりがな（ひらがな2文字以上）
                body_text = detail.get_text()
                furigana_match = re.search(r"[ぁ-ん]{3,}", body_text)
                if furigana_match:
                    member["furigana"] = furigana_match.group(0)

                # 写真（詳細ページから）
                if not member["photo_url"]:
                    img = detail.find("img", src=re.compile(r"giin|member|photo|img", re.I))
                    if img and img.get("src"):
                        src = img["src"]
                        img_url = src if src.startswith("http") else BASE_URL + "/" + src.lstrip("/")
                        ext = img_url.split(".")[-1].split("?")[0] or "jpg"
                        fname = f"seat_{seat_number}.{ext}"
                        photo_path = download_photo(img_url, fname)
                        member["photo_url"] = photo_path
        else:
            print(f"  [{seat_number}] {name} (詳細ページなし)")

        members.append(member)

    return members


def main():
    members = scrape_members()

    if not members:
        print("議員データを取得できませんでした")
        return

    print(f"\n取得議員数: {len(members)}名")
    for m in members:
        print(f"  {m['seat_number']}. {m['name']} / {m['party'] or '無所属'} / {m['committees']}")

    # 出力
    output_data = {"members": members}

    out_path = OUTPUT_DIR / "members.json"
    out_path.write_text(json.dumps(output_data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n保存: {out_path}")

    site_path = SITE_OUTPUT_DIR / "members.json"
    site_path.write_text(json.dumps(output_data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"保存: {site_path}")


if __name__ == "__main__":
    main()
