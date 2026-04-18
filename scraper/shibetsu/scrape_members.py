"""
士別市議会 議員名簿スクレイパー
出力: site/data/shibetsu/members.json
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.city.shibetsu.lg.jp"
MEMBERS_URL = f"{BASE_URL}/soshikikarasagasu/gikaijimukyoku/1514.html"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "site" / "data" / "shibetsu"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = Path(__file__).parent.parent.parent / "site" / "public" / "members" / "shibetsu"
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
        return f"/members/shibetsu/{fname}"
    except Exception as e:
        print(f"  [WARN] 写真取得失敗 {remote_url} -> {e}")
        return ""


def scrape_members():
    print("士別市議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return

    members = []

    # 各議員ブロックはh3（番号+氏名）→ img → dl(dt/dd) の繰り返し
    # メインコンテンツ領域を絞り込む
    content = soup.find("div", id="tmp_contents") or soup.find("div", class_=re.compile(r"contents|main", re.I)) or soup

    # 議員情報はarticle内のh2タグで区切られている
    # 形式: "1番 村上 緑一（むらかみ のりかず）"
    article = soup.find("article", id="contents") or content
    h2_tags = article.find_all("h2")

    for h2 in h2_tags:
        text = h2.get_text(strip=True)

        num_match = re.search(r"^(\d+)番", text)
        if not num_match:
            continue

        seat_number = int(num_match.group(1))

        if "欠員" in text:
            print(f"  [欠員] 議席{seat_number}")
            continue

        # 氏名とふりがなを括弧で分割
        # 例: "1番 村上 緑一（むらかみ のりかず）"
        name_furi = re.sub(r"^\d+番\s*", "", text)
        furi_match = re.search(r"（(.+?)）", name_furi)
        furigana = ""
        if furi_match:
            furigana = furi_match.group(1).replace("\u3000", "").replace(" ", "")
            name = re.sub(r"（.+?）", "", name_furi).replace("\u3000", "").replace(" ", "").strip()
        else:
            name = name_furi.replace("\u3000", "").replace(" ", "").strip()

        if not name or len(name) < 2:
            continue

        print(f"  [{seat_number}] {name}（{furigana}）")

        member = {
            "seat_number": seat_number,
            "name": name,
            "furigana": furigana,
            "party": "",
            "faction": "",
            "committees": [],
            "photo_url": "",
        }

        # h2の直後の兄弟要素からimg・tableを探す（次のh2まで）
        siblings = []
        for sib in h2.next_siblings:
            tag = getattr(sib, "name", None)
            if tag == "h2":
                break
            siblings.append(sib)

        sib_soup = BeautifulSoup("".join(str(s) for s in siblings), "html.parser")

        # 写真
        img = sib_soup.find("img")
        if img and img.get("src"):
            src = img["src"]
            if src.startswith("//"):
                src = "https:" + src
            elif src.startswith("/"):
                src = BASE_URL + src
            ext = src.split(".")[-1].split("?")[0] or "jpg"
            fname = f"seat_{seat_number}.{ext}"
            photo_url = download_photo(src, fname)
            member["photo_url"] = photo_url
            time.sleep(0.3)

        # tableのtr/tdから会派・委員会を抽出
        rows = sib_soup.find_all("tr")
        for row in rows:
            tds = row.find_all("td")
            if len(tds) >= 2:
                label = tds[0].get_text(strip=True)
                value = tds[1].get_text(strip=True)
                if re.search(r"会派・所属名", label):
                    member["faction"] = value
                elif re.search(r"所属委員会|委員会", label):
                    # 委員会名が連結されているので「常任委員会」「特別委員会」で分割
                    coms = re.findall(r"[^\s]+?(?:常任委員会|特別委員会|委員会)", value)
                    if not coms:
                        coms = [c.strip() for c in re.split(r"[、,\n・]", value) if c.strip()]
                    member["committees"] = coms

        members.append(member)

    if not members:
        print("  議員データが取得できませんでした")
        return

    members.sort(key=lambda m: m["seat_number"])

    output_path = OUTPUT_DIR / "members.json"
    output_path.write_text(json.dumps(members, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n完了: {len(members)}名 -> {output_path}")


if __name__ == "__main__":
    scrape_members()
