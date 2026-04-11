"""
恵庭市議会 議員名簿スクレイパー
出力: data/eniwa/members.json
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.city.eniwa.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/soshikikarasagasu/gikaijimukyoku/gikaisomugakari/giin/index.html"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "site" / "data" / "eniwa"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

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


def scrape_members():
    print("恵庭市議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return

    members = []

    # 議員一覧ページのリンクを収集
    links = soup.find_all("a", href=True)
    member_links = [
        a for a in links
        if "giin" in a.get("href", "") and a.get_text(strip=True)
    ]

    print(f"  議員リンク {len(member_links)} 件発見")

    for i, a in enumerate(member_links):
        href = a["href"]
        url = href if href.startswith("http") else BASE_URL + href
        name_text = a.get_text(strip=True)
        if not name_text or len(name_text) < 2:
            continue

        print(f"  [{i+1}] {name_text} -> {url}")
        detail = fetch(url)
        time.sleep(0.5)

        member = {
            "seat_number": i + 1,
            "name": name_text,
            "furigana": "",
            "party": "",
            "faction": "",
            "committees": [],
            "photo_url": "",
        }

        if detail:
            # ふりがな
            furigana_el = detail.find(string=re.compile(r"[ぁ-ん]{2,}"))
            if furigana_el:
                member["furigana"] = furigana_el.strip()

            # 写真URL
            img = detail.find("img", src=re.compile(r"giin|member|photo", re.I))
            if img and img.get("src"):
                src = img["src"]
                member["photo_url"] = src if src.startswith("http") else BASE_URL + src

            # テキストから会派・委員会を抽出
            full_text = detail.get_text("\n")
            for line in full_text.split("\n"):
                line = line.strip()
                if re.search(r"会派|所属", line) and "：" in line:
                    val = line.split("：", 1)[-1].strip()
                    if val:
                        member["faction"] = val
                if re.search(r"委員会", line) and "：" in line:
                    val = line.split("：", 1)[-1].strip()
                    if val and val != "なし":
                        member["committees"] = [v.strip() for v in re.split(r"[、,]", val) if v.strip()]

        members.append(member)

    if members:
        out_path = OUTPUT_DIR / "members.json"
        out_path.write_text(
            json.dumps(members, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"  -> 保存: {out_path} ({len(members)}名)")
    else:
        print("  議員データが取得できませんでした。URLを確認してください。")
        print(f"  対象URL: {MEMBERS_URL}")


if __name__ == "__main__":
    scrape_members()
