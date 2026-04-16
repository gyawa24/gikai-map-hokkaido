"""
長沼町議会 議員名簿スクレイパー
出力: data/naganuma/members.json, site/data/naganuma/members.json

ページ構造:
  <h2 class="pagetitle_a4">議席番号N<br/>氏名（ふりがな）</h2>
  <div class="table-wrap"><table>党派 / 年齢 / 住所 / 電話 / 所属 / 期数</table></div>
"""

import json
import re
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.maoi-net.jp"
MEMBERS_URL = f"{BASE_URL}/gikai/giinmeibo/gisekibangojun/"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "data" / "naganuma"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
SITE_DATA_DIR = Path(__file__).parent.parent.parent / "site" / "data" / "naganuma"
SITE_DATA_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = Path(__file__).parent.parent.parent / "site" / "public" / "members" / "naganuma"
PHOTO_DIR.mkdir(parents=True, exist_ok=True)

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


def clean_text(s: str) -> str:
    # 全角スペース・各種空白を正規化
    s = (s or "").replace("\u3000", " ")
    return re.sub(r"\s+", " ", s).strip()


def extract_detail(table) -> dict:
    """党派/所属/期数をテーブルから抽出"""
    data = {"party_raw": "", "committees": [], "term": ""}
    for tr in table.find_all("tr"):
        cells = tr.find_all(["td", "th"])
        if len(cells) < 2:
            continue
        label = clean_text(cells[0].get_text())
        if label == "党派":
            data["party_raw"] = clean_text(cells[1].get_text())
        elif label == "所属":
            items = [clean_text(li.get_text()) for li in cells[1].find_all("li")]
            items = [i for i in items if i]
            if not items:
                # 改行区切りの可能性
                raw = clean_text(cells[1].get_text(" "))
                items = [x for x in re.split(r"[、,／/・\n]+", raw) if x]
            data["committees"] = items
        elif label == "期数":
            data["term"] = clean_text(cells[1].get_text())
    return data


SEAT_RE = re.compile(r"議席番号\s*(\d+)")
# 氏名（ふりがな）を抜き出す
NAME_RE = re.compile(r"([^\s（(]+(?:\s[^\s（(]+)?)\s*[（(]([ぁ-んァ-ヶー\s]+)[)）]")


def parse_heading(h2) -> tuple[int, str, str] | None:
    # 改行を保ったテキスト
    raw = h2.get_text("\n")
    # 議席番号
    m_seat = SEAT_RE.search(raw)
    if not m_seat:
        return None
    seat = int(m_seat.group(1))

    # 「議席番号N」行を除去して残りを結合
    rest = SEAT_RE.sub("", raw)
    rest_flat = clean_text(rest)
    m_name = NAME_RE.search(rest_flat)
    if not m_name:
        # ふりがな無いケース（一応対応）
        name = rest_flat.strip()
        furigana = ""
    else:
        name = clean_text(m_name.group(1))
        furigana = clean_text(m_name.group(2))
    return seat, name, furigana


def derive_party(raw: str) -> str:
    if not raw:
        return ""
    if "共産" in raw:
        return "日本共産党"
    if "公明" in raw:
        return "公明党"
    if "立憲" in raw:
        return "立憲民主党"
    if "国民民主" in raw:
        return "国民民主党"
    if "自民" in raw or "自由民主" in raw:
        return "自由民主党"
    # 「無」「無所属」はparty空欄
    return ""


def find_photo(h2) -> str | None:
    """見出しの近くにある議員画像を探す。"""
    # h2 の前後の兄弟やその子孫
    candidates = []
    prev = h2.find_previous_sibling()
    if prev:
        candidates.extend(prev.find_all("img"))
    nxt = h2.find_next_sibling()
    if nxt:
        candidates.extend(nxt.find_all("img"))
    for img in candidates:
        src = img.get("src", "")
        if not src:
            continue
        # UIアイコン除外
        if "icon" in src or "header_" in src or "arrow" in src:
            continue
        return src if src.startswith("http") else BASE_URL + src
    return None


def download_photo(remote_url: str, seat: int) -> str:
    ext = remote_url.split(".")[-1].split("?")[0].lower() or "jpg"
    if ext not in ("jpg", "jpeg", "png", "gif", "webp"):
        ext = "jpg"
    fname = f"seat_{seat}.{ext}"
    try:
        r = requests.get(remote_url, headers=HEADERS, timeout=10)
        r.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(r.content)
        print(f"    [photo] seat_{seat} <- {remote_url}")
        return f"/members/naganuma/{fname}"
    except Exception as e:
        print(f"    [photo-err] {remote_url} -> {e}")
        return ""


def scrape() -> list[dict]:
    soup = fetch(MEMBERS_URL)
    if soup is None:
        return []
    members = []
    for h2 in soup.find_all("h2", class_="pagetitle_a4"):
        parsed = parse_heading(h2)
        if not parsed:
            continue
        seat, name, furigana = parsed
        # 直後のテーブルを探す
        table = h2.find_next("table")
        detail = extract_detail(table) if table else {"party_raw": "", "committees": [], "term": ""}

        photo_remote = find_photo(h2)
        photo_url = download_photo(photo_remote, seat) if photo_remote else ""

        party_raw = detail["party_raw"]
        party = derive_party(party_raw)
        # 会派: party_rawそのまま（「無」などを含む）
        faction = party_raw

        members.append({
            "seat_number": seat,
            "name": name,
            "furigana": furigana,
            "party": party,
            "faction": faction,
            "committees": detail["committees"],
        })

        # photo_url は別枠（スキーマ要件は主フィールドのみ、写真は付加情報）
        if photo_url:
            members[-1]["photo_url"] = photo_url

    members.sort(key=lambda x: x["seat_number"])
    return members


def main():
    print("長沼町議会 議員名簿を収集中...")
    members = scrape()
    if not members:
        print("取得不可: 議員見出し(h2.pagetitle_a4)が見つかりませんでした")
        return

    out = OUTPUT_DIR / "members.json"
    out.write_text(json.dumps(members, ensure_ascii=False, indent=2), encoding="utf-8")
    site_out = SITE_DATA_DIR / "members.json"
    site_out.write_text(json.dumps(members, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  出力: {out}")
    print(f"  出力: {site_out}")
    print(f"取得議員数: {len(members)}名")


if __name__ == "__main__":
    main()
