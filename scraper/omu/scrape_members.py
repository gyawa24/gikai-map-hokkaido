"""
雄武町議会 議員名簿スクレイパー
出力: data/omu/members.json
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.oumu.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/gyoseijoho/omuchogikai/891.html"

ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = ROOT / "data" / "omu"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = ROOT / "site" / "public" / "members" / "omu"
PHOTO_DIR.mkdir(parents=True, exist_ok=True)
SITE_DATA_DIR = ROOT / "site" / "data" / "omu"
SITE_DATA_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

HEADING_RE = re.compile(
    r"議席番号\s*(\d+)\s*番(?:（(議長|副議長)）)?\s*([^\s（(]+(?:\s+[^\s（(]+)?)\s*[（(]([^）)]+)[）)]"
)


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
    return BASE_URL + url


def download_photo(url: str, seat: int) -> str:
    ext = url.split(".")[-1].split("?")[0].lower() or "jpg"
    if ext not in {"jpg", "jpeg", "png", "gif", "webp"}:
        ext = "jpg"
    fname = f"seat_{seat}.{ext}"
    for attempt in range(3):
        try:
            resp = requests.get(url, headers=HEADERS, timeout=30)
            resp.raise_for_status()
            (PHOTO_DIR / fname).write_bytes(resp.content)
            return f"/members/omu/{fname}"
        except Exception as e:
            if attempt == 2:
                print(f"    [WARN] photo download failed: {e}")
                return ""
            time.sleep(1.0)
    return ""


def parse_committee_table(table) -> tuple[str, list[str]]:
    """所属党派等 / 所属委員会等 を抽出"""
    party = ""
    committees: list[str] = []
    for tr in table.find_all("tr"):
        th = tr.find("th")
        td = tr.find("td")
        if not th or not td:
            continue
        label = th.get_text(strip=True)
        value = td.get_text(" ", strip=True)
        value = re.sub(r"\s+", " ", value).strip()
        if "所属党派" in label or "会派" in label:
            if value and value not in ("なし", "無所属"):
                party = value
        elif "委員会" in label:
            # li 要素があればそれを優先
            lis = td.find_all("li")
            if lis:
                parts = [li.get_text(" ", strip=True) for li in lis]
            else:
                if not value:
                    continue
                clean = re.sub(r"\(注意\)[^\s]*", "", value).strip()
                if not clean:
                    continue
                parts = re.split(r"[、,／/・]|\s{2,}", clean)
            for p in parts:
                p = re.sub(r"\s+", " ", p).strip()
                p = re.sub(r"^\(注意\)", "", p).strip()
                if p and p not in committees:
                    committees.append(p)
    return party, committees


def scrape():
    print("雄武町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return

    members = []
    for h3 in soup.find_all("h3"):
        text = h3.get_text(" ", strip=True)
        text = re.sub(r"\s+", " ", text)
        m = HEADING_RE.search(text)
        if not m:
            continue

        seat = int(m.group(1))
        role = m.group(2) or ""
        name = re.sub(r"\s+", " ", m.group(3).strip())
        furigana = re.sub(r"\s+", "", m.group(4).strip())

        # 次の h3 まで、または最初の table を見つけるまでを対象範囲にする
        photo_url = ""
        party = ""
        committees: list[str] = []
        table_seen = False
        for sib in h3.find_all_next():
            if sib.name == "h3":
                break
            if sib.name == "img" and not photo_url and not table_seen:
                src = sib.get("src", "")
                # 議員写真は /material/images/group/ 配下
                if src and "/material/images/group/" in src:
                    photo_url = download_photo(absolute(src), seat)
                    time.sleep(0.3)
            elif sib.name == "table" and not table_seen:
                party, committees = parse_committee_table(sib)
                table_seen = True
                # 最後の議員はここで打ち切り（次の h3 が無いため）
                break

        member = {
            "seat_number": seat,
            "name": name,
            "furigana": furigana,
            "party": party,
            "faction": "",
            "committees": committees,
        }
        if role:
            member["role"] = role
        if photo_url:
            member["photo_url"] = photo_url

        print(f"  [{seat}番] {name}（{furigana}）{role} 委員会={committees}")
        members.append(member)

    if not members:
        print("  議員データが抽出できませんでした")
        return

    members.sort(key=lambda x: x["seat_number"])

    out_path = OUTPUT_DIR / "members.json"
    with out_path.open("w", encoding="utf-8") as f:
        json.dump({"members": members}, f, ensure_ascii=False, indent=2)
    print(f"  -> {out_path} ({len(members)}名)")

    # site/data にも同期
    site_out = SITE_DATA_DIR / "members.json"
    with site_out.open("w", encoding="utf-8") as f:
        json.dump({"members": members}, f, ensure_ascii=False, indent=2)
    print(f"  -> {site_out}")


if __name__ == "__main__":
    scrape()
