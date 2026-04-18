"""
占冠村議会 議員名簿スクレイパー
出力: site/data/shimukappu/members.json

テーブル構造: 氏名 | 職業 | 備考（役職）
写真: 議員の抱負ページから取得
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.vill.shimukappu.lg.jp"
MEMBERS_URL = f"{BASE_URL}/shimukappu/section/gikai/nmudtq00000051vy.html"
PHOTO_PAGE_URL = f"{BASE_URL}/shimukappu/section/gikai/p4ictp0000006xlx.html"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "site" / "data" / "shimukappu"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = Path(__file__).parent.parent.parent / "site" / "public" / "members" / "shimukappu"
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


def download_photo(remote_url: str, dest_path: Path) -> bool:
    try:
        resp = requests.get(remote_url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        dest_path.write_bytes(resp.content)
        return True
    except Exception as e:
        print(f"  [WARN] 写真取得失敗 {remote_url} -> {e}")
        return False


def scrape_members():
    print("占冠村議会 議員名簿を収集中...")

    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return

    # テーブルからデータ行（td行）を取得。th行（ヘッダー）はスキップ
    members_raw = []
    for row in soup.find_all("tr"):
        cells = row.find_all("td")
        if len(cells) < 3:
            continue  # ヘッダー行（th）またはデータ不足の行
        name = cells[0].get_text(strip=True).replace("\u3000", "")  # 全角スペース除去
        role = cells[2].get_text(strip=True)
        if not name:
            continue
        members_raw.append({"name": name, "role": role})

    if not members_raw:
        print("  テーブルから議員データを取得できませんでした")
        return

    print(f"  議員 {len(members_raw)} 名の基本情報を取得")

    # 写真ページから写真URLを収集
    # 構造: <h3>役職　氏名</h3> の直後に <img src="..."> が来るパターン
    photo_map = {}  # name -> remote_url
    photo_soup = fetch(PHOTO_PAGE_URL)
    time.sleep(0.5)
    if photo_soup:
        for h3 in photo_soup.find_all("h3"):
            h3_text = h3.get_text(strip=True)
            # h3テキストに議員名が含まれるかチェック
            matched_name = None
            for mr in members_raw:
                if mr["name"] in h3_text:
                    matched_name = mr["name"]
                    break
            if not matched_name:
                continue
            # h3の直後のimgタグを探す（次の兄弟要素またはp/divの中）
            img = None
            sibling = h3.find_next_sibling()
            while sibling:
                img = sibling.find("img") if hasattr(sibling, "find") else None
                if img is None and sibling.name == "img":
                    img = sibling
                if img:
                    break
                # 次のh3が来たら停止
                if sibling.name == "h3":
                    break
                sibling = sibling.find_next_sibling()
            if img:
                src = img.get("src", "")
                if src:
                    full_url = src if src.startswith("http") else BASE_URL + src
                    photo_map[matched_name] = full_url

    # 最終的な議員リストを構築
    members = []
    for i, mr in enumerate(members_raw):
        name = mr["name"]
        role = mr["role"]

        # 委員会情報を役職から抽出
        committees = []
        committee_match = re.match(r"(.+?(?:委員会|常任委員会))(?:副)?委員長?", role)
        if committee_match:
            committees = [committee_match.group(1)]

        member = {
            "seat_number": i + 1,
            "name": name,
            "furigana": "",
            "party": "",
            "faction": "",
            "committees": committees,
            "photo_url": "",
        }

        # 写真のダウンロード
        remote_photo = photo_map.get(name)
        if remote_photo:
            ext = remote_photo.split(".")[-1].split("?")[0] or "jpg"
            fname = f"seat_{i + 1}.{ext}"
            dest = PHOTO_DIR / fname
            if download_photo(remote_photo, dest):
                member["photo_url"] = f"/members/shimukappu/{fname}"
                print(f"  [{i+1}] {name} ({role}) -> 写真保存: {fname}")
            time.sleep(0.3)
        else:
            print(f"  [{i+1}] {name} ({role}) -> 写真なし")

        members.append(member)

    out_path = OUTPUT_DIR / "members.json"
    out_path.write_text(json.dumps(members, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n完了: {len(members)} 名を {out_path} に保存しました")


if __name__ == "__main__":
    scrape_members()
