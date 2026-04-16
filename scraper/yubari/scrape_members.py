"""
夕張市議会 議員名簿スクレイパー
出力: site/data/yubari/members.json
写真: site/public/members/yubari/seat_N.jpg
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.city.yubari.lg.jp"
MEMBERS_URL = f"{BASE_URL}/site/gikai/1764.html"

REPO_ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = REPO_ROOT / "site" / "data" / "yubari"
PHOTO_DIR = REPO_ROOT / "site" / "public" / "members" / "yubari"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def fetch(url: str) -> BeautifulSoup | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def normalize_ws(s: str) -> str:
    return re.sub(r"\s+", "", s or "")


def split_name_furigana(cell_text: str) -> tuple[str, str]:
    """'徳谷　康憲（とくたに　やすのり）' -> ('徳谷康憲', 'とくたにやすのり')"""
    m = re.match(r"\s*(.+?)\s*[（(]\s*(.+?)\s*[）)]\s*$", cell_text)
    if not m:
        return normalize_ws(cell_text), ""
    return normalize_ws(m.group(1)), normalize_ws(m.group(2))


def parse_committees(td) -> list[str]:
    # <br> 区切り / <p> 入れ子に対応
    text = td.get_text(separator="\n", strip=True)
    items: list[str] = []
    for line in text.split("\n"):
        line = re.sub(r"\s+", " ", line).strip()
        if line:
            items.append(line)
    return items


def download_photo(remote_url: str, seat: int) -> str:
    ext = remote_url.split("?")[0].rsplit(".", 1)[-1].lower() or "jpg"
    if ext not in {"jpg", "jpeg", "png", "gif", "webp"}:
        ext = "jpg"
    fname = f"seat_{seat}.{ext}"
    try:
        r = requests.get(remote_url, headers=HEADERS, timeout=15)
        r.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(r.content)
        return f"/members/yubari/{fname}"
    except Exception as e:
        print(f"  [WARN] 写真取得失敗 seat={seat} {remote_url} -> {e}")
        return ""


def scrape_members() -> list[dict]:
    print(f"夕張市議会 議員名簿を収集中... {MEMBERS_URL}")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return []

    # 議員1人 = <p class="img-left"><img ...></p> + 直後の <table class="table01">
    tables = soup.find_all("table", class_="table01")
    print(f"  議員テーブル {len(tables)} 件発見")

    members: list[dict] = []

    for table in tables:
        caption = table.find("caption")
        if not caption:
            continue
        cap_text = caption.get_text(strip=True)
        m = re.search(r"議席番号\s*(\d+)", cap_text)
        if not m:
            continue
        seat_number = int(m.group(1))

        # 直前の <p class="img-left"> 内の <img>
        photo_el = table.find_previous("p", class_="img-left")
        img_tag = photo_el.find("img") if photo_el else None

        row_map: dict[str, object] = {}
        for tr in table.find_all("tr"):
            th = tr.find("th")
            td = tr.find("td")
            if not th or not td:
                continue
            key = normalize_ws(th.get_text())
            row_map[key] = td

        name_td = row_map.get("氏名（ふりがな）")
        if not name_td:
            print(f"  [WARN] seat={seat_number}: 氏名行が見つかりません")
            continue
        name, furigana = split_name_furigana(name_td.get_text(" ", strip=True))

        party = ""
        if "党派" in row_map:
            party = normalize_ws(row_map["党派"].get_text())

        committees: list[str] = []
        if "所属委員会等" in row_map:
            committees = parse_committees(row_map["所属委員会等"])

        photo_url = ""
        if img_tag and img_tag.get("src"):
            src = img_tag["src"]
            remote = src if src.startswith("http") else BASE_URL + src
            photo_url = download_photo(remote, seat_number)
            time.sleep(0.3)

        member = {
            "seat_number": seat_number,
            "name": name,
            "furigana": furigana,
            "party": party,
            # 夕張市議会のHTMLには「会派」の列が無いため党派を会派としても記録
            "faction": party,
            "committees": committees,
        }
        if photo_url:
            member["photo_url"] = photo_url

        print(f"  [seat={seat_number}] {name} / {furigana} / {party} / {committees}")
        members.append(member)

    members.sort(key=lambda x: x["seat_number"])
    return members


def main():
    members = scrape_members()
    if not members:
        print("取得不可: 議員データが抽出できませんでした")
        return

    output_path = OUTPUT_DIR / "members.json"
    output_path.write_text(
        json.dumps(members, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"\n出力: {output_path}")
    print(f"取得議員数: {len(members)}名")


if __name__ == "__main__":
    main()
