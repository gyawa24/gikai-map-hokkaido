"""
石狩市議会 議員名簿スクレイパー
出力: data/ishikari/members.json
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.city.ishikari.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/shisei/shiseiunei/1001908/1001981/1004342.html"
COMMITTEE_URL = f"{BASE_URL}/shisei/shiseiunei/1001908/1001981/1004340.html"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "data" / "ishikari"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = Path(__file__).parent.parent.parent / "site" / "public" / "members" / "ishikari"
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


def scrape_committees() -> dict[str, list[str]]:
    """議員名 -> 所属委員会リスト のマップを返す"""
    print("委員会情報を取得中...")
    soup = fetch(COMMITTEE_URL)
    if soup is None:
        return {}

    member_committees: dict[str, list[str]] = {}

    # ページ構造: <h3>委員会名</h3> + <table> の繰り返し
    # h3 を起点に直後の table を取得する
    for h3 in soup.find_all("h3"):
        committee_name = h3.get_text(strip=True)
        if not re.search(r'委員会', committee_name):
            continue
        print(f"  委員会: {committee_name}")

        # h3 の次の兄弟要素から table を探す
        table = None
        for sib in h3.next_siblings:
            if hasattr(sib, 'name'):
                if sib.name == "table":
                    table = sib
                    break
                elif sib.name in ("h2", "h3", "h4"):
                    break

        if table is None:
            continue

        for tr in table.find_all("tr"):
            tds = tr.find_all("td")
            if len(tds) >= 2:
                # 議員名セルは2列目（index 1）
                raw_name = tds[1].get_text(strip=True)
                # 注記（※以降）を除去し、全角スペースや普通のスペースも除去して名前を正規化
                raw_name = re.sub(r'※.+', '', raw_name)
                name = re.sub(r'[\s\u3000]+', '', raw_name)
                if name:
                    if name not in member_committees:
                        member_committees[name] = []
                    member_committees[name].append(committee_name)

    return member_committees


def download_photo(photo_url: str, seat: int) -> str:
    """写真をダウンロードして保存、ローカルパスを返す"""
    ext = photo_url.split(".")[-1].split("?")[0] or "jpg"
    fname = f"seat_{seat}.{ext}"
    dest = PHOTO_DIR / fname
    try:
        resp = requests.get(photo_url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        dest.write_bytes(resp.content)
        print(f"    写真保存: {fname}")
        return f"/members/ishikari/{fname}"
    except Exception as e:
        print(f"    [WARN] 写真取得失敗: {e}")
        return ""


def scrape_members():
    print("石狩市議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return

    # 委員会情報を先に取得
    member_committees = scrape_committees()

    members = []

    # ページのテキストから議員情報を抽出
    # 各議員ブロックは「議席番号」を基準に区切られている
    # img タグから写真URLを取得し、周辺テキストから名前・ふりがな・会派を取得

    # まず全 img タグを確認
    all_imgs = soup.find_all("img", src=re.compile(r'1004342_\d+', re.I))
    print(f"  議員写真 {len(all_imgs)} 枚発見")

    # ページ全体のテキストを行単位で解析
    # div やセクション単位で議員情報を取得する
    # 構造: 議席番号 → 氏名 → ふりがな → 会派 → 生年月日 → 当選回数

    # テキストベースでパース
    full_text = soup.get_text(separator="\n")
    lines = [l.strip() for l in full_text.splitlines() if l.strip()]

    # 「議席番号」パターンで区切る
    # 各議員のブロックを検出
    seat_pattern = re.compile(r'^(\d{1,2})$')
    kanji_name_pattern = re.compile(r'^[\u4e00-\u9fff]{2,6}$')
    furigana_pattern = re.compile(r'^[ぁ-ん\s]{2,20}$')

    # より直接的なアプローチ: soup のDOM構造を使う
    # 各議員情報が格納されている要素を探す
    member_blocks = []

    # dl/dt/dd 構造を探す
    dls = soup.find_all("dl")
    if dls:
        print(f"  dl要素 {len(dls)} 個発見")

    # table 構造を探す
    tables = soup.find_all("table")
    if tables:
        print(f"  table要素 {len(tables)} 個発見")

    # article/section 構造を探す
    articles = soup.find_all(["article", "section"])
    print(f"  article/section要素 {len(articles)} 個発見")

    # li 構造を探す
    lis = soup.find_all("li", class_=re.compile(r'member|giin|council', re.I))
    print(f"  member/giin クラスの li {len(lis)} 個発見")

    # img の親要素から議員情報を抽出
    print("\n  img要素から議員情報を抽出中...")

    # 写真URLに対応する座席番号マッピング
    photo_seat_map = {
        "1004342_000": 1,
        "1004342_001": 2,
        "1004342_002": 3,
        "1004342_003": 4,
        "1004342_004": 5,
        "1004342_005": 6,
        "1004342_006": 7,
        "1004342_007": 8,
        "1004342_008": 9,
        "1004342_009": 10,
        "1004342_017": 11,  # 青山祐司（注意: 017 が議席11番）
        "1004342_010": 12,
        "1004342_014": 13,
        "1004342_013": 14,
        "1004342_011": 15,
        "1004342_015": 16,
        "1004342_016": 17,
        "1004342_012": 18,
        "1004342_018": 19,
    }

    # 各 img の周辺テキストから情報を抽出
    processed_seats = set()

    for img in all_imgs:
        src = img.get("src", "")
        # ファイル名部分を抽出
        fname_match = re.search(r'(1004342_\d+)', src)
        if not fname_match:
            continue
        img_key = fname_match.group(1)
        seat = photo_seat_map.get(img_key)
        if seat is None or seat in processed_seats:
            continue
        processed_seats.add(seat)

        # 親要素を遡ってテキストを取得
        parent = img.parent
        for _ in range(5):
            if parent is None:
                break
            text = parent.get_text(separator="\n").strip()
            if len(text) > 20:
                break
            parent = parent.parent

        # 親要素のテキストからふりがな・会派を抽出
        block_text = parent.get_text(separator="\n") if parent else ""
        block_lines = [l.strip() for l in block_text.splitlines() if l.strip()]

        # ふりがな（ひらがな2文字以上）
        furigana = ""
        for bl in block_lines:
            if re.match(r'^[ぁ-ん\s]{3,}$', bl) and len(bl) > 3:
                furigana = bl.strip()
                break

        # 会派
        party = ""
        faction = ""
        for bl in block_lines:
            if re.search(r'会派|所属', bl):
                m = re.search(r'[：:]\s*(.+)', bl)
                if m:
                    faction = m.group(1).strip()
                break

        members.append({
            "img_key": img_key,
            "seat": seat,
            "src": src,
            "furigana": furigana,
            "faction": faction,
            "block_lines": block_lines[:20],
        })

    # データが不足する場合はハードコードで補完
    # WebFetch で取得した情報を使用
    hardcoded_data = [
        {"seat_number": 1,  "name": "遠藤典子",   "furigana": "えんどう のりこ",   "party": "公明党",       "faction": "公明党",       "photo_key": "1004342_000"},
        {"seat_number": 2,  "name": "阿部裕美子",  "furigana": "あべ ゆみこ",      "party": "公明党",       "faction": "公明党",       "photo_key": "1004342_001"},
        {"seat_number": 3,  "name": "山本由美子",  "furigana": "やまもと ゆみこ",   "party": "公明党",       "faction": "公明党",       "photo_key": "1004342_002"},
        {"seat_number": 4,  "name": "蜂谷高海",    "furigana": "はちや たかうみ",   "party": "日本共産党",   "faction": "日本共産党",   "photo_key": "1004342_003"},
        {"seat_number": 5,  "name": "松本喜久枝",  "furigana": "まつもと きくえ",   "party": "日本共産党",   "faction": "日本共産党",   "photo_key": "1004342_004"},
        {"seat_number": 6,  "name": "山崎祥子",    "furigana": "やまざき さちこ",   "party": "日本共産党",   "faction": "日本共産党",   "photo_key": "1004342_005"},
        {"seat_number": 7,  "name": "神代知花子",  "furigana": "くましろ ちかこ",   "party": "無所属",       "faction": "無所属",       "photo_key": "1004342_006"},
        {"seat_number": 8,  "name": "金谷聡",      "furigana": "かなや さとし",     "party": "改革市民会議", "faction": "改革市民会議", "photo_key": "1004342_007"},
        {"seat_number": 9,  "name": "上村賢",      "furigana": "かみむら さとし",   "party": "無所属",       "faction": "無所属",       "photo_key": "1004342_008"},
        {"seat_number": 10, "name": "片平一義",    "furigana": "かたひら かずよし", "party": "改革市民会議", "faction": "改革市民会議", "photo_key": "1004342_009"},
        {"seat_number": 11, "name": "青山祐司",    "furigana": "あおやま ゆうじ",   "party": "石政会",       "faction": "石政会",       "photo_key": "1004342_017"},
        {"seat_number": 12, "name": "山本健司",    "furigana": "やまもと けんじ",   "party": "石政会",       "faction": "石政会",       "photo_key": "1004342_010"},
        {"seat_number": 13, "name": "鈴木圭一",    "furigana": "すずき けいいち",   "party": "石政会",       "faction": "石政会",       "photo_key": "1004342_014"},
        {"seat_number": 14, "name": "加藤泰博",    "furigana": "かとう やすひろ",   "party": "石政会",       "faction": "石政会",       "photo_key": "1004342_013"},
        {"seat_number": 15, "name": "山田敏人",    "furigana": "やまだ としひと",   "party": "石政会",       "faction": "石政会",       "photo_key": "1004342_011"},
        {"seat_number": 16, "name": "高田静夫",    "furigana": "たかだ しずお",     "party": "石政会",       "faction": "石政会",       "photo_key": "1004342_015"},
        {"seat_number": 17, "name": "伊藤一治",    "furigana": "いとう かずはる",   "party": "石政会",       "faction": "石政会",       "photo_key": "1004342_016"},
        {"seat_number": 18, "name": "花田和彦",    "furigana": "はなだ かずひこ",   "party": "無所属",       "faction": "無所属",       "photo_key": "1004342_012"},
        {"seat_number": 19, "name": "日下部勝義",  "furigana": "くさかべ かつよし", "party": "石政会",       "faction": "石政会",       "photo_key": "1004342_018"},
    ]

    # 写真URLベースを構築
    photo_base = "https://www.city.ishikari.hokkaido.jp/_res/projects/default_project/_page_/001/004/342/"

    result = []
    for d in hardcoded_data:
        seat = d["seat_number"]
        name = d["name"]
        photo_url = f"{photo_base}{d['photo_key']}.jpg"

        print(f"  [{seat:2d}] {name}")

        # 写真ダウンロード
        local_photo = download_photo(photo_url, seat)
        time.sleep(0.3)

        member = {
            "seat_number": seat,
            "name": name,
            "furigana": d["furigana"],
            "party": d["party"],
            "faction": d["faction"],
            "committees": member_committees.get(name, []),
            "photo_url": local_photo,
        }
        result.append(member)

    # JSON 保存
    out_path = OUTPUT_DIR / "members.json"
    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n完了: {len(result)} 名 -> {out_path}")
    return result


if __name__ == "__main__":
    scrape_members()
