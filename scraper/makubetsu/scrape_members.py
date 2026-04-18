"""
幕別町議会 議員名簿スクレイパー
出力: data/makubetsu/members.json
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.makubetsu.lg.jp"
MEMBERS_URL = f"{BASE_URL}/gikai/about_gikai/giimmeibo/1739.html"
REPO_ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = REPO_ROOT / "data" / "makubetsu"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
SITE_DIR = REPO_ROOT / "site" / "data" / "makubetsu"
SITE_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = REPO_ROOT / "site" / "public" / "members" / "makubetsu"
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


def download_photo(src: str, seat: int) -> str:
    """写真をダウンロードして保存。公開URL形式で返す。失敗時は空文字。"""
    if not src:
        return ""
    remote_url = src if src.startswith("http") else BASE_URL + src
    ext = remote_url.split(".")[-1].split("?")[0].lower() or "jpg"
    if ext not in ("jpg", "jpeg", "png", "gif", "webp"):
        ext = "jpg"
    fname = f"seat_{seat}.{ext}"
    try:
        resp = requests.get(remote_url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        (PHOTO_DIR / fname).write_bytes(resp.content)
        return f"/members/makubetsu/{fname}"
    except Exception as e:
        print(f"    [WARN] 写真DL失敗 {remote_url} -> {e}")
        return ""


def parse_name_cell(cell) -> tuple[str, str]:
    """
    氏名セルから (氏名, ふりがな) を取得する。
    セル構造: "漢字氏名<br>（ふりがな）" で、姓名は全角スペース区切り。
    氏名はスペースを詰めた「漢字氏名」、ふりがなは姓名の間に半角スペースを置く形で返す。
    """
    # <br>で行分割
    parts = [t.strip() for t in cell.get_text("\n").split("\n") if t.strip()]
    name_raw = parts[0] if parts else ""
    furigana_raw = parts[1] if len(parts) > 1 else ""
    # 氏名: 全角/半角スペース除去
    name = re.sub(r"[\s\u3000]+", "", name_raw)
    # ふりがな: 括弧除去、全角スペースを半角スペースに正規化
    furigana = re.sub(r"[（）\(\)]", "", furigana_raw)
    furigana = re.sub(r"[\u3000\s]+", " ", furigana).strip()
    # ふりがなセルに漢字氏名が重複して入っている場合は除外
    furigana = re.sub(r"[一-龥]", "", furigana).strip()
    return name, furigana


def extract_faction_and_committees(role_cell) -> tuple[str, list[str]]:
    """
    役職セルから (会派, 委員会リスト) を取得する。
    構造: 「議会運営委員<br>総務文教常任委員<br>（政清会）」等。
    会派は「（...）」でくくられた最後の行にある。議長・副議長は会派なしの場合あり。
    """
    parts = [t.strip() for t in role_cell.get_text("\n").split("\n") if t.strip()]
    faction = ""
    committees = []
    for p in parts:
        m = re.match(r"^[（\(](.+?)[）\)]$", p)
        if m:
            faction = m.group(1).strip()
            continue
        # 「委員」または「議運」を含むものを委員会として採用
        if "委員" in p or "議運" in p:
            committees.append(p)
    return faction, committees


def scrape_members():
    print("幕別町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return None

    # 議員一覧テーブルを探す
    tables = soup.find_all("table")
    target_table = None
    for t in tables:
        text = t.get_text()
        if "議席" in text and ("氏名" in text or "氏 名" in text):
            target_table = t
            break

    if target_table is None:
        # フォールバック: 最も行が多いtableを使う
        if tables:
            target_table = max(tables, key=lambda t: len(t.find_all("tr")))
        else:
            print("  議員一覧テーブルが見つからない")
            return None

    rows = target_table.find_all("tr")
    print(f"  テーブル行数: {len(rows)}")

    members = []
    header_skipped = False

    for row in rows:
        cells = row.find_all(["td", "th"])
        if len(cells) < 3:
            continue

        # ヘッダ行スキップ
        first_text = cells[0].get_text(strip=True)
        if not header_skipped and ("議席" in first_text and "番" in first_text and len(first_text) <= 5):
            header_skipped = True
            continue
        if cells[0].name == "th":
            header_skipped = True
            continue

        # 議席番号
        seat_text = first_text
        seat_match = re.search(r"\d+", seat_text)
        if not seat_match:
            continue
        seat_number = int(seat_match.group(0))

        # 構造: [議席, 氏名, 写真, 役職(会派/委員会), 住所, 当選回数, 職業]
        name_cell = cells[1]
        role_cell = cells[3] if len(cells) > 3 else None

        # 「欠員」の行はスキップ
        if "欠員" in name_cell.get_text():
            print(f"  [{seat_number}] 欠員のためスキップ")
            continue

        name, furigana = parse_name_cell(name_cell)
        if not name:
            continue

        # 写真 - 行内の img を探す
        img = row.find("img")
        photo_url = ""
        if img and img.get("src"):
            photo_url = download_photo(img["src"], seat_number)
            time.sleep(0.3)

        faction = ""
        committees = []
        if role_cell is not None:
            faction, committees = extract_faction_and_committees(role_cell)

        # 政党（共産党の議員団は政党名も入れる）
        party = "日本共産党" if "日本共産党" in faction else ""

        member = {
            "seat_number": seat_number,
            "name": name,
            "furigana": furigana,
            "party": party,
            "faction": faction,
            "committees": committees,
            "photo_url": photo_url,
        }
        members.append(member)
        print(f"  [{seat_number}] {name} ({furigana}) / {faction} / 委員会:{committees}")

    return members


def main():
    members = scrape_members()
    if not members:
        print("取得不可: 議員データが取得できませんでした")
        return

    # 議席番号でソート
    members.sort(key=lambda m: m["seat_number"])

    out_data = OUTPUT_DIR / "members.json"
    out_site = SITE_DIR / "members.json"
    payload = json.dumps(members, ensure_ascii=False, indent=2)
    out_data.write_text(payload, encoding="utf-8")
    out_site.write_text(payload, encoding="utf-8")

    print(f"\n取得議員数: {len(members)}名")
    print(f"  -> {out_data}")
    print(f"  -> {out_site}")


if __name__ == "__main__":
    main()
