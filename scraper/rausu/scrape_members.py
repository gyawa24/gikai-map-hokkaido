"""
羅臼町議会 議員名簿スクレイパー
出力: site/data/rausu/members.json

ソース: https://www.rausu-town.jp/pages/view/152 （議会構成・議員名簿）
※ 議員氏名は公式ページのHTMLテーブルから動的取得。ハードコードしない。
"""

import json
import re
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.rausu-town.jp"
MEMBERS_URL = f"{BASE_URL}/pages/view/152"

ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = ROOT / "site" / "data" / "rausu"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

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


def normalize_name(raw: str) -> str:
    # 全角スペース・半角スペースを1つの全角スペースに統一
    s = re.sub(r"[\s\u3000]+", "\u3000", raw.strip())
    return s


def parse_row_cells(tr) -> list[str]:
    return [c.get_text(" ", strip=True) for c in tr.find_all(["th", "td"])]


def scrape():
    print("羅臼町議会 議員名簿を収集中...")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        print("  ページ取得失敗")
        return

    tables = soup.find_all("table")
    if not tables:
        print("  [ERROR] テーブルが見つかりません")
        return

    # ----- 議員名簿テーブル（ヘッダに「氏名」「生年月日」「当選回数」を含む）を特定 -----
    roster_table = None
    for t in tables:
        head = parse_row_cells(t.find("tr")) if t.find("tr") else []
        head_joined = "".join(head)
        if "氏" in head_joined and "生年月日" in head_joined and "当選回数" in head_joined:
            roster_table = t
            break

    if roster_table is None:
        print("  [ERROR] 議員名簿テーブルが見つかりません")
        return

    roster: list[dict] = []
    for tr in roster_table.find_all("tr")[1:]:
        cells = parse_row_cells(tr)
        if len(cells) < 2:
            continue
        name = normalize_name(cells[0])
        if not name:
            continue
        roster.append({
            "seat_number": len(roster) + 1,  # ページ注記「※議席名簿順に記載」
            "name": name,
            "furigana": "",
            "party": "",
            "faction": "",
            "committees": [],
            "photo_url": "",
        })

    if not roster:
        print("  [ERROR] 議員情報が抽出できません")
        return

    name_to_member = {m["name"]: m for m in roster}
    print(f"  議員名簿から {len(roster)} 名を抽出")

    # ----- 議長・副議長（最初のテーブル） -----
    # 形式: [議長, 氏名, 副議長, 氏名]
    head_table = tables[0]
    head_cells = parse_row_cells(head_table.find("tr")) if head_table.find("tr") else []
    role_map: dict[str, str] = {}  # name -> 議長/副議長
    if len(head_cells) >= 4:
        # 議長
        if "議" in head_cells[0] and "長" in head_cells[0]:
            chair = normalize_name(head_cells[1])
            if chair in name_to_member:
                role_map[chair] = "議長"
        # 副議長
        if "副議長" in head_cells[2]:
            vice = normalize_name(head_cells[3])
            if vice in name_to_member:
                role_map[vice] = "副議長"

    # ----- 委員会テーブルの抽出 -----
    # 議員名簿テーブル以外で、ヘッダに「職」「氏名」を含むテーブルを委員会テーブルとする
    committee_tables = []
    for t in tables:
        if t is roster_table:
            continue
        head = parse_row_cells(t.find("tr")) if t.find("tr") else []
        head_joined = "".join(head)
        if "職" in head_joined and "氏" in head_joined:
            committee_tables.append(t)

    # 委員会名はテーブル直前の見出し要素から取得
    def find_preceding_heading(table) -> str:
        prev = table.find_previous(string=re.compile(r"委員会"))
        if prev:
            return re.sub(r"\s+", "", prev.strip())
        return "委員会"

    for t in committee_tables:
        committee_name = find_preceding_heading(t)
        for tr in t.find_all("tr")[1:]:
            cells = parse_row_cells(tr)
            if len(cells) < 2:
                continue
            role = re.sub(r"\s+", "", cells[0])
            # 1セルに複数名が含まれるケース（HTMLの不整合）に対応
            names_raw = re.split(r"\s{2,}|\u3000{2,}|　 ", cells[1])
            # より確実に分ける: 名前ペア「姓<全角or半角スペース>名」を抽出
            candidates = re.findall(
                r"[一-龥々ぁ-んァ-ヶー]{1,6}[\s\u3000]+[一-龥々ぁ-んァ-ヶー]{1,6}",
                cells[1],
            )
            name_list = [normalize_name(c) for c in candidates] if candidates else [normalize_name(cells[1])]

            for nm in name_list:
                if nm not in name_to_member:
                    # 名簿に存在しない氏名はスキップ（HTMLの古いデータや誤記対策）
                    continue
                member = name_to_member[nm]
                label = committee_name
                if role in ("委員長", "副委員長"):
                    label = f"{committee_name}（{role}）"
                if label not in member["committees"]:
                    member["committees"].append(label)

    # ----- 議長・副議長を committees 先頭に反映 -----
    for nm, r in role_map.items():
        m = name_to_member[nm]
        if r not in m["committees"]:
            m["committees"].insert(0, r)

    # 出力
    out_path = OUTPUT_DIR / "members.json"
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(roster, f, ensure_ascii=False, indent=2)
    print(f"  保存: {out_path}")
    print(f"  取得議員数: {len(roster)}名")
    for m in roster:
        print(f"    席{m['seat_number']:>2} {m['name']}  委員会: {m['committees']}")


if __name__ == "__main__":
    scrape()
