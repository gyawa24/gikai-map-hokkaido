"""
佐呂間町議会 議員名簿スクレイパー
出力: data/saroma/members.json + site/data/saroma/members.json
写真: site/public/members/saroma/seat_N.jpg
"""

import json
import re
import time
import unicodedata
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.saroma.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/gikai/gikai_about/giinshoukai.html"

REPO_ROOT = Path(__file__).parent.parent.parent
DATA_DIR = REPO_ROOT / "data" / "saroma"
SITE_DATA_DIR = REPO_ROOT / "site" / "data" / "saroma"
PHOTO_DIR = REPO_ROOT / "site" / "public" / "members" / "saroma"
for d in (DATA_DIR, SITE_DATA_DIR, PHOTO_DIR):
    d.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def fetch_html(url: str) -> BeautifulSoup | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding or "utf-8"
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def to_int_seat(text: str) -> int | None:
    s = unicodedata.normalize("NFKC", text).strip()
    m = re.search(r"\d+", s)
    return int(m.group()) if m else None


def split_name_furigana(text: str) -> tuple[str, str]:
    t = text.replace("\u3000", " ").strip()
    m = re.match(r"^(.+?)\s*[（(]\s*(.+?)\s*[）)]\s*$", t)
    if m:
        name = re.sub(r"\s+", "", m.group(1))
        furigana = re.sub(r"\s+", "", m.group(2))
        return name, furigana
    return re.sub(r"\s+", "", t), ""


def split_committees(text: str) -> list[str]:
    if not text:
        return []
    parts = re.split(r"[、,，\s]+", text.strip())
    return [p for p in parts if p]


def download_photo(remote_url: str, seat: int) -> str | None:
    ext = remote_url.rsplit(".", 1)[-1].split("?")[0].lower() or "jpg"
    if ext not in {"jpg", "jpeg", "png", "gif", "webp"}:
        ext = "jpg"
    fname = f"seat_{seat}.{ext}"
    try:
        r = requests.get(remote_url, headers=HEADERS, timeout=20)
        r.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(r.content)
        return f"/members/saroma/{fname}"
    except Exception as e:
        print(f"    [photo ERROR] {remote_url} -> {e}")
        return None


def scrape() -> list[dict]:
    print(f"佐呂間町議会 議員名簿を収集中: {MEMBERS_URL}")
    soup = fetch_html(MEMBERS_URL)
    if soup is None:
        return []

    table = soup.find("table")
    if table is None:
        print("  [ERROR] 表が見つかりません")
        return []

    members: list[dict] = []
    rows = table.find_all("tr")
    # ヘッダー行を除いたデータ行
    for row in rows[1:]:
        cells = row.find_all(["td", "th"])
        if len(cells) < 2:
            continue

        seat = to_int_seat(cells[0].get_text(" ", strip=True))
        name_cell_text = cells[1].get_text(" ", strip=True)
        if not seat or not name_cell_text:
            continue

        # 欠員行はスキップ
        if "欠" in name_cell_text and "員" in name_cell_text:
            print(f"  seat {seat}: 欠員 (skip)")
            continue

        name, furigana = split_name_furigana(name_cell_text)

        # 政党（「なし」は空扱い）
        party = ""
        if len(cells) >= 5:
            party_text = cells[4].get_text(" ", strip=True)
            if party_text and party_text != "なし":
                party = party_text

        # 委員会
        committees: list[str] = []
        if len(cells) >= 7:
            committees = split_committees(cells[6].get_text(" ", strip=True))

        # 写真
        photo_url = ""
        if len(cells) >= 3:
            img = cells[2].find("img")
            if img and img.get("src"):
                src = img["src"]
                if src.startswith("http"):
                    remote = src
                elif src.startswith("/"):
                    remote = BASE_URL + src
                else:
                    # 相対パス: giin紹介ページからの相対
                    remote = f"{BASE_URL}/gikai/gikai_about/{src}"
                downloaded = download_photo(remote, seat)
                if downloaded:
                    photo_url = downloaded
                time.sleep(0.3)

        member = {
            "seat_number": seat,
            "name": name,
            "furigana": furigana,
            "party": party,
            "faction": "",
            "committees": committees,
        }
        if photo_url:
            member["photo_url"] = photo_url

        print(f"  seat {seat}: {name} ({furigana}) party={party!r} committees={committees}")
        members.append(member)

    members.sort(key=lambda m: m["seat_number"])
    return members


def main():
    members = scrape()
    if not members:
        print("取得不可: 議員データが取得できませんでした")
        return

    payload = {
        "source_url": MEMBERS_URL,
        "members": members,
    }
    for target in (DATA_DIR / "members.json", SITE_DATA_DIR / "members.json"):
        target.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"  wrote {target}")

    print(f"取得議員数: {len(members)}名")


if __name__ == "__main__":
    main()
