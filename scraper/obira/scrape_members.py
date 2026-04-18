"""
小平町議会 議員名簿スクレイパー

HTML: https://www.town.obira.hokkaido.jp/hotnews/detail/00001210.html
出力:
  - data/obira/members.json
  - site/data/obira/members.json
  - site/public/members/obira/seat_N.jpg
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.obira.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/hotnews/detail/00001210.html"

ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = ROOT / "data" / "obira"
SITE_DATA_DIR = ROOT / "site" / "data" / "obira"
PHOTO_DIR = ROOT / "site" / "public" / "members" / "obira"
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
        resp.encoding = resp.apparent_encoding
        return resp
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def strip_ws(s: str) -> str:
    return re.sub(r"[\s\u3000]+", "", s or "")


def parse_name_cell(td) -> tuple[str, str, str]:
    """氏名セルから (name, furigana, role) を取得"""
    text = td.get_text(" ", strip=True)
    text = re.sub(r"\s+", " ", text)

    role = ""
    m = re.search(r"[（(]([^）)]+)[）)]", text)
    if m:
        role = strip_ws(m.group(1))
        text = re.sub(r"[（(][^）)]+[）)]", "", text)

    text = re.sub(r"氏\s*名", "", text)

    furigana_parts = re.findall(r"[ぁ-ん]+", text)
    furigana = "".join(furigana_parts)

    kanji_text = re.sub(r"[ぁ-んァ-ヴー]", "", text)
    kanji_text = re.sub(r"[0-9０-９]", "", kanji_text)
    kanji_text = kanji_text.replace("歳", "")
    name = re.sub(r"[^\u4e00-\u9fff]", "", kanji_text)

    return name, furigana, role


def parse_committees_cell(td) -> list[str]:
    # 入れ子 div がある行（議席3など）では親div を無視し、子孫 div を持たない
    # リーフ div のみを採用する
    items: list[str] = []
    leaf_divs = [d for d in td.find_all("div") if d.find("div") is None]
    for div in leaf_divs:
        t = strip_ws(div.get_text(" ", strip=True))
        if not t or t == "所属委員会等":
            continue
        if t in items:
            continue
        items.append(t)
    if not items:
        for line in td.get_text("\n", strip=True).split("\n"):
            t = strip_ws(line)
            if t and t != "所属委員会等" and t not in items:
                items.append(t)
    return items


def parse_faction_cell(td) -> str:
    text = strip_ws(td.get_text(" ", strip=True))
    m = re.search(r"会派([^当]+?)(?:当選回数|$)", text)
    return m.group(1).strip() if m else ""


def download_photo(seat: int, src: str) -> str:
    remote = src if src.startswith("http") else BASE_URL + src
    ext = remote.rsplit(".", 1)[-1].split("?")[0].lower() or "jpg"
    fname = f"seat_{seat}.{ext}"
    try:
        r = requests.get(remote, headers=HEADERS, timeout=20)
        r.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(r.content)
        print(f"    写真保存: {fname}")
        return f"/members/obira/{fname}"
    except Exception as e:
        print(f"    [WARN] 写真取得失敗 {remote}: {e}")
        return ""


def scrape() -> list[dict]:
    print(f"取得: {MEMBERS_URL}")
    resp = fetch(MEMBERS_URL)
    if resp is None:
        return []
    soup = BeautifulSoup(resp.text, "html.parser")

    img_pat = re.compile(r"/hotnews/files/00001200/00001210/(\d+)\.jpg", re.I)
    imgs = soup.find_all("img", src=img_pat)
    print(f"  議員写真 {len(imgs)} 件発見")

    members: list[dict] = []

    for img in imgs:
        m = img_pat.search(img["src"])
        if not m:
            continue
        seat_num = int(m.group(1))

        tr_first = img.find_parent("tr")
        if tr_first is None:
            continue

        rows = [tr_first]
        sib = tr_first
        while len(rows) < 4:
            sib = sib.find_next_sibling("tr")
            if sib is None:
                break
            rows.append(sib)
        if len(rows) < 4:
            print(f"  [WARN] 議席{seat_num}: 行数不足 ({len(rows)})")
            continue

        name_td = rows[0].find_all("td")[-1]
        name, furigana, role = parse_name_cell(name_td)

        committee_td = rows[1].find("td")
        committees = parse_committees_cell(committee_td)
        if role and role not in committees:
            committees.insert(0, role)

        faction_td = rows[2].find("td")
        faction = parse_faction_cell(faction_td)

        photo_url = download_photo(seat_num, img["src"])
        time.sleep(0.3)

        member = {
            "seat_number": seat_num,
            "name": name,
            "furigana": furigana,
            "party": "",
            "faction": faction,
            "committees": committees,
            "photo_url": photo_url,
        }
        print(f"  [{seat_num}] {name} ({furigana}) / {faction} / 役職:{role or '-'} / 委員会:{len(committees)}")
        members.append(member)

    members.sort(key=lambda x: x["seat_number"])
    return members


def main() -> int:
    members = scrape()
    if not members:
        print("取得不可: 議員データを抽出できませんでした")
        return 1

    payload = {"members": members}
    for out in (DATA_DIR / "members.json", SITE_DATA_DIR / "members.json"):
        out.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"  出力: {out}")

    print(f"取得議員数: {len(members)}名")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
