"""
遠別町議会 議員名簿スクレイパー
ソース: https://www.town.embetsu.hokkaido.jp/docs/page2013080900205.html
出力: data/embetsu/members.json
"""

import json
import re
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.embetsu.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/docs/page2013080900205.html"

ROOT = Path(__file__).parent.parent.parent
OUT_DIR = ROOT / "data" / "embetsu"
SITE_OUT_DIR = ROOT / "site" / "data" / "embetsu"
PHOTO_DIR = ROOT / "site" / "public" / "members" / "embetsu"
for d in (OUT_DIR, SITE_OUT_DIR, PHOTO_DIR):
    d.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

FACTION_KEYWORDS = ("議長", "副議長", "監査委員")


def clean(s: str | None) -> str:
    if not s:
        return ""
    return re.sub(r"\s+", " ", s.replace("\u3000", " ")).strip()


def split_lines(cell) -> list[str]:
    """<br>区切りで分割し、空白・全角空白を正規化した非空行のリスト"""
    for br in cell.find_all("br"):
        br.replace_with("\n")
    text = cell.get_text("\n")
    return [clean(ln) for ln in text.splitlines() if clean(ln)]


def parse_name_cell(cell) -> tuple[str, str]:
    lines = split_lines(cell)
    if len(lines) < 2:
        # ふりがな or 氏名のみ
        only = lines[0] if lines else ""
        return only.replace(" ", ""), ""
    furigana = lines[0].replace(" ", "")
    name = lines[1].replace(" ", "")
    return name, furigana


def parse_committees(cell) -> tuple[list[str], str]:
    """
    所属委員会等のセルから委員会リストと役職(faction)を抽出。
    例: ['議長', '総務産業常任委員会委員']
      -> faction='議長', committees=['総務産業常任委員会委員']
    """
    lines = split_lines(cell)
    faction_parts: list[str] = []
    committees: list[str] = []
    for line in lines:
        if line in ("議長", "副議長"):
            faction_parts.append(line)
            continue
        committees.append(line)
    faction = " / ".join(faction_parts)
    return committees, faction


def download_photo(img_src: str, seat_number: int) -> str:
    url = img_src if img_src.startswith("http") else BASE_URL + img_src
    ext = url.split(".")[-1].split("?")[0].lower() or "jpg"
    if ext not in ("jpg", "jpeg", "png", "gif"):
        ext = "jpg"
    fname = f"seat_{seat_number}.{ext}"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(resp.content)
        return f"/members/embetsu/{fname}"
    except Exception as e:
        print(f"  [WARN] 写真DL失敗 seat={seat_number}: {e}")
        return ""


def find_seat_from_img_alt(cell) -> int | None:
    """写真セル内の img alt 属性から議席番号を復元する（ネスト構造対策）"""
    img = cell.find("img")
    if not img:
        return None
    alt = img.get("alt", "")
    m = re.search(r"議席番号(\d+)番", alt)
    return int(m.group(1)) if m else None


def scrape() -> list[dict]:
    print(f"遠別町議会 議員名簿を収集中: {MEMBERS_URL}")
    resp = requests.get(MEMBERS_URL, headers=HEADERS, timeout=20)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding
    soup = BeautifulSoup(resp.text, "html.parser")

    # 議員名簿のテーブルは「議席番号」「所属委員会等」のヘッダを持つ
    target_table = None
    for table in soup.find_all("table"):
        headers = [clean(th.get_text()) for th in table.find_all("th")]
        if any("議席" in h for h in headers) and any(
            "所属委員会" in h for h in headers
        ):
            target_table = table
            break

    if target_table is None:
        print("  [ERROR] 議員名簿テーブルが見つかりません")
        return []

    members: list[dict] = []
    tbody = target_table.find("tbody") or target_table
    for tr in tbody.find_all("tr", recursive=False):
        tds = tr.find_all("td", recursive=False)
        if len(tds) < 6:
            continue
        seat_text = clean(tds[0].get_text())
        if not seat_text.isdigit():
            continue
        seat_number = int(seat_text)

        name_cell = tds[2]
        name, furigana = parse_name_cell(name_cell)
        if not name:
            # 欠員
            print(f"  seat={seat_number} は欠員のためスキップ")
            continue

        committees, faction = parse_committees(tds[5])

        # 写真（ネスト <table> 構造にも対応）
        real_seat = find_seat_from_img_alt(tds[1]) or seat_number
        photo_url = ""
        img = tds[1].find("img")
        if img and img.get("src"):
            photo_url = download_photo(img["src"], real_seat)

        members.append(
            {
                "seat_number": real_seat,
                "name": name,
                "furigana": furigana,
                "party": "",
                "faction": faction,
                "committees": committees,
                "photo_url": photo_url,
            }
        )

    members.sort(key=lambda m: m["seat_number"])
    return members


def main() -> None:
    members = scrape()
    if not members:
        print("取得不可: 議員情報を抽出できませんでした")
        return

    for out in (OUT_DIR / "members.json", SITE_OUT_DIR / "members.json"):
        out.write_text(
            json.dumps(members, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"  書き出し: {out}")

    print(f"取得議員数: {len(members)}名")
    for m in members:
        print(
            f"  {m['seat_number']:2d} {m['name']} ({m['furigana']}) "
            f"{m['faction']} / {', '.join(m['committees'])}"
        )


if __name__ == "__main__":
    main()
