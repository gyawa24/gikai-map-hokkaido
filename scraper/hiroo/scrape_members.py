"""
広尾町議会 議員名簿スクレイパー
出力:
  - data/hiroo/members.json
  - site/data/hiroo/members.json
  - site/public/members/hiroo/seat_N.jpg
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.hiroo.lg.jp"
MEMBERS_URL = f"{BASE_URL}/gikai/gikai_giinshoukai/"

ROOT = Path(__file__).parent.parent.parent
DATA_DIR = ROOT / "data" / "hiroo"
SITE_DATA_DIR = ROOT / "site" / "data" / "hiroo"
PHOTO_DIR = ROOT / "site" / "public" / "members" / "hiroo"
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
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.raise_for_status()
        return resp
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def clean(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("\u3000", " ")).strip()


def parse_seat_and_name(heading: str) -> tuple[int | None, str]:
    # e.g. "1番　斎藤弘樹"
    m = re.match(r"\s*(\d+)\s*番[\s\u3000]*(.+)$", heading)
    if not m:
        return None, clean(heading)
    return int(m.group(1)), clean(m.group(2))


def parse_name_furigana(cell_text: str) -> tuple[str, str]:
    # e.g. "1番　斎藤弘樹（さいとうひろき）"
    text = clean(cell_text)
    text = re.sub(r"^\d+\s*番\s*", "", text)
    m = re.match(r"(.+?)\s*[（(]\s*([ぁ-んー\s]+?)\s*[)）]\s*$", text)
    if m:
        return clean(m.group(1)), clean(m.group(2))
    return text, ""


def parse_party(party_text: str) -> str:
    # e.g. "無所属・1期" -> "無所属"
    return clean(party_text.split("・")[0])


def parse_committees(text: str) -> list[str]:
    parts = re.split(r"<br\s*/?>|[\n\r]+", text)
    return [clean(p) for p in parts if clean(p)]


def download_photo(url: str, seat: int) -> str:
    ext = url.split(".")[-1].split("?")[0].lower()
    if ext not in ("jpg", "jpeg", "png", "gif"):
        ext = "jpg"
    fname = f"seat_{seat}.{ext}"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(resp.content)
        return f"/members/hiroo/{fname}"
    except Exception as e:
        print(f"  [WARN] 写真取得失敗 {url}: {e}")
        return ""


def scrape_members() -> list[dict]:
    print("広尾町議会 議員名簿を収集中...")
    resp = fetch(MEMBERS_URL)
    if resp is None:
        return []
    resp.encoding = resp.apparent_encoding or "utf-8"
    soup = BeautifulSoup(resp.text, "html.parser")

    main = soup.find("main") or soup
    headings = main.find_all("h2", class_="common-title")

    members: list[dict] = []
    for h in headings:
        heading_text = clean(h.get_text())
        if "番" not in heading_text:
            continue
        seat, name_from_heading = parse_seat_and_name(heading_text)
        if seat is None:
            continue

        # Walk forward through siblings (paragraphs) until the next h2/heading
        parent = h.parent  # .paragraph .col-15 .h3
        img_src = ""
        table = None
        node = parent.find_next_sibling()
        while node is not None:
            # stop if we hit another member heading block
            inner_h2 = node.find("h2", class_="common-title") if hasattr(node, "find") else None
            if inner_h2 and "番" in clean(inner_h2.get_text()):
                break
            if hasattr(node, "find"):
                if not img_src:
                    img = node.find("img")
                    if img and img.get("src"):
                        img_src = img["src"]
                if table is None:
                    t = node.find("table")
                    if t:
                        table = t
            if img_src and table is not None:
                break
            node = node.find_next_sibling()

        name = name_from_heading
        furigana = ""
        party = ""
        committees: list[str] = []

        if table is not None:
            for tr in table.find_all("tr"):
                th = tr.find("th")
                td = tr.find("td")
                if not th or not td:
                    continue
                label = clean(th.get_text())
                # for committees preserve <br> as newlines
                if "所属委員会" in label:
                    for br in td.find_all("br"):
                        br.replace_with("\n")
                    committees = [clean(x) for x in td.get_text().split("\n") if clean(x)]
                elif "氏名" in label:
                    n, f = parse_name_furigana(td.get_text())
                    if n:
                        name = n
                    if f:
                        furigana = f
                elif "党派" in label:
                    party = parse_party(td.get_text())

        photo_url = ""
        if img_src:
            remote = img_src if img_src.startswith("http") else BASE_URL + img_src
            photo_url = download_photo(remote, seat)
            time.sleep(0.3)

        print(f"  [{seat}] {name} ({furigana}) — {party}")
        members.append({
            "seat_number": seat,
            "name": name,
            "furigana": furigana,
            "party": party,
            "faction": "",
            "committees": committees,
            "photo_url": photo_url,
        })

    members.sort(key=lambda m: m["seat_number"])
    return members


def main():
    members = scrape_members()
    if not members:
        print("取得不可: 議員情報を抽出できませんでした")
        return
    payload = {"members": members}
    for out in (DATA_DIR / "members.json", SITE_DATA_DIR / "members.json"):
        out.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"  書き込み: {out}")
    print(f"取得議員数: {len(members)}名")


if __name__ == "__main__":
    main()
