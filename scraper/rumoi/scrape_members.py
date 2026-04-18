"""
留萌市議会 議員名簿スクレイパー
出力: data/rumoi/members.json, site/data/rumoi/members.json
写真: site/public/members/rumoi/seat_N.jpg
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.e-rumoi.jp"
MEMBERS_URL = f"{BASE_URL}/gikai/gik_00009.html"

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = REPO_ROOT / "data" / "rumoi"
SITE_DATA_DIR = REPO_ROOT / "site" / "data" / "rumoi"
PHOTO_DIR = REPO_ROOT / "site" / "public" / "members" / "rumoi"

for d in (DATA_DIR, SITE_DATA_DIR, PHOTO_DIR):
    d.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

H2_RE = re.compile(r"^\s*(\d+)\s*番\s*(.+?)\s*[（(]\s*(.+?)\s*[)）]\s*$")


def fetch(url: str) -> requests.Response | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
        return resp
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def normalize(s: str) -> str:
    return re.sub(r"\s+", "", s or "").replace("\u3000", "")


def normalize_furigana(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").replace("\u3000", " ")).strip()


def parse_committees(cell_html_text: str) -> list[str]:
    parts = [p.strip() for p in re.split(r"[\n、,]", cell_html_text) if p.strip()]
    return [normalize(p).replace("\u3000", "") for p in parts]


def save_photo(src: str, seat: int) -> str:
    if not src:
        return ""
    url = src if src.startswith("http") else BASE_URL + src
    ext = url.split(".")[-1].split("?")[0].lower() or "jpg"
    if ext not in {"jpg", "jpeg", "png", "gif", "webp"}:
        ext = "jpg"
    fname = f"seat_{seat}.{ext}"
    try:
        r = requests.get(url, headers=HEADERS, timeout=15)
        r.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(r.content)
        return f"/members/rumoi/{fname}"
    except Exception as e:
        print(f"    [WARN] 写真取得失敗 {url}: {e}")
        return ""


def scrape() -> list[dict]:
    print(f"留萌市議会 議員名簿を収集中: {MEMBERS_URL}")
    resp = fetch(MEMBERS_URL)
    if resp is None:
        return []

    soup = BeautifulSoup(resp.text, "html.parser")
    h2s = soup.find_all("h2")

    members = []
    for h2 in h2s:
        heading = h2.get_text(" ", strip=True).replace("\u3000", " ")
        m = H2_RE.match(heading)
        if not m:
            continue

        seat = int(m.group(1))
        name = normalize(m.group(2))
        furigana = normalize_furigana(m.group(3))

        block = h2.find_next_sibling("div")
        party = ""
        committees: list[str] = []
        photo_src = ""

        if block:
            img = block.find("img")
            if img and img.get("src"):
                photo_src = img["src"]

            for row in block.find_all("tr"):
                th = row.find("th")
                td = row.find("td")
                if not th or not td:
                    continue
                label = normalize(th.get_text(" ", strip=True))
                value_text = td.get_text("\n", strip=True)
                if label == "会派":
                    party = normalize(value_text)
                elif label == "常任委員会等":
                    committees = parse_committees(value_text)

        print(f"  [{seat}] {name} ({furigana}) / {party} / {len(committees)}委員会")

        photo_url = save_photo(photo_src, seat)
        time.sleep(0.3)

        members.append({
            "seat_number": seat,
            "name": name,
            "furigana": furigana,
            "party": "",
            "faction": party,
            "committees": committees,
            "photo_url": photo_url,
        })

    members.sort(key=lambda x: x["seat_number"])
    return members


def main():
    members = scrape()
    if not members:
        print("取得不可: 議員データを抽出できませんでした")
        return

    payload = {"members": members}
    for out in (DATA_DIR / "members.json", SITE_DATA_DIR / "members.json"):
        out.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"  書き出し: {out}")

    print(f"取得議員数: {len(members)}名")


if __name__ == "__main__":
    main()
