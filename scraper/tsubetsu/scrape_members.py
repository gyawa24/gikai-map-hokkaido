"""
津別町議会 議員名簿スクレイパー
出力: site/data/tsubetsu/members.json
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.tsubetsu.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/choseijoho/tsubetsugikai/1/1904.html"

ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = ROOT / "site" / "data" / "tsubetsu"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = ROOT / "site" / "public" / "members" / "tsubetsu"
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


def absolute(url: str) -> str:
    if url.startswith("http"):
        return url
    if url.startswith("//"):
        return "https:" + url
    if url.startswith("/"):
        return BASE_URL + url
    return BASE_URL + "/" + url


def download_photo(remote_url: str, seat: int) -> str:
    ext = remote_url.split(".")[-1].split("?")[0].lower() or "jpg"
    if ext not in ("jpg", "jpeg", "png", "gif", "webp"):
        ext = "jpg"
    fname = f"seat_{seat}.{ext}"
    try:
        resp = requests.get(remote_url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(resp.content)
        return f"/members/tsubetsu/{fname}"
    except Exception as e:
        print(f"    [WARN] 写真取得失敗 {remote_url} -> {e}")
        return ""


def scrape_members():
    print("津別町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  取得不可: ページ取得失敗")
        return None

    content = soup.find("div", id="contents-in")
    if content is None:
        print("  取得不可: contents-in が見つからない")
        return None

    # h3「氏名 ○○（よみ）」の直後に div.img-text が来る構造。
    # 順序を保ったまま descendants をたどり、h3 → img-text をペアにする。
    name_re = re.compile(r"氏名\s*(.+?)[（(](.+?)[)）]")

    members = []
    current = None

    for el in content.descendants:
        tag = getattr(el, "name", None)
        if tag == "h3":
            text = el.get_text(strip=True)
            m = name_re.match(text)
            if m:
                current = {
                    "name": m.group(1).strip(),
                    "furigana": m.group(2).strip(),
                }
            else:
                current = None
        elif tag == "div" and "img-text" in (el.get("class") or []):
            if current is None:
                continue
            items = [li.get_text(strip=True) for li in el.find_all("li")]
            committees = []
            role = ""
            for item in items:
                if item.startswith("当選回数"):
                    continue
                if item in ("議長", "副議長"):
                    role = item
                    continue
                if "監査委員" in item:
                    committees.append(item)
                    continue
                if "委員会" in item:
                    committees.append(item)

            img = el.find("img")
            img_src = img.get("src") if img else ""

            seat = len(members) + 1
            photo_url = ""
            if img_src:
                photo_url = download_photo(absolute(img_src), seat)

            member = {
                "seat_number": seat,
                "name": current["name"],
                "furigana": current["furigana"],
                "party": "",
                "faction": "",
                "committees": committees,
                "photo_url": photo_url,
            }
            if role:
                member["role"] = role

            members.append(member)
            print(f"  [{seat}] {member['name']} ({member['furigana']}) -> 委員会 {committees}")
            current = None
            time.sleep(0.3)

    if not members:
        print("  取得不可: 議員ブロックを抽出できませんでした")
        return None

    out_path = OUTPUT_DIR / "members.json"
    with out_path.open("w", encoding="utf-8") as f:
        json.dump({"members": members}, f, ensure_ascii=False, indent=2)

    print(f"\n取得議員数: {len(members)}名 -> {out_path}")
    return members


if __name__ == "__main__":
    scrape_members()
