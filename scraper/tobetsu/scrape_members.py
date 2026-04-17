"""
当別町議会 議員名簿スクレイパー
出力:
  - site/data/tobetsu/members.json
  - data/tobetsu/members.json

データ源:
  - 議員名簿:   https://www.town.tobetsu.hokkaido.jp/site/gikai/541.html
  - 議会構成表: https://www.town.tobetsu.hokkaido.jp/site/gikai/542.html

HTMLに顔写真の個別掲載は無く、PDF（画像ベース）のみのため写真取得はスキップする。
"""

import json
import re
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.tobetsu.hokkaido.jp"
MEMBERS_URL = f"{BASE_URL}/site/gikai/541.html"
COMPOSITION_URL = f"{BASE_URL}/site/gikai/542.html"

ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIRS = [
    ROOT / "site" / "data" / "tobetsu",
    ROOT / "data" / "tobetsu",
]
for d in OUTPUT_DIRS:
    d.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

ZENKAKU_DIGITS = str.maketrans("０１２３４５６７８９", "0123456789")


def normalize(text: str) -> str:
    """全角/半角スペース・nbsp・zero-width を除去・圧縮。"""
    text = text.replace("\u200b", "").replace("\xa0", " ")
    return re.sub(r"[\s\u3000]+", " ", text).strip()


def normalize_name(text: str) -> str:
    """議員氏名を姓名間スペース1つに正規化。"""
    return normalize(text)


def compact(text: str) -> str:
    """委員会名・役職名はスペースを完全除去（改行を跨いで表示される語を結合）。"""
    return re.sub(r"[\s\u3000\u200b\xa0]+", "", text)


def fetch(url: str) -> BeautifulSoup:
    resp = requests.get(url, headers=HEADERS, timeout=20)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding
    return BeautifulSoup(resp.text, "html.parser")


def parse_members_table(soup: BeautifulSoup) -> list[dict]:
    """
    議員名簿テーブルは「当選回数」列に rowspan があり、
    同じ当選回数の議員が複数行にまたがる場合、2行目以降は
    当選回数セルが省略されて列数が 5 から 4 になる。
    """
    table = soup.find("table")
    if table is None:
        raise RuntimeError("議員名簿テーブルが見つからない")

    members: list[dict] = []
    for tr in table.find_all("tr"):
        cells = [normalize(c.get_text()) for c in tr.find_all(["th", "td"])]
        if not cells:
            continue
        # ヘッダー行をスキップ
        if cells[0].replace(" ", "") == "議席番号":
            continue

        # 列数で列位置を判定
        if len(cells) == 5:
            seat, _elected, name, party, _note = cells
        elif len(cells) == 4:
            # 当選回数が rowspan で省略されているパターン
            seat, name, party, _note = cells
        else:
            continue

        seat_num = int(seat.translate(ZENKAKU_DIGITS))
        name = normalize_name(name)
        party = normalize(party)

        # 空席
        if not name:
            continue

        members.append(
            {
                "seat_number": seat_num,
                "name": name,
                "furigana": "",
                "party": party,
                "faction": "",
                "committees": [],
                "photo_url": "",
            }
        )

    return members


def parse_composition(soup: BeautifulSoup) -> dict[str, dict]:
    """
    議会構成表から各議員の所属委員会と役職を収集。
    戻り値: { 正規化済み氏名: { "role": str, "committees": [str, ...] } }
    """
    info: dict[str, dict] = {}

    def entry(name: str) -> dict:
        # キーは空白除去で統一（同一議員が表中で「佐々木常子」「佐々木 常子」
        # のように揺れて記載されているため）。
        key = compact(name)
        return info.setdefault(key, {"role": "", "committees": []})

    tables = soup.find_all("table")

    # 1つ目のテーブル: 議長・副議長
    if tables:
        for tr in tables[0].find_all("tr"):
            cells = tr.find_all(["th", "td"])
            if len(cells) >= 2:
                role_label = compact(cells[0].get_text())
                person = normalize(cells[1].get_text())
                if person:
                    entry(person)["role"] = role_label

    # 2つ目以降: 委員会テーブル
    # 構造: ヘッダー行 [委員会名, 委員長, 副委員長, 委員]
    # データ行は複数段: 1行目は [委員会名, 委員長, 副委員長, 委員, 委員, 委員]
    # 2行目以降は [委員, 委員, 委員] のように委員のみ続く
    for table in tables[1:]:
        # 1列目（委員会名）はスペース除去、それ以外（議員名）は通常正規化
        rows = []
        for tr in table.find_all("tr"):
            raw_cells = tr.find_all(["th", "td"])
            if not raw_cells:
                continue
            first = compact(raw_cells[0].get_text())
            rest = [normalize(c.get_text()) for c in raw_cells[1:]]
            rows.append([first] + rest)

        if not rows:
            continue

        header = rows[0]
        if not (len(header) >= 2 and header[0] == "委員会名"):
            # 組合議員など別形式のテーブルはスキップ
            continue

        current_committee = ""
        for row in rows[1:]:
            if not row:
                continue
            # 1段目: 委員会名で始まる
            if row[0].endswith("委員会"):
                current_committee = row[0]
                # [委員会名, 委員長, 副委員長, 委員, 委員, ...]
                if len(row) >= 2 and row[1] and row[1] not in ("-", "‐"):
                    e = entry(row[1])
                    e["committees"].append(f"{current_committee}委員長")
                if len(row) >= 3 and row[2] and row[2] not in ("-", "‐"):
                    e = entry(row[2])
                    e["committees"].append(f"{current_committee}副委員長")
                for member in row[3:]:
                    if member and member not in ("-", "‐"):
                        entry(member)["committees"].append(current_committee)
            else:
                # 委員のみの続き行
                for member in row:
                    if member and member not in ("-", "‐"):
                        entry(member)["committees"].append(current_committee)

    return info


def merge(members: list[dict], composition: dict[str, dict]) -> list[dict]:
    for m in members:
        key = compact(m["name"])
        comp = composition.get(key)
        if comp:
            committees = list(comp["committees"])
            if comp["role"]:
                # 議長・副議長は役職として committees 先頭に追加
                committees.insert(0, comp["role"])
            m["committees"] = committees
    return members


def main() -> None:
    print("当別町議会 議員名簿を取得中...")
    soup_members = fetch(MEMBERS_URL)
    members = parse_members_table(soup_members)
    print(f"  議員 {len(members)} 名を抽出")

    print("議会構成表を取得中...")
    soup_comp = fetch(COMPOSITION_URL)
    composition = parse_composition(soup_comp)
    print(f"  構成情報 {len(composition)} 名分を取得")

    merged = merge(members, composition)

    payload = {"members": merged}
    for d in OUTPUT_DIRS:
        (d / "members.json").write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"  書き出し: {d / 'members.json'}")

    for m in merged:
        role_mark = ""
        if m["committees"] and m["committees"][0] in ("議長", "副議長", "議\u3000長"):
            role_mark = f" [{m['committees'][0]}]"
        print(
            f"  #{m['seat_number']:>2} {m['name']}{role_mark}  "
            f"({m['party'] or '-'})  委員会: {len(m['committees'])} 件"
        )


if __name__ == "__main__":
    main()
