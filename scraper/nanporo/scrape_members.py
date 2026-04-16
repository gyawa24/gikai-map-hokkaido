"""
南幌町議会 議員名簿スクレイパー
出力: data/nanporo/members.json

HTMLページ内のPDFリンクを動的に取得し、pdfplumber のテーブル抽出で
議員情報をパースする。議員名簿はPDFのみで提供されているため。
"""

import json
import re
import sys
from pathlib import Path

import pdfplumber
import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.nanporo.hokkaido.jp"
COUNCIL_URL = f"{BASE_URL}/about/politics/council/about/"

ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = ROOT / "data" / "nanporo"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
SITE_OUTPUT_DIR = ROOT / "site" / "data" / "nanporo"
SITE_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def find_meibo_pdf_url() -> str | None:
    resp = requests.get(COUNCIL_URL, headers=HEADERS, timeout=20)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding
    soup = BeautifulSoup(resp.text, "html.parser")
    for a in soup.find_all("a", href=True):
        href = a["href"]
        text = a.get_text(strip=True)
        if ".pdf" not in href.lower():
            continue
        if "議員名簿" in text or "議員名簿" in href or "議会構成" in text:
            return href if href.startswith("http") else BASE_URL + href
    return None


def normalize_space(s: str) -> str:
    # 全角・半角の空白をすべて除去
    return re.sub(r"[\s\u3000]+", "", s or "")


def normalize_party(raw: str) -> str:
    p = normalize_space(raw)
    # "無" は所属なし（無所属）として空文字に
    if p in ("", "無", "なし"):
        return ""
    return p


def parse_name_cell(cell: str) -> tuple[str, str]:
    # "ゆもと かなめ\n湯 本 要" → (氏名, ふりがな)
    if not cell:
        return "", ""
    lines = [ln.strip() for ln in cell.split("\n") if ln.strip()]
    if len(lines) >= 2:
        furigana = normalize_space(lines[0])
        name = normalize_space(lines[1])
    else:
        name = normalize_space(lines[0])
        furigana = ""
    return name, furigana


def parse_committees(cell: str) -> list[str]:
    if not cell:
        return []
    items = [normalize_space(ln) for ln in cell.split("\n")]
    return [x for x in items if x]


def scrape():
    print("南幌町議会 議員名簿を収集中...")
    pdf_url = find_meibo_pdf_url()
    if not pdf_url:
        print("  [ERROR] 議員名簿PDFのリンクが見つかりません")
        return 1
    print(f"  PDF: {pdf_url}")

    pdf_resp = requests.get(pdf_url, headers=HEADERS, timeout=30)
    pdf_resp.raise_for_status()
    pdf_path = Path("/tmp/nanporo_meibo.pdf")
    pdf_path.write_bytes(pdf_resp.content)

    members: list[dict] = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables() or []:
                for row in table:
                    if not row or len(row) < 7:
                        continue
                    seat_raw = normalize_space(row[0] or "")
                    if not seat_raw.isdigit():
                        continue
                    name, furigana = parse_name_cell(row[2] or "")
                    if not name:
                        continue
                    members.append({
                        "seat_number": int(seat_raw),
                        "name": name,
                        "furigana": furigana,
                        "party": normalize_party(row[4] or ""),
                        "faction": "",
                        "committees": parse_committees(row[6] or ""),
                    })

    if not members:
        print("  [ERROR] 議員データの抽出に失敗")
        return 1

    members.sort(key=lambda m: m["seat_number"])
    payload = {
        "source_url": COUNCIL_URL,
        "source_pdf": pdf_url,
        "members": members,
    }

    out = OUTPUT_DIR / "members.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    site_out = SITE_OUTPUT_DIR / "members.json"
    site_out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"  取得議員数: {len(members)}名")
    print(f"  出力: {out}")
    print(f"  出力: {site_out}")
    return 0


if __name__ == "__main__":
    sys.exit(scrape())
