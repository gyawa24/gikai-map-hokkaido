"""
初山別村議会 議員名簿スクレイパー
ソース: https://www.vill.shosanbetsu.lg.jp/gyosei/gyoseijoho/gikai.html (PDF)
出力: data/shosanbetsu/members.json
"""

import json
import re
from pathlib import Path

import pdfplumber
import requests

BASE_URL = "https://www.vill.shosanbetsu.lg.jp"
COUNCIL_PAGE = f"{BASE_URL}/gyosei/gyoseijoho/gikai.html"
ROOT = Path(__file__).parent.parent.parent
PDF_CACHE = ROOT / "data" / "shosanbetsu" / "members.pdf"
OUT_DIR = ROOT / "data" / "shosanbetsu"
SITE_OUT_DIR = ROOT / "site" / "data" / "shosanbetsu"
OUT_DIR.mkdir(parents=True, exist_ok=True)
SITE_OUT_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def find_pdf_url() -> str | None:
    resp = requests.get(COUNCIL_PAGE, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding
    m = re.search(
        r'href="([^"]+\.pdf)"[^>]*>\s*初山別村議会議員一覧表',
        resp.text,
    )
    if not m:
        return None
    href = m.group(1)
    return href if href.startswith("http") else BASE_URL + href


def download_pdf(url: str) -> Path:
    resp = requests.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    PDF_CACHE.write_bytes(resp.content)
    return PDF_CACHE


def clean(s: str | None) -> str:
    if not s:
        return ""
    return re.sub(r"\s+", " ", s).strip()


def parse_name(cell: str) -> tuple[str, str]:
    """'かとう かずひろ\n加 藤 一 裕' -> (name, furigana)"""
    lines = [ln.strip() for ln in cell.splitlines() if ln.strip()]
    if len(lines) < 2:
        return clean(cell).replace(" ", ""), ""
    furigana = lines[0].replace(" ", "").replace("\u3000", "")
    name = lines[1].replace(" ", "").replace("\u3000", "")
    return name, furigana


def parse_committees(cell: str) -> tuple[list[str], str]:
    """
    所属委員欄から委員会名のリストと faction（議長/副議長 等の役職）を抽出。
    '◎ 総務経済\n○ 議会運営' のように委員長マーカー付き。
    """
    faction = ""
    committees: list[str] = []
    for raw in cell.splitlines():
        line = raw.strip()
        if not line:
            continue
        # 役職判定（議長・副議長）
        if "議 長" in line or line == "議長":
            faction = "議長"
            continue
        if "副議長" in line:
            faction = "副議長"
            continue
        # 委員長・副委員長マーカーを除去
        marker = ""
        if line.startswith("◎"):
            marker = "（委員長）"
            line = line[1:].strip()
        elif line.startswith("○"):
            marker = "（副委員長）"
            line = line[1:].strip()
        if line:
            committees.append(line + marker)
    return committees, faction


def extract_members() -> list[dict]:
    members: list[dict] = []
    with pdfplumber.open(PDF_CACHE) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables():
                for row in table:
                    if not row or len(row) < 5:
                        continue
                    seat_cell = clean(row[1]) if len(row) > 1 else ""
                    if not seat_cell.isdigit():
                        continue
                    seat_number = int(seat_cell)
                    name_cell = row[4] or ""
                    if not name_cell.strip():
                        continue  # 欠員
                    name, furigana = parse_name(name_cell)
                    if not name:
                        continue
                    committees_cell = row[2] or ""
                    party_cell = clean(row[3])
                    committees, faction = parse_committees(committees_cell)
                    members.append({
                        "seat_number": seat_number,
                        "name": name,
                        "furigana": furigana,
                        "party": party_cell,
                        "faction": faction,
                        "committees": committees,
                    })
    members.sort(key=lambda m: m["seat_number"])
    return members


def main() -> None:
    print("初山別村議会 議員名簿を収集中...")
    pdf_url = find_pdf_url()
    if not pdf_url:
        print("  [ERROR] 議員一覧PDFのリンクが見つかりません")
        return
    print(f"  PDF: {pdf_url}")
    download_pdf(pdf_url)

    members = extract_members()
    if not members:
        print("  [ERROR] 議員データを抽出できませんでした")
        return

    for out in (OUT_DIR / "members.json", SITE_OUT_DIR / "members.json"):
        out.write_text(
            json.dumps(members, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"  書き出し: {out}")

    print(f"取得議員数: {len(members)}名")
    for m in members:
        print(f"  {m['seat_number']:2d} {m['name']} ({m['furigana']}) "
              f"{m['faction']} / {', '.join(m['committees'])}")


if __name__ == "__main__":
    main()
