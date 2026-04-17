"""
奥尻町議会 議員名簿スクレイパー
出力: data/okushiri/members.json

公式サイト上に議員一覧HTMLページが存在しないため、
PDFから pdfplumber で抽出する。
PDF URL: https://www.town.okushiri.lg.jp/hotnews/files/00001500/00001537/
"""

import json
import re
import tempfile
from pathlib import Path

import pdfplumber
import requests

PDF_URL = (
    "https://www.town.okushiri.lg.jp/hotnews/files/00001500/00001537/"
    "%E8%AD%B0%E5%93%A1%E5%90%8D%E7%B0%BF(R5.7.1).pdf"
)
COUNCIL_URL = "https://www.town.okushiri.lg.jp/hotnews/detail/00001537.html"

OUTPUT_DIR = Path(__file__).parent.parent.parent / "site" / "data" / "okushiri"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR = Path(__file__).parent.parent.parent / "site" / "public" / "members" / "okushiri"
PHOTO_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def fetch_pdf(url: str) -> bytes | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=30)
        resp.raise_for_status()
        return resp.content
    except Exception as e:
        print(f"  [ERROR] PDF取得失敗: {e}")
        return None


def extract_members_from_pdf(pdf_bytes: bytes) -> list[dict]:
    members = []
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
        f.write(pdf_bytes)
        tmp_path = f.name

    with pdfplumber.open(tmp_path) as pdf:
        for page in pdf.pages:
            print(f"  ページ {page.page_number} を処理中...")
            # テーブル抽出を試みる
            tables = page.extract_tables()
            if tables:
                for table in tables:
                    for row in table:
                        if not row:
                            continue
                        row_text = [cell.strip() if cell else "" for cell in row]
                        print(f"    行: {row_text}")
                        members.append(row_text)
            else:
                # テーブルがない場合はテキスト抽出
                text = page.extract_text()
                if text:
                    print(f"  テキスト:\n{text}")

    Path(tmp_path).unlink(missing_ok=True)
    return members


def parse_members(raw_rows: list) -> list[dict]:
    """
    PDFから抽出した行データを議員オブジェクトに変換する。
    テーブル構造（奥尻町議会議員名簿）:
      col0: 役職名（議長/副議長/議員）
      col1: 氏名（ふりがな\n漢字氏名）
      col2: 所属する委員会等
      col3: 党派
      col4: 職業
      col5: 当選回数
    """
    members = []
    seat = 0

    for row in raw_rows:
        if not row or len(row) < 2:
            continue

        # ヘッダー行をスキップ
        if row[0] and re.search(r"役\s*職\s*名|所属する|委員長|副委員長|当\s*選", row[0]):
            continue

        # 役職列が議長/副議長/議員でなければスキップ（スペース除去してから判定）
        role_cell = re.sub(r"\s+", "", row[0]) if row[0] else ""
        if not re.search(r"議長|副議長|議員", role_cell):
            continue

        name_cell = row[1].strip() if len(row) > 1 and row[1] else ""
        if not name_cell:
            continue

        # ふりがな（1行目）と氏名（2行目）を分離
        lines = [l.strip() for l in name_cell.split("\n") if l.strip()]
        if len(lines) >= 2:
            # ひらがなのみの行をふりがな、漢字を含む行を氏名として識別
            furigana_lines = [l for l in lines if re.search(r"[ぁ-ん]", l)]
            kanji_lines = [l for l in lines if re.search(r"[一-龥]", l)]
            furigana = re.sub(r"\s+", "", furigana_lines[0]) if furigana_lines else ""
            name = re.sub(r"\s+", "", kanji_lines[0]) if kanji_lines else re.sub(r"\s+", "", lines[-1])
        else:
            furigana = ""
            name = re.sub(r"\s+", "", lines[0])

        if not name or not re.search(r"[一-龥]", name):
            continue

        # 委員会
        committee_cell = row[2].strip() if len(row) > 2 and row[2] else ""
        committees = []
        if committee_cell:
            for line in committee_cell.split("\n"):
                line = re.sub(r"^[◎○]", "", line).strip()
                if line:
                    committees.append(line)

        # 党派
        party = row[3].strip() if len(row) > 3 and row[3] else ""
        party = re.sub(r"\s+", "", party)

        seat += 1
        members.append(
            {
                "seat_number": seat,
                "name": name,
                "furigana": furigana,
                "party": party,
                "faction": "",
                "committees": committees,
                "photo_url": "",
            }
        )

    return members


def main():
    print("奥尻町議会 議員名簿を収集中...")
    print(f"  PDF URL: {PDF_URL}")

    pdf_bytes = fetch_pdf(PDF_URL)
    if pdf_bytes is None:
        print("取得不可: PDFファイルの取得に失敗しました。")
        return

    print(f"  PDF取得成功 ({len(pdf_bytes)} bytes)")

    raw_rows = extract_members_from_pdf(pdf_bytes)
    print(f"\n  抽出行数: {len(raw_rows)}")

    members = parse_members(raw_rows)
    print(f"\n  議員数: {len(members)}名")

    if not members:
        print("取得不可: PDFから議員データを抽出できませんでした。")
        return

    for m in members:
        print(f"  [{m['seat_number']}] {m['name']} ({m['furigana']}) / {m['faction']}")

    out_path = OUTPUT_DIR / "members.json"
    out_path.write_text(json.dumps(members, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n  保存完了: {out_path}")
    print(f"取得議員数: {len(members)}名")


if __name__ == "__main__":
    main()
