"""
長万部町議会 議員名簿スクレイパー
出力: data/oshamambe/members.json
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.oshamambe.lg.jp"
MEMBERS_URL = f"{BASE_URL}/site/gikai/137.html"

ROOT = Path(__file__).parent.parent.parent
DATA_DIR = ROOT / "data" / "oshamambe"
SITE_DATA_DIR = ROOT / "site" / "data" / "oshamambe"
PHOTO_DIR = ROOT / "site" / "public" / "members" / "oshamambe"
for d in (DATA_DIR, SITE_DATA_DIR, PHOTO_DIR):
    d.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

HEADING_RE = re.compile(
    r"議席番号[：:]\s*(\d+)\s*番\s*([^\s（(]+)\s*([^\s（(]+)?\s*[（(]([^）)]+)[）)]"
)


def fetch(url: str) -> requests.Response | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
        return resp
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def parse_heading(text: str):
    """'議席番号：2番　橋本　收司（はしもと　しゅうじ）' → (2, '橋本 收司', 'はしもと しゅうじ')"""
    m = HEADING_RE.search(text)
    if not m:
        return None
    seat = int(m.group(1))
    first = m.group(2).strip()
    second = (m.group(3) or "").strip()
    name = (first + " " + second).strip() if second else first
    furigana = re.sub(r"\s+", " ", m.group(4).strip())
    return seat, name, furigana


def clean_role(text: str) -> str:
    # 議長マーク等を除去
    return text.replace("◎", "").replace("○", "").strip()


def scrape_members():
    print("長万部町議会 議員名簿を収集中...")
    resp = fetch(MEMBERS_URL)
    if resp is None:
        print("  ページ取得失敗")
        return None
    soup = BeautifulSoup(resp.text, "html.parser")

    members = []
    tables = soup.find_all("table")

    for table in tables:
        heading = table.find_previous(["h2", "h3", "h4", "h5"])
        if not heading:
            continue
        parsed = parse_heading(heading.get_text(" ", strip=True))
        if not parsed:
            continue
        seat, name, furigana = parsed

        row_map = {}
        for tr in table.find_all("tr"):
            cells = tr.find_all(["th", "td"])
            if len(cells) < 2:
                continue
            key = cells[0].get_text(strip=True)
            # 役職等は <p> で分割
            if key == "役職等":
                ps = cells[-1].find_all("p")
                if ps:
                    values = [clean_role(p.get_text(strip=True)) for p in ps]
                else:
                    values = [clean_role(cells[-1].get_text(strip=True))]
                row_map[key] = [v for v in values if v]
            elif key == "":
                # 写真セル
                img = cells[0].find("img") or (cells[1].find("img") if len(cells) > 1 else None)
                if img and img.get("src"):
                    row_map["_photo_src"] = img["src"]
                # 当選回数などは他のセル
                if len(cells) >= 3:
                    row_map[cells[1].get_text(strip=True)] = cells[2].get_text(strip=True)
            else:
                row_map[key] = cells[-1].get_text(strip=True)

        committees = [r for r in row_map.get("役職等", []) if r]
        party = row_map.get("党派", "").strip()

        member = {
            "seat_number": seat,
            "name": name,
            "furigana": furigana,
            "party": party,
            "faction": party,  # 会派情報なし。党派を流用
            "committees": committees,
            "photo_url": "",
        }

        # 写真保存
        photo_src = row_map.get("_photo_src")
        if photo_src:
            remote_url = photo_src if photo_src.startswith("http") else BASE_URL + photo_src
            ext = remote_url.split(".")[-1].split("?")[0].lower() or "jpg"
            if ext not in {"jpg", "jpeg", "png", "gif"}:
                ext = "jpg"
            fname = f"seat_{seat}.{ext}"
            try:
                r = requests.get(remote_url, headers=HEADERS, timeout=15)
                r.raise_for_status()
                (PHOTO_DIR / fname).write_bytes(r.content)
                member["photo_url"] = f"/members/oshamambe/{fname}"
                time.sleep(0.3)
            except Exception as e:
                print(f"    [WARN] 写真取得失敗 seat_{seat}: {e}")

        print(f"  [議席{seat}] {name} ({furigana}) / {party} / 役職{len(committees)}件")
        members.append(member)

    members.sort(key=lambda x: x["seat_number"])
    return members


def main():
    members = scrape_members()
    if not members:
        print("取得不可: 議員データが抽出できませんでした")
        return
    for path in (DATA_DIR / "members.json", SITE_DATA_DIR / "members.json"):
        path.write_text(
            json.dumps(members, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"  保存: {path}")
    print(f"取得議員数: {len(members)}名")


if __name__ == "__main__":
    main()
