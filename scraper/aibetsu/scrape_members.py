"""
愛別町議会 議員名簿スクレイパー
出力: site/data/aibetsu/members.json
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.aibetsu.hokkaido.jp"
LIST_URL = f"{BASE_URL}/05/02/02"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "site" / "data" / "aibetsu"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = Path(__file__).parent.parent.parent / "site" / "public" / "members" / "aibetsu"
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


def download_photo(remote_url: str, dest: Path) -> bool:
    try:
        resp = requests.get(remote_url, headers=HEADERS, timeout=10)
        resp.raise_for_status()
        dest.write_bytes(resp.content)
        return True
    except Exception as e:
        print(f"  [PHOTO ERROR] {remote_url} -> {e}")
        return False


def parse_detail(soup: BeautifulSoup) -> dict:
    result = {"furigana": "", "seat_number": None, "committees": []}

    lines = [l.strip() for l in soup.get_text(separator="\n").splitlines() if l.strip()]

    # ふりがな: 「よみかた」ラベルの直後のひらがな行を結合
    for i, line in enumerate(lines):
        if line == "よみかた" and i + 1 < len(lines):
            parts = []
            for j in range(i + 1, min(i + 4, len(lines))):
                if re.fullmatch(r"[ぁ-ん]+", lines[j]):
                    parts.append(lines[j])
                else:
                    break
            if parts:
                result["furigana"] = " ".join(parts)
            break

    # 議席番号: 「議席番号」ラベル直後の「N番」
    for i, line in enumerate(lines):
        if line == "議席番号" and i + 1 < len(lines):
            m = re.match(r"(\d+)番", lines[i + 1])
            if m:
                result["seat_number"] = int(m.group(1))
            break

    # 委員会: 「所属委員会等」ラベル直後〜「サイトメニュー」手前まで
    committees = []
    for i, line in enumerate(lines):
        if "所属委員会" in line:
            for j in range(i + 1, len(lines)):
                nxt = lines[j]
                if nxt in ("サイトメニュー", "くらしの窓口"):
                    break
                committees.append(nxt)
            break
    result["committees"] = committees

    # 写真URL
    img = soup.find("img", src=re.compile(r"gmember|member|photo|giin", re.I))
    if not img:
        content = soup.find("main") or soup.find("article") or soup
        img = content.find("img") if content else None
    result["photo_src"] = img["src"] if img and img.get("src") else ""

    return result


def scrape_members():
    print("愛別町議会 議員名簿を収集中...")

    soup = fetch(LIST_URL)
    if soup is None:
        print("  一覧ページ取得失敗")
        return

    # field-content div内のリンク＋span(名前)を収集
    member_links = []
    seen = set()
    for div in soup.find_all("div", class_="field-content"):
        a = div.find("a", href=True)
        if not a:
            continue
        href = a.get("href", "").strip()
        if not re.search(r"/05/02/02/\d+", href):
            continue
        span = div.find("span")
        name = span.get_text(strip=True) if span else a.get_text(strip=True)
        if not name or href in seen:
            continue
        seen.add(href)
        member_links.append((name, href))

    unique_links = member_links

    print(f"  議員リンク {len(unique_links)} 件発見")

    members = []
    for name, href in unique_links:
        url = BASE_URL + href
        print(f"  取得中: {name} -> {url}")
        detail_soup = fetch(url)
        time.sleep(0.5)

        member = {
            "seat_number": None,
            "name": name,
            "furigana": "",
            "party": "",
            "faction": "",
            "committees": [],
            "photo_url": "",
        }

        if detail_soup:
            detail = parse_detail(detail_soup)
            member["furigana"] = detail["furigana"]
            if detail["seat_number"] is not None:
                member["seat_number"] = detail["seat_number"]
            member["committees"] = detail["committees"]

            photo_src = detail["photo_src"]
            if photo_src:
                remote_url = photo_src if photo_src.startswith("http") else BASE_URL + photo_src
                seat = detail["seat_number"] or (len(members) + 1)
                ext = remote_url.split(".")[-1].split("?")[0] or "jpg"
                fname = f"seat_{seat}.{ext}"
                if download_photo(remote_url, PHOTO_DIR / fname):
                    member["photo_url"] = f"/members/aibetsu/{fname}"

        members.append(member)

    # 議席番号順にソート（Noneは末尾）
    members.sort(key=lambda m: (m["seat_number"] is None, m["seat_number"] or 0))

    output_path = OUTPUT_DIR / "members.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(members, f, ensure_ascii=False, indent=2)

    print(f"\n完了: {len(members)} 名 -> {output_path}")
    for m in members:
        print(f"  {m['seat_number']}番 {m['name']} ({m['furigana']})")


if __name__ == "__main__":
    scrape_members()
