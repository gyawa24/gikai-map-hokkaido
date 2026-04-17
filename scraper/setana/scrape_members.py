"""
せたな町議会 議員名簿スクレイパー
出力: data/setana/members.json
議員名簿PDFをpdfplumberで解析する
テーブル列構成: 番号 | 氏名 | (空) | 生年月日 | 年齢 | 所属委員会等 | 職業
"""

import json
import re
import tempfile
from pathlib import Path

import requests
import pdfplumber

BASE_URL = "https://www.town.setana.lg.jp"
MEMBERS_PDF_URL = f"{BASE_URL}/gikai/fa7206c2ca452a4c9f0ef79a3d7edbac.pdf"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "site" / "data" / "setana"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
DATA_DIR = Path(__file__).parent.parent.parent / "data" / "setana"
DATA_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def fetch_pdf_bytes(url: str) -> bytes | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=30)
        resp.raise_for_status()
        return resp.content
    except Exception as e:
        print(f"  [ERROR] PDF取得失敗 {url} -> {e}")
        return None


def normalize_name(raw: str) -> str:
    """
    "石 原 広 務" -> "石原 広務" 形式に正規化
    PDFから抽出した氏名は各文字間にスペースが入るため、
    2文字ずつ（姓・名）にまとめる
    """
    # スペースを除去して連続文字に
    chars = raw.replace(" ", "").replace("　", "")
    # 姓名を推定（3文字なら2+1、4文字なら2+2を基本とする）
    if len(chars) == 3:
        return chars[:2] + " " + chars[2:]
    elif len(chars) == 4:
        return chars[:2] + " " + chars[2:]
    elif len(chars) == 5:
        return chars[:3] + " " + chars[3:]
    else:
        return chars


def parse_committees(raw: str) -> list[str]:
    """委員会テキストをリストに変換"""
    if not raw:
        return []
    items = [s.strip() for s in raw.split("\n") if s.strip()]
    # 役職付き委員会名（◎議長 など）は除外
    return [item for item in items if item and not item.startswith("(")]


def main():
    print("せたな町議会 議員名簿を収集中...")

    pdf_bytes = fetch_pdf_bytes(MEMBERS_PDF_URL)
    if not pdf_bytes:
        print("取得不可: 議員名簿PDFのダウンロードに失敗しました")
        return

    members = []

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
        f.write(pdf_bytes)
        tmp_path = f.name

    try:
        with pdfplumber.open(tmp_path) as pdf:
            for page in pdf.pages:
                tables = page.extract_tables()
                for table in tables:
                    for row in table:
                        cells = [str(c).strip() if c else "" for c in row]

                        # ヘッダー行スキップ
                        if not cells or cells[0] == "番号" or not re.match(r"^\d+$", cells[0]):
                            continue

                        seat = int(cells[0])
                        raw_name = cells[1] if len(cells) > 1 else ""
                        committees_raw = cells[5] if len(cells) > 5 else ""

                        if not raw_name:
                            continue

                        name = normalize_name(raw_name)
                        committees = parse_committees(committees_raw)

                        members.append({
                            "seat_number": seat,
                            "name": name,
                            "furigana": "",
                            "party": "",
                            "faction": "",
                            "committees": committees,
                            "photo_url": "",
                        })
    finally:
        Path(tmp_path).unlink(missing_ok=True)

    if not members:
        print("取得不可: PDFテーブルから議員情報を抽出できませんでした")
        return

    print(f"\n  取得議員数: {len(members)}名")
    for m in members:
        print(f"    {m['seat_number']}. {m['name']} / 委員会: {m['committees']}")

    output = OUTPUT_DIR / "members.json"
    output.write_text(json.dumps(members, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n  保存: {output}")

    data_output = DATA_DIR / "members.json"
    data_output.write_text(json.dumps(members, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  保存: {data_output}")


if __name__ == "__main__":
    main()
