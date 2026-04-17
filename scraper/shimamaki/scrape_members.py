"""
島牧村議会 議員名簿スクレイパー
出力: site/data/shimamaki/members.json

取得元: https://www.vill.shimamaki.lg.jp/category/detail.php?category=administration&content=69
議員情報は単一HTMLテーブルにテキストで掲載されているため、全てDOMから動的取得する。
ハードコード禁止。
"""

import json
import re
from pathlib import Path

import requests
from bs4 import BeautifulSoup

URL = "https://www.vill.shimamaki.lg.jp/category/detail.php?category=administration&content=69"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "site" / "data" / "shimamaki"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

# 全角→半角数字
ZEN_TO_HAN = str.maketrans("０１２３４5６７８９", "0123456789")


def normalize_num(s: str) -> str:
    return s.translate(ZEN_TO_HAN).strip()


def clean_name(s: str) -> str:
    # 全角スペース・半角スペースの連続を詰める（姓名間の区切り保持のため1個残す）
    s = s.strip()
    s = re.sub(r"[\s\u3000]+", " ", s)
    return s


def parse_committees(tr_cells):
    """
    委員会セル（総務社会 / 産業建設 / 議会運営）から所属と役職を抽出。
    ◎=委員長, ○/〇=副委員長, ●=委員
    """
    committee_labels = ["総務社会常任委員会", "産業建設常任委員会", "議会運営委員会"]
    results = []
    for label, cell in zip(committee_labels, tr_cells):
        mark = cell.get_text(strip=True)
        if not mark:
            continue
        # 全角マルと半角マル、黒丸の組み合わせに対応
        role = None
        if "◎" in mark:
            role = "委員長"
        elif "○" in mark or "〇" in mark:
            role = "副委員長"
        elif "●" in mark:
            role = "委員"
        if role:
            results.append({"name": label, "role": role})
    return results


def scrape():
    print(f"島牧村議会 議員名簿を収集中... {URL}")
    resp = requests.get(URL, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    resp.encoding = "utf-8"
    soup = BeautifulSoup(resp.text, "html.parser")

    table = soup.find("table", class_="gikai")
    if table is None:
        print("  [ERROR] 議員一覧テーブル(class=gikai)が見つかりません")
        return None

    members = []
    rows = table.find_all("tr")
    # 先頭2行はヘッダ（rowspan構造）
    for tr in rows[2:]:
        tds = tr.find_all("td")
        if len(tds) < 10:
            continue

        seat_raw = tds[0].get_text(strip=True)
        seat_num = normalize_num(seat_raw)
        if not seat_num.isdigit():
            continue

        position = tds[1].get_text(strip=True).replace(" ", "").replace("\u3000", "")
        # 氏名セル: <span>ふりがな</span><br>氏名
        name_cell = tds[2]
        furigana_el = name_cell.find("span")
        furigana = clean_name(furigana_el.get_text()) if furigana_el else ""
        # ふりがなのspanを除去して残った文字が漢字氏名
        if furigana_el:
            furigana_el.extract()
        name = clean_name(name_cell.get_text(" ", strip=True))

        committees = parse_committees([tds[4], tds[5], tds[6]])
        party = tds[9].get_text(strip=True)
        # 「無」は無所属扱い
        party_out = "" if party in ("無", "") else party

        # 会派情報は掲載なし（村議会のため全員無所属想定）
        # 議長・副議長は faction ではなく position として別扱い
        member = {
            "seat_number": int(seat_num),
            "name": name,
            "furigana": furigana,
            "party": party_out,
            "faction": "",
            "committees": committees,
        }
        if position:
            member["position"] = position
        members.append(member)

    if not members:
        print("  [ERROR] 議員が1名も抽出できませんでした")
        return None

    members.sort(key=lambda m: m["seat_number"])
    output_path = OUTPUT_DIR / "members.json"
    output_path.write_text(
        json.dumps(members, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"  {len(members)}名を {output_path} に保存しました")
    return members


if __name__ == "__main__":
    result = scrape()
    if result:
        for m in result:
            print(f"  [{m['seat_number']}] {m['name']} ({m['furigana']}) "
                  f"{m.get('position','')} 委員会={len(m['committees'])}件")
