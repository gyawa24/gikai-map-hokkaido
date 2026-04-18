"""
東川町議会 議員名簿スクレイパー
出力: site/data/higashikawa/members.json
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://higashikawa-town.jp"
MEMBERS_URL = f"{BASE_URL}/portal/machi/panel/90"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "site" / "data" / "higashikawa"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = Path(__file__).parent.parent.parent / "site" / "public" / "members" / "higashikawa"
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


def download_photo(src: str, fname: str) -> str:
    url = src if src.startswith("http") else BASE_URL + src
    try:
        resp = requests.get(url, headers=HEADERS, timeout=10)
        resp.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(resp.content)
        return f"/members/higashikawa/{fname}"
    except Exception as e:
        print(f"  [PHOTO ERROR] {url} -> {e}")
        return ""


def parse_committees(soup: BeautifulSoup) -> dict[str, list[str]]:
    """委員会名簿から {正規化氏名: [委員会名, ...]} を返す"""
    committee_map: dict[str, list[str]] = {}

    h3 = soup.find(lambda tag: tag.name == "h3" and "委員会名簿" in tag.get_text())
    if not h3:
        print("  [WARN] 委員会名簿 h3 が見つからない")
        return committee_map

    for sib in h3.find_next_siblings("div"):
        text = sib.get_text(separator="\n", strip=True)
        if not text:
            continue

        table = sib.find("table")
        if table is None:
            continue

        # divの先頭テキストが委員会名（テーブルより前の部分）
        table_text = table.get_text()
        committee_name = text.replace(table_text, "").strip()
        # 不要な見出し行を除去
        committee_name = re.sub(r"役職|議員名", "", committee_name).strip()
        if not committee_name:
            continue

        print(f"  委員会: {committee_name}")

        for row in table.find_all("tr"):
            cells = row.find_all(["td", "th"])
            if len(cells) < 2:
                continue
            # 2列目に議員名（<br>区切りで複数名の場合あり）
            name_cell = cells[1]
            raw_names = re.split(r"\s*\n\s*", name_cell.get_text(separator="\n", strip=True))
            for raw in raw_names:
                name_key = re.sub(r"[\s　]+", "", raw)
                if len(name_key) < 2 or name_key in ("議員名",):
                    continue
                if name_key not in committee_map:
                    committee_map[name_key] = []
                if committee_name not in committee_map[name_key]:
                    committee_map[name_key].append(committee_name)

    return committee_map


def scrape_members():
    print("東川町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return

    committee_map = parse_committees(soup)
    print(f"  委員会マップ: {sum(len(v) for v in committee_map.values())} 件")

    members = []
    seat_num = 1

    # 議員カード: div.boxChild > img + div.bottom > p.title
    cards = soup.find_all("div", class_="boxChild")
    print(f"  議員カード {len(cards)} 件発見")

    for card in cards:
        img = card.find("img")
        p = card.find("p", class_="title")
        if not p:
            continue

        # p.title の中身は <br> 区切りテキスト
        lines = [s.strip() for s in p.get_text(separator="\n").splitlines() if s.strip()]

        role = ""
        name = ""
        party = ""

        for line in lines:
            if re.fullmatch(r"(議長|副議長|議員)", line):
                role = line
            elif re.search(r"党派", line):
                party = re.sub(r"党派[　\s]*", "", line).strip()
            elif re.search(r"[\u4e00-\u9fff]{2,}", line) and not re.search(r"昭和|当選|年|月|回", line):
                name = re.sub(r"[\s　]+", " ", line).strip()

        if not name:
            print(f"  [SKIP] 氏名取得失敗 lines={lines}")
            continue

        # 写真ダウンロード
        photo_url = ""
        if img and img.get("src"):
            src = img["src"]
            ext = src.split(".")[-1].split("?")[0] or "jpg"
            fname = f"seat_{seat_num}.{ext}"
            photo_url = download_photo(src, fname)
            time.sleep(0.3)

        # 委員会
        name_key = re.sub(r"[\s　]+", "", name)
        committees = committee_map.get(name_key, [])

        member = {
            "seat_number": seat_num,
            "name": name,
            "furigana": "",
            "party": party,
            "faction": "",
            "committees": committees,
            "photo_url": photo_url,
        }
        members.append(member)
        print(f"  [{seat_num}] {name} / {party} / 委員会:{committees}")
        seat_num += 1

    if not members:
        print("  議員データ取得失敗")
        return

    output_path = OUTPUT_DIR / "members.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(members, f, ensure_ascii=False, indent=2)

    print(f"\n完了: {len(members)} 名 -> {output_path}")


if __name__ == "__main__":
    scrape_members()
