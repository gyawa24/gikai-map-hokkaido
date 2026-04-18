"""
滝上町議会 議員名簿スクレイパー
出力: data/takinoue/members.json
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup, Tag

BASE_URL = "https://www.town.takinoue.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/gikai/kosei/meibo.html"

REPO_ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = REPO_ROOT / "data" / "takinoue"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = REPO_ROOT / "site" / "public" / "members" / "takinoue"
PHOTO_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

FULL_TO_HALF = {"０": "0", "１": "1", "２": "2", "３": "3", "４": "4",
                "５": "5", "６": "6", "７": "7", "８": "8", "９": "9"}


def to_ascii_digits(s: str) -> str:
    return "".join(FULL_TO_HALF.get(c, c) for c in s)


def fetch(url: str) -> requests.Response | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
        return resp
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def split_faction(committees_text: str) -> tuple[str, list[str]]:
    """委員会リストから 議長/副議長 を faction に切り出す"""
    faction = ""
    items = [c.strip() for c in re.split(r"[、,]", committees_text) if c.strip()]
    cleaned = []
    for c in items:
        if c in ("議長", "副議長"):
            faction = c
        else:
            cleaned.append(c)
    return faction, cleaned


def parse_section(section_html: str, seat: int, heading_text: str) -> dict | None:
    """議席N見出しの直後から次の見出しまでのHTMLをパース"""
    sub = BeautifulSoup(section_html, "html.parser")

    # 氏名: strong または b
    name_el = sub.find(["strong", "b"])
    name = re.sub(r"\s+", " ", name_el.get_text(strip=True)) if name_el else ""

    # ふりがな: （ひらがな）パターン
    blob = sub.get_text(" ", strip=True)
    furigana = ""
    fm = re.search(r"[（(]([ぁ-ん][ぁ-ん\s]*)[）)]", blob)
    if fm:
        furigana = re.sub(r"\s+", " ", fm.group(1)).strip()

    # 委員会
    committees_text = ""
    for li in sub.find_all("li"):
        txt = li.get_text(strip=True)
        if "所属委員会" in txt:
            committees_text = re.sub(r"^[^：:]*[：:]\s*", "", txt)
            break

    faction, committees = split_faction(committees_text)

    # 議席見出しに 議長/副議長 が書かれている場合
    if "副議長" in heading_text and not faction:
        faction = "副議長"
    elif "議長" in heading_text and not faction:
        faction = "議長"

    # 写真
    photo_src = ""
    img = sub.find("img")
    if img and img.get("src"):
        photo_src = img["src"]

    return {
        "seat_number": seat,
        "name": name,
        "furigana": furigana,
        "party": "",
        "faction": faction,
        "committees": committees,
        "photo_url": "",
        "_photo_src": photo_src,
    }


def save_photo(seat: int, photo_src: str) -> str:
    if not photo_src:
        return ""
    remote_url = photo_src if photo_src.startswith("http") else BASE_URL + photo_src
    ext = remote_url.split(".")[-1].split("?")[0].lower()
    if ext not in ("jpg", "jpeg", "png", "gif"):
        ext = "jpg"
    fname = f"seat_{seat}.{ext}"
    try:
        img_resp = requests.get(remote_url, headers=HEADERS, timeout=15)
        img_resp.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(img_resp.content)
        time.sleep(0.3)
        return f"/members/takinoue/{fname}"
    except Exception as e:
        print(f"    [WARN] 写真取得失敗 seat={seat}: {e}")
        return ""


def scrape_members():
    print("滝上町議会 議員名簿を収集中...")
    resp = fetch(MEMBERS_URL)
    if resp is None:
        return

    html = resp.text
    # 議席見出しで分割（h2 class="pagetitle_a4" を起点に）
    # 見出しテキストと後続HTMLを対にするため、見出しタグの位置で切る
    pattern = re.compile(
        r'<h2\s+class=pagetitle_a4\s*>\s*(議席[0-9０-９]+[^<]*)</h2>',
        re.IGNORECASE,
    )
    matches = list(pattern.finditer(html))
    if not matches:
        print("  議席見出しが見つかりません")
        return

    print(f"  議席見出し {len(matches)} 件発見")

    members = []
    for i, m in enumerate(matches):
        heading_text = m.group(1).strip()
        seat_m = re.match(r"議席\s*([0-9０-９]+)", heading_text)
        if not seat_m:
            continue
        seat = int(to_ascii_digits(seat_m.group(1)))

        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(html)
        section_html = html[start:end]
        # セクションは次の pagetitle_a4 まで、ただし </article> 等で止める
        cut_at = re.search(r'</article|<input\s+type=hidden\s+name=pdf_link_area',
                           section_html, re.IGNORECASE)
        if cut_at:
            section_html = section_html[:cut_at.start()]

        member = parse_section(section_html, seat, heading_text)
        if not member or not member["name"]:
            print(f"  [議席{seat}] 氏名を抽出できません")
            continue

        photo_url = save_photo(seat, member.pop("_photo_src", ""))
        member["photo_url"] = photo_url

        print(f"  [議席{seat}] {member['name']} ({member['furigana']}) "
              f"faction={member['faction']} committees={len(member['committees'])}件")
        members.append(member)

    if not members:
        print("  議員情報を抽出できませんでした")
        return

    members.sort(key=lambda x: x["seat_number"])
    out_path = OUTPUT_DIR / "members.json"
    out_path.write_text(
        json.dumps(members, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"\n完了: {out_path} ({len(members)}名)")


if __name__ == "__main__":
    scrape_members()
