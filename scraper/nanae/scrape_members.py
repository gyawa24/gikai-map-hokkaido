"""
七飯町議会 議員名簿スクレイパー
出力: data/nanae/members.json  および  site/data/nanae/members.json
写真: site/public/members/nanae/seat_N.{ext}
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.nanae.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/hotnews/detail/00013109.html"

ROOT = Path(__file__).parent.parent.parent
DATA_DIR = ROOT / "data" / "nanae"
SITE_DATA_DIR = ROOT / "site" / "data" / "nanae"
PHOTO_DIR = ROOT / "site" / "public" / "members" / "nanae"
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
    return re.sub(r"\s+", "", text or "")


def parse_name_and_furigana(cell_text: str) -> tuple[str, str]:
    """「澤出　明宏（さわで　あきひろ）」→ ("澤出 明宏", "さわで あきひろ")"""
    m = re.match(r"\s*([^（(]+)[（(]([^）)]+)[）)]", cell_text)
    if not m:
        return re.sub(r"\s+", " ", cell_text.strip()), ""
    name = re.sub(r"[\u3000\s]+", " ", m.group(1).strip())
    furi = re.sub(r"[\u3000\s]+", " ", m.group(2).strip())
    return name, furi


def extract_seat_and_anchor(ol) -> list[tuple[int, str]]:
    """議員一覧 <ol> から (seat_number, anchor_id) のリストを返す"""
    out = []
    for idx, li in enumerate(ol.find_all("li"), start=1):
        a = li.find("a", href=True)
        if not a:
            continue
        href = a["href"]
        if href.startswith("#"):
            out.append((idx, href[1:]))
    return out


def parse_profile_table(table) -> dict:
    info = {"name_raw": "", "party": "", "faction": "", "committees": []}
    for row in table.find_all("tr"):
        th = row.find("th")
        td = row.find("td")
        if not th or not td:
            continue
        label = clean(th.get_text())
        if label == "氏名":
            info["name_raw"] = td.get_text(" ", strip=True)
        elif label == "党派":
            info["party"] = clean(td.get_text())
        elif label == "会派":
            info["faction"] = clean(td.get_text())
        elif label == "所属委員会":
            items = [clean(li.get_text()) for li in td.find_all("li")]
            if not items:
                txt = clean(td.get_text())
                items = [txt] if txt else []
            info["committees"] = [c for c in items if c]
    return info


def download_photo(img_src: str, seat: int) -> str:
    if not img_src:
        return ""
    url = img_src if img_src.startswith("http") else BASE_URL + img_src
    ext = url.split(".")[-1].split("?")[0].lower() or "jpg"
    if ext not in ("jpg", "jpeg", "png", "gif", "webp"):
        ext = "jpg"
    fname = f"seat_{seat}.{ext}"
    try:
        r = requests.get(url, headers=HEADERS, timeout=15)
        r.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(r.content)
        return f"/members/nanae/{fname}"
    except Exception as e:
        print(f"    [WARN] 写真取得失敗: {url} -> {e}")
        return ""


def scrape():
    print("七飯町議会 議員名簿を収集中...")
    resp = fetch(MEMBERS_URL)
    if resp is None:
        print("  ページ取得失敗")
        return None
    resp.encoding = resp.apparent_encoding
    soup = BeautifulSoup(resp.text, "html.parser")

    main = soup.find("div", id="page_maincontents") or soup

    # 議員一覧 <ol> を特定（最初の ol）
    ol = main.find("ol")
    if not ol:
        print("  議員一覧 <ol> が見つかりません")
        return None

    seat_anchors = extract_seat_and_anchor(ol)
    print(f"  議員一覧 {len(seat_anchors)} 件検出")
    if not seat_anchors:
        return None

    # 各 h2.pagetitle_a3 にぶら下がる img と table を拾う
    members = []
    for seat, anchor in seat_anchors:
        a_tag = main.find("a", id=anchor)
        if not a_tag:
            print(f"  [WARN] seat {seat}: anchor #{anchor} 見つからず")
            continue
        h2 = a_tag.find_parent("h2")
        if not h2:
            continue

        # 次に現れる img と table をたどる
        img_src = ""
        table = None
        for sib in h2.find_all_next():
            if sib.name == "h2":
                break
            if sib.name == "img" and not img_src:
                img_src = sib.get("src", "")
            if sib.name == "table" and table is None:
                table = sib
            if img_src and table:
                break

        if table is None:
            print(f"  [WARN] seat {seat}: プロフィール表が見つからず")
            continue

        info = parse_profile_table(table)
        name, furi = parse_name_and_furigana(info["name_raw"])

        photo_path = download_photo(img_src, seat)
        time.sleep(0.3)

        member = {
            "seat_number": seat,
            "name": name,
            "furigana": furi,
            "party": info["party"],
            "faction": info["faction"],
            "committees": info["committees"],
            "photo_url": photo_path,
        }
        print(f"  [{seat:>2}] {name} ({furi}) / 党派:{info['party']} / 会派:{info['faction']} / 委員会:{len(info['committees'])}")
        members.append(member)

    if not members:
        print("  議員データが1件も抽出できませんでした")
        return None

    out = {
        "city": "nanae",
        "city_name": "七飯町",
        "source_url": MEMBERS_URL,
        "members": members,
    }
    for dest in (DATA_DIR / "members.json", SITE_DATA_DIR / "members.json"):
        dest.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"  書き出し: {dest}")
    return out


if __name__ == "__main__":
    result = scrape()
    if result:
        print(f"\n取得議員数: {len(result['members'])}名")
    else:
        print("\n取得不可")
