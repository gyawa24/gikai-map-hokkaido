"""
赤平市議会 議員名簿スクレイパー
出力: data/akabira/members.json

データ取得元:
  議員紹介ページ: https://www.city.akabira.hokkaido.jp/docs/pages123.html
  議員名簿PDF:   /fs/1/1/4/4/6/1/_/02_____R7.3.18_.pdf
  会派名簿PDF:   /fs/1/1/4/4/5/9/_/02_____R7.3.1_.pdf

HTMLには議員情報がテキストとして存在しないため PDF から pdfplumber で抽出する。
委員会情報は公式サイトに掲載がないため空のまま出力する。
"""

import json
import re
import tempfile
from pathlib import Path

import pdfplumber
import requests

BASE_URL = "https://www.city.akabira.hokkaido.jp"
MEMBERS_PDF_URL = f"{BASE_URL}/fs/1/1/4/4/6/1/_/02_____R7.3.18_.pdf"
FACTIONS_PDF_URL = f"{BASE_URL}/fs/1/1/4/4/5/9/_/02_____R7.3.1_.pdf"

OUTPUT_DIR = Path(__file__).parent.parent.parent / "data" / "akabira"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def download_pdf(url: str) -> str | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=30)
        resp.raise_for_status()
        tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
        tmp.write(resp.content)
        tmp.close()
        return tmp.name
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def strip_spaces(s: str) -> str:
    """全角/半角スペースを除去して漢字・かなをつなげる"""
    return re.sub(r"[\s\u3000]+", "", s or "")


def parse_members_pdf(path: str) -> list[dict]:
    """議員名簿PDFのテーブルから議員情報を抽出"""
    members: list[dict] = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables():
                if not table or len(table) < 2:
                    continue
                header = [strip_spaces(c or "") for c in table[0]]
                if "議席番号" not in "".join(header):
                    continue
                for row in table[1:]:
                    if not row or len(row) < 7:
                        continue
                    seat_raw = strip_spaces(row[0] or "")
                    if not seat_raw.isdigit():
                        continue
                    seat = int(seat_raw)
                    name_cell = row[1] or ""
                    party_cell = strip_spaces(row[6] or "")

                    # name_cell は "こん の ひろし\n今 野 宙" のような形
                    lines = [ln for ln in name_cell.splitlines() if ln.strip()]
                    furigana = ""
                    name = ""
                    if len(lines) >= 2:
                        furigana = strip_spaces(lines[0])
                        name = strip_spaces(lines[1])
                    elif len(lines) == 1:
                        name = strip_spaces(lines[0])

                    members.append({
                        "seat_number": seat,
                        "name": name,
                        "furigana": furigana,
                        "party": party_cell,
                        "faction": "",
                        "committees": [],
                    })
    return members


def parse_factions_pdf(path: str) -> dict[str, str]:
    """会派名簿PDFから {議員名: 会派名} を構築"""
    name_to_faction: dict[str, str] = {}
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables():
                if not table:
                    continue
                current_faction = ""
                for row in table:
                    if not row:
                        continue
                    # 1列目に会派名（改行で読み仮名付き）、3列目に氏名
                    faction_cell = row[0] or ""
                    name_cell = row[-1] or ""

                    if faction_cell.strip():
                        # "（しんせいくらぶ）\n新 政 ク ラ ブ\n（４人）" のような形
                        lines = [ln.strip() for ln in faction_cell.splitlines() if ln.strip()]
                        # 括弧なしの行を会派名とする
                        jp_lines = [ln for ln in lines if not (ln.startswith("（") or ln.startswith("("))]
                        if jp_lines:
                            current_faction = strip_spaces(jp_lines[0])

                    name_clean = strip_spaces(name_cell)
                    if name_clean and current_faction and name_clean != "氏名":
                        name_to_faction[name_clean] = current_faction
    return name_to_faction


def main() -> None:
    print("赤平市議会 議員名簿を収集中...")

    members_pdf = download_pdf(MEMBERS_PDF_URL)
    factions_pdf = download_pdf(FACTIONS_PDF_URL)

    if not members_pdf:
        print("  議員名簿PDF取得失敗")
        return

    members = parse_members_pdf(members_pdf)
    if not members:
        print("  議員情報が抽出できませんでした（PDF構造変更の可能性）")
        return

    if factions_pdf:
        faction_map = parse_factions_pdf(factions_pdf)
        for m in members:
            f = faction_map.get(m["name"], "")
            if f:
                m["faction"] = f

    # 検証
    print(f"  抽出議員数: {len(members)}")
    for m in members:
        print(f"  [{m['seat_number']:>2}] {m['name']}（{m['furigana']}） 党={m['party']} 会派={m['faction']}")

    out_path = OUTPUT_DIR / "members.json"
    out_path.write_text(
        json.dumps(members, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"  保存: {out_path}")


if __name__ == "__main__":
    main()
