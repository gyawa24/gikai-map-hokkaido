"""
北斗市議会 議員名簿スクレイパー
出力: data/hokuto/members.json

ページ構造:
- article内のpタグで議員ブロックが構成される
- imgのalt属性に氏名（「○○議員」形式）
- 氏名（カタカナ）パターンで furigana を抽出
- ●所属会派 / ●所属委員会等 の行から faction / committees を取得
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.city.hokuto.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/docs/4592.html"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "data" / "hokuto"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = Path(__file__).parent.parent.parent / "site" / "public" / "members" / "hokuto"
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


def download_photo(remote_url: str, fname: str) -> str:
    try:
        resp = requests.get(remote_url, headers=HEADERS, timeout=10)
        resp.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(resp.content)
        return f"/members/hokuto/{fname}"
    except Exception as e:
        print(f"  [PHOTO ERROR] {remote_url} -> {e}")
        return ""


def build_furigana_map(article) -> dict:
    """article全体テキストから 氏名→ふりがな の辞書を作成"""
    text = article.get_text()
    # パターン: 漢字氏名（カタカナ）
    # 例: 白戸昭司（シラト\xa0ショウジ）
    furigana_map = {}
    for m in re.finditer(r'([\u4e00-\u9fff々]{2,6})\s*（([ァ-ヶー\s\u3000\xa0]{3,})）', text):
        name = m.group(1)
        kana = re.sub(r'[\s\u3000\xa0]+', ' ', m.group(2)).strip()
        furigana_map[name] = kana
    return furigana_map


def scrape_members():
    print("北斗市議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return []

    article = soup.find("article")
    if article is None:
        print("  articleタグが見つかりません")
        return []

    # ふりがな辞書を事前構築
    furigana_map = build_furigana_map(article)
    print(f"  ふりがな {len(furigana_map)} 件取得: {list(furigana_map.items())[:3]}...")

    # articleのpタグ一覧
    ps = article.find_all("p")
    members = []
    seat = 0

    i = 0
    while i < len(ps):
        p = ps[i]
        img = p.find("img", src=re.compile(r"/fs/"))
        if img:
            seat += 1
            # 氏名: altから取得（「○○議員」→「○○」）
            alt = img.get("alt", "")
            name = re.sub(r'議員$', '', alt).strip()

            # ふりがな
            furigana = furigana_map.get(name, "")

            # 以降のpタグから会派・委員会を取得（次のimgまで）
            faction = ""
            committees = []
            j = i + 1
            while j < len(ps):
                next_img = ps[j].find("img", src=re.compile(r"/fs/"))
                if next_img:
                    break
                t = ps[j].get_text(" ", strip=True)
                if t.startswith("●所属会派"):
                    faction = t.replace("●所属会派", "").strip()
                elif t.startswith("●所属委員会等"):
                    raw = t.replace("●所属委員会等", "").strip()
                    # 常任委員会・特別委員会・広域連合等を分割
                    # スペース区切りで分割し、重複排除
                    parts = re.split(r'\s+', raw)
                    # 委員会名（長い名詞句）を抽出
                    committees = [p for p in parts if p and len(p) >= 3]
                j += 1

            # 写真ダウンロード
            src = img.get("src", "")
            photo_url = ""
            if src:
                remote_url = src if src.startswith("http") else BASE_URL + src
                ext = src.split(".")[-1].split("?")[0].lower() or "jpg"
                fname = f"seat_{seat}.{ext}"
                photo_url = download_photo(remote_url, fname)
                time.sleep(0.3)

            member = {
                "seat_number": seat,
                "name": name,
                "furigana": furigana,
                "party": "",
                "faction": faction,
                "committees": committees,
                "photo_url": photo_url,
            }
            members.append(member)
            print(f"  [{seat}] {name}（{furigana}） / {faction} / {committees[:1]}")

        i += 1

    return members


def main():
    members = scrape_members()

    if not members:
        print("  議員データが取得できませんでした")
        return

    output_path = OUTPUT_DIR / "members.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(members, f, ensure_ascii=False, indent=2)
    print(f"\n  保存完了: {output_path}")
    print(f"\n取得議員数: {len(members)}名")


if __name__ == "__main__":
    main()
