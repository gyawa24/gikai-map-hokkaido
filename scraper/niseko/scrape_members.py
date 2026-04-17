"""
ニセコ町議会 議員名簿スクレイパー
出力:
  - data/niseko/members.json
  - site/data/niseko/members.json
写真: 個別写真は公開されていない（集合写真のみ）ためスキップ。
"""

import json
import re
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.niseko.lg.jp"
MEMBERS_URL = f"{BASE_URL}/chosei/gikai/meibo/"

ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIRS = [
    ROOT / "data" / "niseko",
    ROOT / "site" / "data" / "niseko",
]

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
    # 全角スペースを半角スペース1つに、連続スペースを1つに集約
    s = raw.replace("\u3000", " ")
    s = re.sub(r"\s+", " ", s).strip()
    return s


def clean_cell(raw: str) -> str:
    # 全角/ノーブレークスペースを半角へ、連続する空白を 1 つにまとめる
    # 氏名の旧字体を壊さないため NFKC 正規化は使わない
    s = raw.replace("\u3000", " ").replace("\xa0", " ")
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def split_committees(raw_html_cell) -> list[str]:
    """
    所属委員会セルは <br> や改行で区切られた複数行。
    役職（議長/副議長）プレフィックスも 1 項目として保持する。
    """
    # <br> を改行に置換してから text 化
    for br in raw_html_cell.find_all("br"):
        br.replace_with("\n")
    text = raw_html_cell.get_text("\n", strip=True)
    lines = [clean_cell(ln) for ln in text.split("\n")]
    return [ln for ln in lines if ln]


def extract_role(committees: list[str]) -> tuple[str, list[str]]:
    """
    議長 / 副議長 が委員会リストの先頭に連結されているケースがあるため分離する。
    例: "議長 産業建設常任委員会（委員）" -> role="議長", 残り=["産業建設常任委員会（委員）"]
    """
    role = ""
    cleaned: list[str] = []
    for item in committees:
        m = re.match(r"^(議長|副議長)\s+(.+)$", item)
        if m:
            role = m.group(1)
            cleaned.append(m.group(2).strip())
        else:
            cleaned.append(item)
    return role, cleaned


def scrape_members() -> list[dict]:
    print(f"ニセコ町議会 議員名簿を収集中: {MEMBERS_URL}")
    soup = fetch(MEMBERS_URL)
    if soup is None:
        return []

    # 議員一覧テーブルを特定（ヘッダに「議席」「氏名」「党派」を含むテーブル）
    target_table = None
    for table in soup.find_all("table"):
        header_text = table.get_text(" ", strip=True)
        if "議席" in header_text and "党派" in header_text and "所属委員会" in header_text:
            target_table = table
            break

    if target_table is None:
        print("  [ERROR] 議員一覧テーブルが見つかりませんでした")
        return []

    rows = target_table.find_all("tr")
    members: list[dict] = []

    for tr in rows:
        cells = tr.find_all(["td", "th"])
        if len(cells) < 6:
            continue
        seat_raw = clean_cell(cells[0].get_text(" ", strip=True))
        if not re.fullmatch(r"\d+", seat_raw):
            # ヘッダ行等をスキップ
            continue

        seat = int(seat_raw)
        name = normalize_name(cells[1].get_text(" ", strip=True))
        # 職業 cells[2], 当選回数 cells[3] は現スキーマ外
        committees_raw = split_committees(cells[4])
        role, committees = extract_role(committees_raw)
        party = clean_cell(cells[5].get_text(" ", strip=True))
        # 党派セルが改行を含む場合（例: "日本\n共産党"）に整形
        party = re.sub(r"\s+", "", party)

        faction = role  # 議長/副議長を faction に格納（他市と同等の扱い）

        member = {
            "seat_number": seat,
            "name": name,
            "furigana": "",
            "party": party,
            "faction": faction,
            "committees": committees,
            "photo_url": "",
        }
        members.append(member)
        print(f"  [{seat}] {name} / {party} / {faction or '-'} / {committees}")

    members.sort(key=lambda m: m["seat_number"])
    return members


def write_outputs(members: list[dict]) -> None:
    payload = {"members": members}
    for d in OUTPUT_DIRS:
        d.mkdir(parents=True, exist_ok=True)
        out = d / "members.json"
        out.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"  書き出し: {out}")


def main() -> None:
    members = scrape_members()
    if not members:
        print("取得不可: 議員データを抽出できませんでした")
        return
    write_outputs(members)
    print(f"取得議員数: {len(members)}名")


if __name__ == "__main__":
    main()
