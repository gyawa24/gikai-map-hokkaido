"""
京極町議会 議員名簿スクレイパー
出力:
  data/kyogoku/members.json
  site/data/kyogoku/members.json

取得元: https://www.town-kyogoku.jp/page/1079.html
  （京極町議会組織図・議会構成 ページ）

HTMLテーブルに議員氏名がテキストとして掲載されている。ふりがな・会派・政党は
公表されていないため空欄。写真も議員個別ではなく議長・副議長合同画像のみのため
個別写真は取得しない。ハードコード禁止、すべてDOMから動的取得する。
"""

import json
import re
from pathlib import Path

import requests
from bs4 import BeautifulSoup

URL = "https://www.town-kyogoku.jp/page/1079.html"

OUTPUT_DIR = Path(__file__).parent.parent.parent / "site" / "data" / "kyogoku"
ROOT_OUTPUT_DIR = Path(__file__).parent.parent.parent / "data" / "kyogoku"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
ROOT_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

MAIN_COMMITTEES = {
    "総務常任委員会",
    "産業建設常任委員会",
    "議会運営委員会",
}

POSITION_LABELS = {"議長", "副議長", "委員長", "副委員長", "委員"}


def normalize_ws(s: str) -> str:
    s = s.replace("\u3000", " ").replace("\xa0", " ")
    return re.sub(r"\s+", " ", s).strip()


def parse_names_cell(td) -> list[str]:
    """<td>内の複数氏名を抽出（<br>区切り）。"""
    raw = td.get_text(separator="\n")
    names = []
    for line in raw.split("\n"):
        n = normalize_ws(line)
        if n and n not in POSITION_LABELS and n != "":
            names.append(n)
    return names


def find_target_table(soup: BeautifulSoup):
    for table in soup.find_all("table"):
        text = table.get_text()
        if "議長" in text and "副議長" in text and "常任委員会" in text:
            return table
    return None


def scrape():
    print(f"京極町議会 議員名簿を収集中... {URL}")
    resp = requests.get(URL, headers=HEADERS, timeout=20)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding
    soup = BeautifulSoup(resp.text, "html.parser")

    table = find_target_table(soup)
    if table is None:
        print("  [ERROR] 議会構成テーブルが見つかりません")
        return None

    members: dict[str, dict] = {}
    order: list[str] = []

    def upsert(name: str) -> dict:
        if name not in members:
            members[name] = {
                "seat_number": len(order) + 1,
                "name": name,
                "furigana": "",
                "party": "",
                "faction": "",
                "committees": [],
            }
            order.append(name)
        return members[name]

    current_group: str | None = None

    for tr in table.find_all("tr"):
        cells = tr.find_all(["th", "td"], recursive=False)
        if not cells:
            continue

        first = cells[0]
        rest = cells
        if first.name == "th":
            current_group = normalize_ws(first.get_text())
            rest = cells[1:]

        if current_group in {"議長", "副議長"}:
            if not rest:
                continue
            names = parse_names_cell(rest[-1])
            for n in names:
                m = upsert(n)
                if current_group not in m["committees"]:
                    m["committees"].insert(0, current_group)
        elif current_group in MAIN_COMMITTEES:
            if len(rest) < 2:
                continue
            pos = normalize_ws(rest[-2].get_text())
            names = parse_names_cell(rest[-1])
            for n in names:
                m = upsert(n)
                if pos in {"委員長", "副委員長"}:
                    entry = f"{current_group}（{pos}）"
                else:
                    entry = current_group
                if entry not in m["committees"]:
                    m["committees"].append(entry)

    result = [members[n] for n in order]

    if not result:
        print("  [ERROR] 議員が1名も抽出できませんでした")
        return None

    for out_dir in (OUTPUT_DIR, ROOT_OUTPUT_DIR):
        out_path = out_dir / "members.json"
        out_path.write_text(
            json.dumps(result, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"  {len(result)}名を {out_path} に保存しました")

    return result


if __name__ == "__main__":
    r = scrape()
    if r:
        for m in r:
            print(f"  [{m['seat_number']}] {m['name']} / {', '.join(m['committees'])}")
