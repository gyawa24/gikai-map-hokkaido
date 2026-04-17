"""
厚沢部町議会 議員名簿スクレイパー
出力: data/assabu/members.json

公式サイトの議員名簿はHTMLでなくPDFのみで提供されているため、
pdfplumber でPDF表を抽出する。
ハードコード禁止：必ず公式PDFから動的取得する。
"""

import json
import re
from pathlib import Path

import pdfplumber
import requests

PDF_URL = "https://www.town.assabu.lg.jp/uploaded/attachment/5794.pdf"
ROOT = Path(__file__).parent.parent.parent
PDF_PATH = ROOT / "data" / "assabu" / "source.pdf"
OUTPUT_DIR = ROOT / "site" / "data" / "assabu"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
DATA_DIR = ROOT / "data" / "assabu"
DATA_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def download_pdf() -> Path:
    print(f"PDF取得: {PDF_URL}")
    resp = requests.get(PDF_URL, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    PDF_PATH.write_bytes(resp.content)
    print(f"  保存: {PDF_PATH} ({len(resp.content)} bytes)")
    return PDF_PATH


def split_name_and_furigana(cell: str) -> tuple[str, str]:
    """
    PDFセル例:
      "なか やま とし かつ\n中 山 俊 勝"
      "さ さ き ひろし\n佐々木 宏"
    上段: ふりがな（ひらがな主体、空白区切り）
    下段: 漢字氏名（空白区切り）
    """
    if not cell:
        return "", ""
    lines = [ln.strip() for ln in cell.split("\n") if ln.strip()]
    if len(lines) < 2:
        # 1行のみなら漢字とみなし、ふりがな空
        return re.sub(r"\s+", "", lines[0]) if lines else "", ""
    furigana_raw, name_raw = lines[0], lines[1]
    furigana = re.sub(r"\s+", "", furigana_raw)
    name = re.sub(r"\s+", "", name_raw)
    return name, furigana


def parse_committees(committee_cell: str, role_cell: str) -> list[str]:
    """
    常任委員 + 役名 から委員会・役職リストを生成。
    例: 常任委員="産業厚生", 役名="議運委員長" → ["産業厚生常任委員会", "議会運営委員会"]
    """
    items: list[str] = []
    if committee_cell:
        c = committee_cell.strip()
        if c:
            items.append(f"{c}常任委員会")
    if role_cell:
        for line in role_cell.split("\n"):
            line = line.strip()
            if not line:
                continue
            # 議長・副議長は役職であって委員会ではないので除外
            if line in ("議 長", "議長", "副議長", "副 議 長"):
                continue
            # "議運" 系は議会運営委員会に正規化
            if "議運" in line:
                items.append("議会運営委員会")
                continue
            # "広報" 系は広報広聴委員会等の可能性。原文のまま追加
            if "広報" in line:
                items.append(line)
                continue
            # その他（一部事務組合議員など）はそのまま
            items.append(line)
    # 重複除去（順序保持）
    seen = set()
    out = []
    for it in items:
        if it not in seen:
            seen.add(it)
            out.append(it)
    return out


def extract_role_title(role_cell: str) -> str:
    """役名セルから議長・副議長・委員長等の代表的役職を抜き出す（faction風に使用しないが参考）"""
    if not role_cell:
        return ""
    for line in role_cell.split("\n"):
        line = line.strip()
        if line in ("議 長", "議長"):
            return "議長"
        if line in ("副議長", "副 議 長"):
            return "副議長"
    return ""


def scrape() -> list[dict]:
    pdf_path = download_pdf()
    members: list[dict] = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            tables = page.extract_tables()
            for table in tables:
                if not table or len(table) < 2:
                    continue
                header = [(c or "").replace(" ", "") for c in table[0]]
                # ヘッダ判定
                if "議席" not in "".join(header) or "議員名" not in "".join(header):
                    continue
                for row in table[1:]:
                    if not row or len(row) < 2:
                        continue
                    seat_raw = (row[0] or "").strip()
                    name_cell = row[1] or ""
                    if not seat_raw.isdigit():
                        continue
                    if "欠" in name_cell or "欠番" in name_cell:
                        continue
                    seat = int(seat_raw)
                    name, furigana = split_name_and_furigana(name_cell)
                    if not name:
                        continue
                    committee_cell = row[7] if len(row) > 7 else ""
                    role_cell = row[8] if len(row) > 8 else ""
                    committees = parse_committees(committee_cell or "", role_cell or "")
                    role_title = extract_role_title(role_cell or "")
                    members.append({
                        "seat_number": seat,
                        "name": name,
                        "furigana": furigana,
                        "party": "",
                        "faction": role_title,  # 議長/副議長を faction 欄に補助情報として保持
                        "committees": committees,
                    })
    members.sort(key=lambda m: m["seat_number"])
    return members


def main() -> None:
    members = scrape()
    if not members:
        print("取得不可: PDFから議員データを抽出できませんでした")
        return
    out_path = OUTPUT_DIR / "members.json"
    out_path.write_text(
        json.dumps(members, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"取得議員数: {len(members)}名")
    print(f"出力: {out_path}")
    for m in members:
        print(f"  席{m['seat_number']:>2}: {m['name']} ({m['furigana']}) {m['faction']} {m['committees']}")


if __name__ == "__main__":
    main()
