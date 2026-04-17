"""
江別市議会 議員名簿スクレイパー
出力:
  - site/data/ebetsu/members.json
  - site/public/members/ebetsu/seat_N.jpg (顔写真)

江別市公式サイトには議席番号が公開されていないため、
掲載順（五十音順）を seat_number として付番する。
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.city.ebetsu.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/site/gikai/2002.html"

ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = ROOT / "site" / "data" / "ebetsu"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = ROOT / "site" / "public" / "members" / "ebetsu"
PHOTO_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

# 会派名 → 政党名の対応（会派名に含まれれば該当政党と判定）
PARTY_KEYWORDS = [
    ("公明党", "公明党"),
    ("日本共産党", "日本共産党"),
    ("自民党", "自由民主党"),
    ("自由民主党", "自由民主党"),
    ("立憲民主党", "立憲民主党"),
    ("国民民主党", "国民民主党"),
    ("日本維新の会", "日本維新の会"),
    ("れいわ新選組", "れいわ新選組"),
    ("社民党", "社会民主党"),
    ("無所属", ""),
]


def normalize(text: str) -> str:
    """全角/半角スペース・nbsp を整理。"""
    return re.sub(r"[\s\u3000\xa0]+", " ", text).strip()


def fetch(url: str) -> BeautifulSoup | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def split_name_furigana(heading: str) -> tuple[str, str]:
    """'石川 麻美（いしかわ あさみ）' → ('石川 麻美', 'いしかわ あさみ')"""
    heading = normalize(heading)
    m = re.match(r"^(.+?)[（(]([^）)]+)[）)]\s*$", heading)
    if not m:
        return heading, ""
    name = normalize(m.group(1))
    furigana = normalize(m.group(2))
    return name, furigana


def infer_party(faction: str) -> str:
    for kw, party in PARTY_KEYWORDS:
        if kw in faction:
            return party
    return ""


def parse_detail_lines(p_tag) -> list[str]:
    """<p> 内のテキストを <br> 単位で分割して行リストにする。"""
    html = p_tag.decode_contents()
    html = re.sub(r"<img[^>]*/?>", "", html, flags=re.I)
    parts = re.split(r"<br\s*/?>", html, flags=re.I)
    lines = []
    for part in parts:
        text = BeautifulSoup(part, "html.parser").get_text()
        text = normalize(text)
        if text:
            lines.append(text)
    return lines


def extract_member(h3, p_tag, seat_number: int) -> dict | None:
    name, furigana = split_name_furigana(h3.get_text())
    if not name or len(name) < 2:
        return None

    lines = parse_detail_lines(p_tag)

    faction = ""
    committees: list[str] = []
    for line in lines:
        # 郵便番号・住所・電話・メールは除外
        if re.match(r"^〒", line) or re.search(r"@", line):
            continue
        if re.search(r"\d{2,4}-\d{2,4}-\d{3,4}", line):
            continue
        if re.match(r"^\d+回$", line):
            continue
        if "江別市" in line and "議員" not in line:
            continue

        if "委員会" in line or line in ("議長", "副議長"):
            committees.append(line)
        elif not faction:
            # 最初の非該当行を会派とみなす
            faction = line

    # 顔写真
    photo_url = ""
    img = p_tag.find("img", src=True)
    if img:
        src = img["src"]
        remote_url = src if src.startswith("http") else BASE_URL + src
        ext = remote_url.split(".")[-1].split("?")[0].lower()
        if ext not in ("jpg", "jpeg", "png", "gif"):
            ext = "jpg"
        fname = f"seat_{seat_number}.{ext}"
        try:
            img_resp = requests.get(remote_url, headers=HEADERS, timeout=15)
            img_resp.raise_for_status()
            (PHOTO_DIR / fname).write_bytes(img_resp.content)
            photo_url = f"/members/ebetsu/{fname}"
            time.sleep(0.2)
        except Exception as e:
            print(f"    [WARN] 写真取得失敗 {remote_url}: {e}")

    return {
        "seat_number": seat_number,
        "name": name,
        "furigana": furigana,
        "party": infer_party(faction),
        "faction": faction,
        "committees": committees,
        "photo_url": photo_url,
    }


def scrape_members():
    print("江別市議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return

    # 「議員名簿」見出し以降の <h3> だけを拾う（凡例 h3 を除外）
    anchor = soup.find("h2", string=re.compile("議員名簿"))
    if anchor is None:
        print("  [ERROR] 『議員名簿』見出しが見つからない")
        return

    members = []
    seat = 0
    for elem in anchor.find_all_next():
        if elem.name == "h3":
            heading = normalize(elem.get_text())
            # 氏名（ふりがな） の形式か
            if not re.search(r"[（(].+[）)]", heading):
                continue
            # 次の <p> を取得
            p_tag = elem.find_next("p")
            if p_tag is None:
                continue
            seat += 1
            m = extract_member(elem, p_tag, seat)
            if m:
                members.append(m)
                print(f"  [{seat:2d}] {m['name']} ({m['furigana']}) / {m['faction']}")

    if not members:
        print("  [ERROR] 議員が1名も抽出できませんでした")
        return

    out_file = OUTPUT_DIR / "members.json"
    out_file.write_text(
        json.dumps({"members": members}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\n書き出し: {out_file}")
    print(f"取得議員数: {len(members)}名")


if __name__ == "__main__":
    scrape_members()
