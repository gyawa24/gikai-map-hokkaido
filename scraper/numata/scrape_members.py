"""
沼田町議会 議員名簿スクレイパー
出力:
  - data/numata/members.json
  - site/data/numata/members.json
  - site/public/members/numata/seat_N.{ext}
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.numata.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/section/gikai/ujj7s300000013t6.html"

REPO_ROOT = Path(__file__).parent.parent.parent
DATA_DIR = REPO_ROOT / "data" / "numata"
SITE_DATA_DIR = REPO_ROOT / "site" / "data" / "numata"
PHOTO_DIR = REPO_ROOT / "site" / "public" / "members" / "numata"
for d in (DATA_DIR, SITE_DATA_DIR, PHOTO_DIR):
    d.mkdir(parents=True, exist_ok=True)

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


NAME_FURI_RE = re.compile(r"^(?P<name>[^\(（]+)[（\(](?P<furi>[ぁ-ゞ　 ]+)[）\)]\s*$")


def parse_name_heading(text: str) -> tuple[str, str] | None:
    text = text.replace("\u3000", "　").strip()
    m = NAME_FURI_RE.match(text)
    if not m:
        return None
    name = re.sub(r"\s+", " ", m.group("name").replace("　", " ")).strip()
    furi = re.sub(r"\s+", " ", m.group("furi").replace("　", " ")).strip()
    return name, furi


FIELD_RE = re.compile(r"^(?P<key>[^：:]+)[：:]\s*(?P<val>.*)$")


def parse_info_list(ul) -> dict:
    info: dict = {}
    for li in ul.find_all("li"):
        text = li.get_text(strip=True).replace("\u3000", " ")
        m = FIELD_RE.match(text)
        if not m:
            continue
        info[m.group("key").strip()] = m.group("val").strip()
    return info


def split_roles_committees(roles_raw: str) -> tuple[str, list[str]]:
    """所属委員会等 文字列から faction（議長・副議長など）と委員会リストを抽出。"""
    if not roles_raw:
        return "", []
    parts = re.split(r"[・、,]", roles_raw)
    parts = [p.strip() for p in parts if p.strip()]
    faction_keywords = ("議長", "副議長")
    faction = ""
    committees: list[str] = []
    for p in parts:
        if any(kw == p or (kw in p and "委員" not in p) for kw in faction_keywords):
            faction = p if not faction else faction
        else:
            committees.append(p)
    return faction, committees


def download_photo(remote_url: str, seat: int) -> str:
    ext = remote_url.split(".")[-1].split("?")[0].lower() or "jpg"
    if ext not in ("jpg", "jpeg", "png", "gif", "webp"):
        ext = "jpg"
    fname = f"seat_{seat}.{ext}"
    try:
        r = requests.get(remote_url, headers=HEADERS, timeout=15)
        r.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(r.content)
        return f"/members/numata/{fname}"
    except Exception as e:
        print(f"    [写真DL失敗] {remote_url} -> {e}")
        return ""


def scrape():
    print("沼田町議会 議員名簿を収集中...")
    print(f"  URL: {MEMBERS_URL}")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("取得不可: ページ取得失敗")
        return None

    members = []
    seen_seats: set[int] = set()

    for h4 in soup.find_all("h4"):
        heading = h4.get_text(strip=True)
        parsed = parse_name_heading(heading)
        if not parsed:
            continue
        name, furigana = parsed

        img_src = ""
        info_ul = None
        current = h4
        for _ in range(30):
            current = current.find_next()
            if current is None:
                break
            if current.name == "h4":
                break
            if current.name == "img" and not img_src:
                src = current.get("src", "")
                if src:
                    img_src = src if src.startswith("http") else BASE_URL + src
            if current.name == "ul" and info_ul is None:
                info_ul = current
                break

        if info_ul is None:
            print(f"  [WARN] {name}: 情報リストが見つからないためスキップ")
            continue

        info = parse_info_list(info_ul)
        seat_raw = info.get("議席", "")
        m = re.search(r"\d+", seat_raw)
        if not m:
            print(f"  [WARN] {name}: 議席番号が読み取れないためスキップ")
            continue
        seat = int(m.group(0))
        if seat in seen_seats:
            continue
        seen_seats.add(seat)

        roles_raw = info.get("所属委員会等", "")
        faction, committees = split_roles_committees(roles_raw)
        party = info.get("党派", "").strip()

        photo_url = ""
        if img_src:
            photo_url = download_photo(img_src, seat)
            time.sleep(0.3)

        member = {
            "seat_number": seat,
            "name": name,
            "furigana": furigana,
            "party": party,
            "faction": faction,
            "committees": committees,
            "photo_url": photo_url,
        }
        members.append(member)
        print(f"  [{seat}] {name}（{furigana}） 党派={party} 役職={faction or '—'} 委員会={committees}")

    if not members:
        print("取得不可: 議員情報を抽出できませんでした")
        return None

    members.sort(key=lambda m: m["seat_number"])

    out = {
        "city": "numata",
        "city_name": "沼田町",
        "source_url": MEMBERS_URL,
        "count": len(members),
        "members": members,
    }

    for target in (DATA_DIR / "members.json", SITE_DATA_DIR / "members.json"):
        target.write_text(
            json.dumps(out, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"  書き込み: {target}")

    print(f"取得議員数: {len(members)}名")
    return members


if __name__ == "__main__":
    scrape()
