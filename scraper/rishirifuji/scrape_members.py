"""
利尻富士町議会 議員名簿スクレイパー
出力: data/rishirifuji/members.json

HTML構造:
- table.table_1209 に議員情報がテーブル形式で埋め込まれている
- 各議員は2行構成: 1行目にふりがな(8px)、2行目に役職・氏名・議席番号・任期・年齢・当選回数
"""

import json
import re
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.rishirifuji.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/rishirifuji/1209.htm"

REPO_ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = REPO_ROOT / "data" / "rishirifuji"
SITE_OUTPUT_DIR = REPO_ROOT / "site" / "data" / "rishirifuji"
PHOTO_DIR = REPO_ROOT / "site" / "public" / "members" / "rishirifuji"
for d in (OUTPUT_DIR, SITE_OUTPUT_DIR, PHOTO_DIR):
    d.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def normalize_ws(s: str) -> str:
    if s is None:
        return ""
    s = s.replace("\u3000", " ")
    return re.sub(r"\s+", "", s).strip()


def normalize_furigana(s: str) -> str:
    if s is None:
        return ""
    s = s.replace("\u3000", "").replace(" ", "").replace("　", "")
    return s.strip()


def zenkaku_digits_to_int(s: str) -> int | None:
    trans = str.maketrans("０１２３４５６７８９", "0123456789")
    digits = re.sub(r"\D", "", s.translate(trans))
    return int(digits) if digits else None


def fetch(url: str) -> BeautifulSoup:
    resp = requests.get(url, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding or "utf-8"
    return BeautifulSoup(resp.text, "html.parser")


def parse_members(soup: BeautifulSoup) -> list[dict]:
    table = soup.find("table", class_="table_1209")
    if table is None:
        raise RuntimeError("table.table_1209 が見つかりません。ページ構造が変わった可能性があります。")

    rows = table.find_all("tr")
    members: list[dict] = []

    # 2行ペアで議員情報が構成される: [furigana row, name row]
    # 最初のヘッダー行はth要素を持つのでスキップ
    i = 0
    pending_furigana = ""
    while i < len(rows):
        cells = rows[i].find_all(["th", "td"])
        if not cells:
            i += 1
            continue

        # ヘッダー行はスキップ
        if rows[i].find("th"):
            i += 1
            continue

        tds = rows[i].find_all("td")
        if len(tds) < 6:
            i += 1
            continue

        # ふりがな行判定: 2番目のセルが小さなフォントでひらがなのみ
        second = tds[1]
        text_second = normalize_ws(second.get_text())
        style = second.get("style", "")
        is_furigana_row = (
            "font-size: 8px" in style or "font-size:8px" in style
        ) and re.fullmatch(r"[ぁ-んー　 ]+", second.get_text().strip().replace(" ", ""))

        if is_furigana_row:
            pending_furigana = normalize_furigana(second.get_text())
            i += 1
            continue

        # 名前行: 氏名を含む
        name = normalize_ws(tds[1].get_text())
        seat_raw = tds[2].get_text()
        seat_number = zenkaku_digits_to_int(seat_raw)
        role = normalize_ws(tds[0].get_text())

        if not name:
            i += 1
            continue

        member = {
            "seat_number": seat_number,
            "name": name,
            "furigana": pending_furigana,
            "party": "",
            "faction": "",
            "committees": [],
        }
        if role in ("議長", "副議長"):
            member["role"] = role

        members.append(member)
        pending_furigana = ""
        i += 1

    return members


def main() -> None:
    print("利尻富士町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    members = parse_members(soup)

    if not members:
        print("  取得不可: 議員情報が1件も抽出できませんでした")
        return

    members.sort(key=lambda m: (m.get("seat_number") or 999))

    # data/rishirifuji/ と site/data/rishirifuji/ の両方に出力
    payload = json.dumps(members, ensure_ascii=False, indent=2) + "\n"
    (OUTPUT_DIR / "members.json").write_text(payload, encoding="utf-8")
    (SITE_OUTPUT_DIR / "members.json").write_text(payload, encoding="utf-8")

    print(f"取得議員数: {len(members)}名")
    for m in members:
        role = m.get("role", "議員")
        print(f"  {m['seat_number']:>2}番 {role} {m['name']} ({m['furigana']})")


if __name__ == "__main__":
    main()
