"""
倶知安町議会 議員名簿スクレイパー
出力: data/kutchan/members.json
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.kutchan.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/gikai/shikumi/syoukai/"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "data" / "kutchan"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = Path(__file__).parent.parent.parent / "site" / "public" / "members" / "kutchan"
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


def download_photo(url: str, dest: Path) -> bool:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=10)
        resp.raise_for_status()
        dest.write_bytes(resp.content)
        return True
    except Exception as e:
        print(f"  [PHOTO ERROR] {url} -> {e}")
        return False


def scrape_members():
    print("倶知安町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return []

    members = []

    # テーブルから議員データを取得
    tables = soup.find_all("table")
    print(f"  テーブル {len(tables)} 件発見")

    # 議員データを格納するリスト（テーブル解析）
    seat_num = 0

    for table in tables:
        rows = table.find_all("tr")
        for row in rows:
            cells = row.find_all(["td", "th"])
            texts = [c.get_text(strip=True) for c in cells]

            # 座席番号らしいセルを探す
            for i, text in enumerate(texts):
                if re.match(r"^\d{1,2}$", text) and int(text) <= 30:
                    seat_num = int(text)
                    # その行に名前が続く可能性
                    break

    # 議員リスト: テーブルが複雑な場合はdl/dt/ddやリスト構造も確認
    # まずページ全体のテキストからパターン抽出を試みる
    full_text = soup.get_text()

    # 既知データ（WebFetchで取得済み）をフォールバックとして使用
    known_members = [
        {"seat_number": 1,  "name": "木村聖子", "furigana": "きむら せいこ",   "party": "無所属", "faction": "無所属",    "committees": ["総務常任副委員長"]},
        {"seat_number": 2,  "name": "藪中聡史", "furigana": "やぶなか さとし", "party": "無所属", "faction": "山農会",    "committees": ["厚生文教常任委員"]},
        {"seat_number": 3,  "name": "木村俊一", "furigana": "きむら しゅんいち","party": "無所属", "faction": "無所属",    "committees": ["経済建設常任委員"]},
        {"seat_number": 4,  "name": "唐澤隆博", "furigana": "からさわ たかひろ","party": "無所属", "faction": "経世会",    "committees": ["経済建設常任委員", "議会運営委員"]},
        {"seat_number": 5,  "name": "早川貴士", "furigana": "はやかわ たかし", "party": "無所属", "faction": "経世会",    "committees": ["総務常任委員", "議会運営委員"]},
        {"seat_number": 6,  "name": "波方真如", "furigana": "なみかた まこと",  "party": "無所属", "faction": "経世会",    "committees": ["厚生文教常任委員長", "議会運営委員"]},
        {"seat_number": 7,  "name": "笠原啓仁", "furigana": "かさはら けいじ", "party": "無所属", "faction": "自治研究会","committees": ["総務常任委員", "議会運営委員長"]},
        {"seat_number": 8,  "name": "佐藤英俊", "furigana": "さとう ひでとし", "party": "無所属", "faction": "自治研究会","committees": ["経済建設常任委員", "議会運営委員"]},
        {"seat_number": 9,  "name": "作井繁樹", "furigana": "さくい しげき",   "party": "無所属", "faction": "無所属",    "committees": ["議長"]},
        {"seat_number": 10, "name": "坂井美穂", "furigana": "さかい みほ",     "party": "公明党", "faction": "公明党",    "committees": ["副議長", "厚生文教常任委員"]},
        {"seat_number": 11, "name": "小川不朽", "furigana": "おがわ ふきゅう", "party": "立憲民主党", "faction": "立憲民主党","committees": ["厚生文教常任委員"]},
        {"seat_number": 12, "name": "原田芳男", "furigana": "はらだ よしお",   "party": "日本共産党", "faction": "日本共産党","committees": ["経済建設常任副委員長"]},
        {"seat_number": 13, "name": "古谷眞司", "furigana": "ふるや しんじ",   "party": "無所属", "faction": "創政会",    "committees": ["総務常任委員長", "議会運営委員"]},
        {"seat_number": 14, "name": "門田淳",   "furigana": "かどた じゅん",   "party": "無所属", "faction": "創政会",    "committees": ["厚生文教常任副委員長"]},
        {"seat_number": 15, "name": "森禎樹",   "furigana": "もり よしき",     "party": "無所属", "faction": "山農会",    "committees": ["経済建設常任委員長", "議会運営副委員長"]},
        {"seat_number": 16, "name": "盛多勝美", "furigana": "もりた かつみ",   "party": "無所属", "faction": "山農会",    "committees": ["総務常任委員", "議会運営委員"]},
    ]

    # HTMLから実際のデータを抽出してみる（テーブル構造）
    parsed_members = parse_members_from_html(soup)
    if parsed_members:
        print(f"  HTMLから {len(parsed_members)} 件の議員データを抽出")
        members = parsed_members
    else:
        print("  HTMLパース失敗、既知データを使用")
        members = known_members

    # 写真の取得を試みる
    for member in members:
        seat = member["seat_number"]
        # 写真URLのパターンを試す
        photo_found = False
        for pattern in [
            f"/gikai/shikumi/syoukai/img/seat_{seat:02d}.jpg",
            f"/gikai/shikumi/syoukai/img/member_{seat:02d}.jpg",
            f"/gikai/shikumi/syoukai/img/{seat:02d}.jpg",
        ]:
            photo_url = BASE_URL + pattern
            dest = PHOTO_DIR / f"seat_{seat}.jpg"
            if download_photo(photo_url, dest):
                member["photo_url"] = f"/members/kutchan/seat_{seat}.jpg"
                photo_found = True
                print(f"  [{seat}] 写真取得: {pattern}")
                break
        if not photo_found:
            member["photo_url"] = ""

    return members


def parse_members_from_html(soup: BeautifulSoup) -> list:
    """HTMLのテーブルから議員データを解析"""
    members = []

    tables = soup.find_all("table")
    for table in tables:
        rows = table.find_all("tr")
        for row in rows:
            cells = row.find_all(["td", "th"])
            if len(cells) < 3:
                continue
            texts = [c.get_text(strip=True) for c in cells]

            # 座席番号 + 氏名 + ふりがな + 会派 のパターンを探す
            seat_text = texts[0]
            if not re.match(r"^\d{1,2}$", seat_text):
                continue
            seat = int(seat_text)
            if seat < 1 or seat > 30:
                continue

            # 残りのセルから名前・ふりがな・会派を探す
            name = ""
            furigana = ""
            faction = ""
            committees = []

            for t in texts[1:]:
                if not t:
                    continue
                # ふりがな（ひらがなのみ）
                if re.match(r"^[ぁ-ん\s]+$", t) and not furigana:
                    furigana = t
                # 名前（漢字・カタカナ含む短いテキスト）
                elif re.match(r"^[\u4e00-\u9fff\u30a0-\u30ff]{2,8}$", t) and not name:
                    name = t
                # 会派名らしいテキスト
                elif any(kw in t for kw in ["会", "党", "無所属", "民主", "共産", "公明"]):
                    faction = t
                # 委員会
                elif "委員" in t or "議長" in t:
                    committees.append(t)

            if name and seat:
                members.append({
                    "seat_number": seat,
                    "name": name,
                    "furigana": furigana,
                    "party": derive_party(faction),
                    "faction": faction,
                    "committees": committees,
                    "photo_url": "",
                })

    return members


def derive_party(faction: str) -> str:
    """会派名から政党を推定"""
    if "公明" in faction:
        return "公明党"
    if "共産" in faction:
        return "日本共産党"
    if "立憲" in faction or "民主" in faction:
        return "立憲民主党"
    if "維新" in faction:
        return "日本維新の会"
    if "自民" in faction or "自由民主" in faction:
        return "自由民主党"
    return "無所属"


def main():
    members = scrape_members()
    if not members:
        print("議員データを取得できませんでした")
        return

    out_path = OUTPUT_DIR / "members.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(members, f, ensure_ascii=False, indent=2)

    print(f"\n完了: {out_path}")
    print(f"取得議員数: {len(members)}名")
    for m in members:
        photo = "○" if m.get("photo_url") else "×"
        print(f"  [{m['seat_number']:2d}] {m['name']} ({m['furigana']}) {m['faction']} 写真:{photo}")


if __name__ == "__main__":
    main()
