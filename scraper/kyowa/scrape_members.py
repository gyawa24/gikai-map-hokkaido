"""
共和町議会 議員名簿スクレイパー
出力:
  data/kyowa/members.json
  site/data/kyowa/members.json

取得元: https://www.town.kyowa.hokkaido.jp/administration/?content=476
  （共和町「行政機構図」ページ）

HTMLの1つ目のテーブルに議員定数11名の議席番号・氏名・所属委員会が
テキストで掲載されている。議長・副議長表記は所属委員会セル内に
混在して記述されているため動的に分離する。ふりがな・会派・政党は
公表されていないため空欄。個別の顔写真公表も無いため写真は取得しない。
"""

import json
import re
from pathlib import Path

import requests
from bs4 import BeautifulSoup

URL = "https://www.town.kyowa.hokkaido.jp/administration/?content=476"

OUTPUT_DIR = Path(__file__).parent.parent.parent / "site" / "data" / "kyowa"
ROOT_OUTPUT_DIR = Path(__file__).parent.parent.parent / "data" / "kyowa"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
ROOT_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

POSITION_LABELS = {"議長", "副議長"}


def normalize_ws(s: str) -> str:
    s = s.replace("\u3000", " ").replace("\xa0", " ")
    return re.sub(r"\s+", " ", s).strip()


def find_member_table(soup: BeautifulSoup):
    """ヘッダが「議席番号・氏名・所属委員会」のテーブルを探す。"""
    for table in soup.find_all("table"):
        header = table.find("tr")
        if not header:
            continue
        cells = [normalize_ws(c.get_text()) for c in header.find_all(["th", "td"])]
        if "議席番号" in cells and "氏名" in cells and "所属委員会" in cells:
            return table
    return None


def split_committees(raw: str) -> tuple[list[str], list[str]]:
    """所属委員会セルを (役職ラベル, 委員会エントリ) に分割。

    例:
      "議長"                       -> (["議長"], [])
      "副議長、産業文教、議会運営"   -> (["副議長"], ["産業文教", "議会運営"])
      "総務厚生(委員長)、議会運営"   -> ([], ["総務厚生（委員長）", "議会運営"])
    """
    text = raw.replace("（", "(").replace("）", ")")
    parts = re.split(r"[、,]", text)
    positions: list[str] = []
    committees: list[str] = []
    for p in parts:
        p = normalize_ws(p)
        if not p:
            continue
        if p in POSITION_LABELS:
            positions.append(p)
            continue
        m = re.match(r"^(?P<name>[^()]+)(?:\((?P<role>[^()]+)\))?$", p)
        if not m:
            committees.append(p)
            continue
        name = normalize_ws(m.group("name"))
        role = m.group("role")
        if role:
            committees.append(f"{name}（{normalize_ws(role)}）")
        else:
            committees.append(name)
    return positions, committees


def scrape():
    print(f"共和町議会 議員名簿を収集中... {URL}")
    resp = requests.get(URL, headers=HEADERS, timeout=20)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding
    soup = BeautifulSoup(resp.text, "html.parser")

    table = find_member_table(soup)
    if table is None:
        print("  [ERROR] 議員名簿テーブルが見つかりません")
        return None

    members: list[dict] = []
    for tr in table.find_all("tr"):
        cells = tr.find_all(["th", "td"])
        if len(cells) < 3:
            continue
        seat_raw = normalize_ws(cells[0].get_text())
        if not seat_raw.isdigit():
            continue
        seat = int(seat_raw)
        name = normalize_ws(cells[1].get_text())
        if not name:
            continue
        positions, committees = split_committees(cells[2].get_text())
        faction = "、".join(positions) if positions else ""
        members.append({
            "seat_number": seat,
            "name": name,
            "furigana": "",
            "party": "",
            "faction": faction,
            "committees": committees,
        })

    if not members:
        print("  [ERROR] 議員が1名も抽出できませんでした")
        return None

    members.sort(key=lambda m: m["seat_number"])

    for out_dir in (OUTPUT_DIR, ROOT_OUTPUT_DIR):
        out_path = out_dir / "members.json"
        out_path.write_text(
            json.dumps(members, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"  {len(members)}名を {out_path} に保存しました")

    return members


if __name__ == "__main__":
    r = scrape()
    if r:
        for m in r:
            role = f" [{m['faction']}]" if m["faction"] else ""
            cm = ", ".join(m["committees"]) if m["committees"] else "-"
            print(f"  [{m['seat_number']}] {m['name']}{role} / {cm}")
