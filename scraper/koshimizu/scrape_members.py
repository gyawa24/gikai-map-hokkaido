"""
小清水町議会 議員名簿スクレイパー
出力: data/koshimizu/members.json
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.koshimizu.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/gikai/detail/00000407.html"

ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = ROOT / "data" / "koshimizu"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
SITE_DATA_DIR = ROOT / "site" / "data" / "koshimizu"
SITE_DATA_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = ROOT / "site" / "public" / "members" / "koshimizu"
PHOTO_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

# 例: "1番　副議長　槻間　善髙（つきま　よしたか）"
#     "5番　議選監査委員　瓜田　新一（うりた　しんいち）"
#     "10番　議長　坂田　秀昭（さかた　ひであき）"
HEADER_RE = re.compile(
    r"^(\d+)番\s*"
    r"(?:(議長|副議長|議選監査委員)\s*)?"
    r"(\S[^\s（(]*?\s*\S+?)\s*"
    r"[（(]([^）)]+)[）)]\s*$"
)


def fetch_html(url: str) -> BeautifulSoup | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def download_photo(remote_url: str, seat: int) -> str:
    ext = remote_url.split(".")[-1].split("?")[0].lower() or "jpg"
    if ext not in ("jpg", "jpeg", "png", "gif"):
        ext = "jpg"
    fname = f"seat_{seat}.{ext}"
    try:
        r = requests.get(remote_url, headers=HEADERS, timeout=15)
        r.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(r.content)
        return f"/members/koshimizu/{fname}"
    except Exception as e:
        print(f"  [PHOTO ERROR] {remote_url} -> {e}")
        return ""


def collect_until_next_header(node):
    """同一議員ブロックに属する兄弟要素を次の pagetitle_a4 まで収集"""
    siblings = []
    for sib in node.next_siblings:
        if getattr(sib, "name", None) == "h2" and "pagetitle_a4" in (sib.get("class") or []):
            break
        siblings.append(sib)
    return siblings


def parse_block(header_h2) -> dict | None:
    title = header_h2.get_text(" ", strip=True).replace("\u3000", " ")
    title = re.sub(r"\s+", " ", title).strip()
    m = HEADER_RE.match(title)
    if not m:
        print(f"  [SKIP] 見出しパース失敗: {title}")
        return None
    seat = int(m.group(1))
    role = (m.group(2) or "").strip()
    name = re.sub(r"\s+", "", m.group(3))
    furigana = re.sub(r"\s+", "", m.group(4))

    siblings = collect_until_next_header(header_h2)

    photo_src = ""
    committees: list[str] = []
    in_committee = False

    for sib in siblings:
        tag = getattr(sib, "name", None)
        if tag == "img" and not photo_src:
            photo_src = sib.get("src", "")
        elif tag == "h2" and "pagetitle_a6" in (sib.get("class") or []):
            if "所属委員会" in sib.get_text(strip=True):
                in_committee = True
        elif in_committee and tag == "ul":
            for li in sib.find_all("li"):
                text = li.get_text(strip=True)
                if text:
                    committees.append(text)
        elif in_committee and tag is None:
            # 単一テキストノード（<ul>でない場合）
            text = str(sib).strip()
            if text and not text.startswith("<"):
                committees.append(text)

    member = {
        "seat_number": seat,
        "name": name,
        "furigana": furigana,
        "party": "",
        "faction": "",
        "committees": committees,
        "photo_url": "",
    }
    if role:
        member["role"] = role

    if photo_src:
        remote = photo_src if photo_src.startswith("http") else BASE_URL + photo_src
        time.sleep(0.3)
        member["photo_url"] = download_photo(remote, seat)

    return member


def scrape():
    print(f"小清水町議会 議員名簿を収集中... {MEMBERS_URL}")
    soup = fetch_html(MEMBERS_URL)
    if soup is None:
        print("ページ取得失敗")
        return

    headers = soup.find_all("h2", class_="pagetitle_a4")
    print(f"  議員見出し {len(headers)} 件発見")

    members: list[dict] = []
    for h in headers:
        m = parse_block(h)
        if m:
            print(f"  [{m['seat_number']}] {m['name']} ({m['furigana']}) 委員会: {len(m['committees'])}件")
            members.append(m)

    if not members:
        print("議員データを取得できませんでした。members.json を作成しません。")
        return

    members.sort(key=lambda x: x["seat_number"])

    output = {
        "city": "koshimizu",
        "source_url": MEMBERS_URL,
        "updated_at": time.strftime("%Y-%m-%d"),
        "members": members,
    }

    (OUTPUT_DIR / "members.json").write_text(
        json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (SITE_DATA_DIR / "members.json").write_text(
        json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"完了: {len(members)} 名保存")


if __name__ == "__main__":
    scrape()
