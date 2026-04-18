"""
西興部村議会 議員名簿スクレイパー
出力: data/nishiokoppe/members.json
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.vill.nishiokoppe.lg.jp"
MEMBERS_URL = f"{BASE_URL}/section/gikai/feeuub0000002jc4.html"
ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = ROOT / "data" / "nishiokoppe"
SITE_DATA_DIR = ROOT / "site" / "data" / "nishiokoppe"
PHOTO_DIR = ROOT / "site" / "public" / "members" / "nishiokoppe"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
SITE_DATA_DIR.mkdir(parents=True, exist_ok=True)
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


def normalize_name(s: str) -> str:
    return re.sub(r"\s+", "", s or "")


def collect_photo_map(soup: BeautifulSoup, page_url: str) -> dict[str, str]:
    """figure 内の img（alt=議長/副議長）から 氏名 -> 画像URL のマップを作る"""
    result: dict[str, str] = {}
    for fig in soup.find_all("figure"):
        img = fig.find("img")
        if not img or not img.get("src"):
            continue
        alt = img.get("alt", "")
        if alt not in ("議長", "副議長"):
            continue
        text = fig.get_text(" ", strip=True)
        # 例: "議長：森田　英一" / "副議長　大原　敏彦"
        m = re.search(r"(?:議長|副議長)[：:　 \s]+([^\s：:]+(?:[　\s]+[^\s：:]+)?)", text)
        if not m:
            continue
        name_key = normalize_name(m.group(1))
        src = img["src"]
        if src.startswith("http"):
            url = src
        elif src.startswith("/"):
            url = BASE_URL + src
        else:
            # relative path from the page URL
            url = page_url.rsplit("/", 1)[0] + "/" + src
        result[name_key] = url
    return result


def download_photo(url: str, seat: int) -> str:
    ext = url.split(".")[-1].split("?")[0].lower() or "jpg"
    if ext not in ("jpg", "jpeg", "png", "gif", "webp"):
        ext = "jpg"
    fname = f"seat_{seat}.{ext}"
    try:
        r = requests.get(url, headers=HEADERS, timeout=15)
        r.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(r.content)
        return f"/members/nishiokoppe/{fname}"
    except Exception as e:
        print(f"  [IMG ERROR] {url} -> {e}")
        return ""


def parse_committees(*cells: str) -> list[str]:
    items: list[str] = []
    for c in cells:
        if not c:
            continue
        for piece in re.split(r"[、,，/／・\n]+", c):
            piece = piece.strip()
            if piece:
                items.append(piece)
    # 重複除去（順序維持）
    seen = set()
    result = []
    for x in items:
        if x not in seen:
            seen.add(x)
            result.append(x)
    return result


def extract_role(committees: list[str], name_key: str, chair_key: str, vice_key: str) -> str:
    if name_key == chair_key:
        return "議長"
    if name_key == vice_key:
        return "副議長"
    return ""


def scrape_members():
    print("西興部村議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return

    photo_map = collect_photo_map(soup, MEMBERS_URL)
    # 氏名ベースで議長/副議長を特定する
    chair_key = ""
    vice_key = ""
    for fig in soup.find_all("figure"):
        img = fig.find("img")
        if not img:
            continue
        alt = img.get("alt", "")
        text = fig.get_text(" ", strip=True)
        m = re.search(r"(?:議長|副議長)[：:　 \s]+([^\s：:]+(?:[　\s]+[^\s：:]+)?)", text)
        if not m:
            continue
        nk = normalize_name(m.group(1))
        if alt == "議長":
            chair_key = nk
        elif alt == "副議長":
            vice_key = nk

    # 議員テーブル（caption に "任期" が含まれる table を特定）
    target_table = None
    for t in soup.find_all("table"):
        cap = t.find("caption")
        if cap and "任期" in cap.get_text():
            target_table = t
            break
    if target_table is None:
        print("  議員テーブルが見つかりません")
        return

    members = []
    for tr in target_table.find("tbody").find_all("tr"):
        tds = tr.find_all("td")
        if len(tds) < 3:
            continue
        seat_txt = tds[0].get_text(strip=True)
        if not re.fullmatch(r"\d+", seat_txt):
            continue
        seat = int(seat_txt)
        name = re.sub(r"\s+", "　", tds[1].get_text(" ", strip=True)).strip()
        committee_cells = [td.get_text(" ", strip=True) for td in tds[2:]]
        committees = parse_committees(*committee_cells)

        name_key = normalize_name(name)
        role = extract_role(committees, name_key, chair_key, vice_key)
        # 役職も committees 配列の先頭に追加する（議長/副議長は役職扱い）
        if role and role not in committees:
            committees = [role] + committees

        photo_url = ""
        if name_key in photo_map:
            photo_url = download_photo(photo_map[name_key], seat)
            time.sleep(0.3)

        members.append({
            "seat_number": seat,
            "name": name,
            "furigana": "",
            "party": "",
            "faction": "",
            "committees": committees,
            "photo_url": photo_url,
        })
        print(f"  [{seat}] {name} {role} / {', '.join(committees)}")

    if not members:
        print("  議員データを取得できませんでした")
        return

    members.sort(key=lambda m: m["seat_number"])

    out1 = OUTPUT_DIR / "members.json"
    out2 = SITE_DATA_DIR / "members.json"
    payload = json.dumps(members, ensure_ascii=False, indent=2)
    out1.write_text(payload, encoding="utf-8")
    out2.write_text(payload, encoding="utf-8")
    print(f"  保存: {out1}")
    print(f"  保存: {out2}")
    print(f"取得議員数: {len(members)}名")


if __name__ == "__main__":
    scrape_members()
