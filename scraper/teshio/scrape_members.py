"""
天塩町議会 議員名簿スクレイパー
出力: data/teshio/members.json （および site/data/teshio/members.json）

HTML構造:
  ページ内に議員情報テーブル (class="tinymce-table-blue") が3つ並び、
  各テーブルは3議員分を列方向に並べている。
  行構成:
    1行目: 議席 | N | N | N
    2行目: (空) | <img> | <img> | <img>  (顔写真)
    3行目: 氏名 | 姓 名 | ...
    4行目: 所属委員会 | 委員会1<br>委員会2 | ...
    5行目: 党派 | 無所属 | ...
    6行目: 当選回数 | 数字 | ...

ふりがなはページに記載が無いため空文字で出力する。
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.teshiotown.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/?page_id=17691"

REPO_ROOT = Path(__file__).parent.parent.parent
DATA_DIR = REPO_ROOT / "data" / "teshio"
SITE_DATA_DIR = REPO_ROOT / "site" / "data" / "teshio"
PHOTO_DIR = REPO_ROOT / "site" / "public" / "members" / "teshio"
for d in (DATA_DIR, SITE_DATA_DIR, PHOTO_DIR):
    d.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

_ZEN2HAN = str.maketrans("０１２３４５６７８９", "0123456789")


def zen2han(s: str) -> str:
    return s.translate(_ZEN2HAN)


def fetch(url: str) -> BeautifulSoup | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def cell_lines(td) -> list[str]:
    """<br> を改行に置換してから行配列を返す。"""
    for br in td.find_all("br"):
        br.replace_with("\n")
    text = td.get_text("\n", strip=True)
    return [ln.strip() for ln in text.splitlines() if ln.strip()]


def cell_single(td) -> str:
    lines = cell_lines(td)
    return lines[0] if lines else ""


def parse_table(table) -> list[dict]:
    """1つのテーブルから3議員分をパースする。"""
    rows = table.find_all("tr")
    if len(rows) < 6:
        return []

    seat_cells = rows[0].find_all("td")
    img_cells = rows[1].find_all("td")
    name_cells = rows[2].find_all("td")
    committee_cells = rows[3].find_all("td")
    party_cells = rows[4].find_all("td")

    if cell_single(seat_cells[0]) != "議席":
        return []

    members = []
    for i in range(1, len(seat_cells)):
        seat_text = zen2han(cell_single(seat_cells[i]))
        if not re.fullmatch(r"\d+", seat_text):
            continue
        seat = int(seat_text)

        name = cell_single(name_cells[i]) if i < len(name_cells) else ""
        if not name:
            continue
        # 姓と名の間は全角スペースで結合されている。そのまま保持。
        name = re.sub(r"\s+", " ", name).strip()

        committees = cell_lines(committee_cells[i]) if i < len(committee_cells) else []
        party = cell_single(party_cells[i]) if i < len(party_cells) else ""

        # 役職（議長・副議長）は委員会欄に混在する
        title = ""
        cleaned_committees: list[str] = []
        for c in committees:
            if c in ("議長", "副議長"):
                title = c
            else:
                cleaned_committees.append(c)

        img_src = ""
        if i < len(img_cells):
            img = img_cells[i].find("img")
            if img and img.get("src"):
                src = img["src"]
                img_src = src if src.startswith("http") else BASE_URL + src

        members.append({
            "seat_number": seat,
            "name": name,
            "title": title,
            "committees": cleaned_committees,
            "party": party,
            "_img_src": img_src,
        })

    return members


def download_photo(url: str, seat: int) -> str:
    if not url:
        return ""
    # サイズ違いがsrcsetにあるが、srcの解像度で十分
    clean_url = url.split("?")[0]
    ext = clean_url.rsplit(".", 1)[-1].lower() if "." in clean_url else "jpg"
    if ext not in ("jpg", "jpeg", "png", "gif", "webp"):
        ext = "jpg"
    fname = f"seat_{seat}.{ext}"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(resp.content)
        return f"/members/teshio/{fname}"
    except Exception as e:
        print(f"    [IMG ERROR] {url} -> {e}")
        return ""


def scrape():
    print("天塩町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return None

    tables = soup.find_all("table")
    print(f"  テーブル {len(tables)} 件発見")

    all_members: list[dict] = []
    for t in tables:
        all_members.extend(parse_table(t))

    print(f"  議員 {len(all_members)} 件抽出")

    result = []
    for m in all_members:
        seat = m["seat_number"]
        print(f"  [議席{seat}] {m['name']} ({m['title'] or '議員'}) / {m['party']} / {m['committees']}")
        photo_url = download_photo(m["_img_src"], seat)
        time.sleep(0.3)
        result.append({
            "seat_number": seat,
            "name": m["name"],
            "furigana": "",
            "party": m["party"],
            "faction": "",
            "title": m["title"],
            "committees": m["committees"],
            "photo_url": photo_url,
        })

    result.sort(key=lambda x: x["seat_number"])
    return result


def main():
    members = scrape()
    if not members:
        print("取得不可: 議員情報を取得できませんでした")
        return

    out = {"members": members}
    for target in (DATA_DIR / "members.json", SITE_DATA_DIR / "members.json"):
        target.write_text(
            json.dumps(out, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"  書き出し: {target}")

    print(f"取得議員数: {len(members)}名")


if __name__ == "__main__":
    main()
