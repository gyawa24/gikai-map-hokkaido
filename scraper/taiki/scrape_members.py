"""
大樹町議会 議員名簿スクレイパー
出力: data/taiki/members.json + site/data/taiki/members.json
写真: site/public/members/taiki/seat_N.{ext}
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.taiki.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/choseijoho/taikichogikai/1194.html"

REPO_ROOT = Path(__file__).parent.parent.parent
DATA_DIR = REPO_ROOT / "data" / "taiki"
SITE_DATA_DIR = REPO_ROOT / "site" / "data" / "taiki"
PHOTO_DIR = REPO_ROOT / "site" / "public" / "members" / "taiki"

for d in (DATA_DIR, SITE_DATA_DIR, PHOTO_DIR):
    d.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def fetch(url: str) -> requests.Response | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
        return resp
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def normalize_url(src: str) -> str:
    if src.startswith("http"):
        return src
    if src.startswith("//"):
        return "https:" + src
    return BASE_URL + src


def parse_committees(cell) -> list[str]:
    items = cell.find_all("li")
    if items:
        return [li.get_text(strip=True) for li in items]
    text = cell.get_text(strip=True)
    return [text] if text else []


def download_photo(src: str, seat: int) -> str:
    remote_url = normalize_url(src)
    ext = remote_url.split(".")[-1].split("?")[0].lower() or "jpg"
    fname = f"seat_{seat}.{ext}"
    try:
        img_resp = requests.get(remote_url, headers=HEADERS, timeout=15)
        img_resp.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(img_resp.content)
        return f"/members/taiki/{fname}"
    except Exception as e:
        print(f"    [WARN] photo download failed: {e}")
        return ""


def scrape_members() -> list[dict]:
    print("大樹町議会 議員名簿を収集中...")
    resp = fetch(MEMBERS_URL)
    if resp is None:
        return []

    soup = BeautifulSoup(resp.text, "html.parser")
    table = soup.find("table")
    if table is None:
        print("  [ERROR] 議員テーブルが見つかりません")
        return []

    members: list[dict] = []
    rows = table.find("tbody").find_all("tr") if table.find("tbody") else table.find_all("tr")

    for row in rows:
        th = row.find("th")
        tds = row.find_all("td")
        if th is None or len(tds) < 4:
            continue
        seat_text = th.get_text(strip=True)
        m = re.match(r"(\d+)", seat_text)
        if not m:
            continue
        seat_number = int(m.group(1))

        # td[0] photo, td[1] name, td[2] party, td[3] election count, td[4] committees
        photo_cell = tds[0]
        name = re.sub(r"\s+", " ", tds[1].get_text(strip=True))
        party = tds[2].get_text(strip=True)
        committees = parse_committees(tds[4]) if len(tds) >= 5 else []

        img = photo_cell.find("img")
        photo_url = ""
        if img and img.get("src"):
            photo_url = download_photo(img["src"], seat_number)
            time.sleep(0.3)

        member = {
            "seat_number": seat_number,
            "name": name,
            "furigana": "",
            "party": party,
            "faction": "",
            "committees": committees,
            "photo_url": photo_url,
        }
        print(f"  [{seat_number}] {name} / {party} / {committees}")
        members.append(member)

    members.sort(key=lambda x: x["seat_number"])
    return members


def main() -> None:
    members = scrape_members()
    if not members:
        print("取得不可: 議員データが取得できませんでした")
        return

    payload = json.dumps(members, ensure_ascii=False, indent=2)
    (DATA_DIR / "members.json").write_text(payload, encoding="utf-8")
    (SITE_DATA_DIR / "members.json").write_text(payload, encoding="utf-8")
    print(f"取得議員数: {len(members)}名")
    print(f"出力: {DATA_DIR / 'members.json'}")
    print(f"出力: {SITE_DATA_DIR / 'members.json'}")


if __name__ == "__main__":
    main()
