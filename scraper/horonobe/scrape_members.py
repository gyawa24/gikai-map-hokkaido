"""
幌延町議会 議員名簿スクレイパー

公式HTMLにリスト形式の議員情報がないため、議会構成ページから
PDF（幌延町議会議員名簿）のリンクを動的に取得し pdfplumber でパースする。

出力:
  - data/horonobe/members.json
  - site/data/horonobe/members.json
"""

import json
import re
import urllib.parse
from pathlib import Path

import pdfplumber
import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.horonobe.lg.jp"
INDEX_URL = f"{BASE_URL}/www4/section/gikai/le009f00000006e8.html"

REPO_ROOT = Path(__file__).parent.parent.parent
DATA_DIR = REPO_ROOT / "data" / "horonobe"
SITE_DATA_DIR = REPO_ROOT / "site" / "data" / "horonobe"
DATA_DIR.mkdir(parents=True, exist_ok=True)
SITE_DATA_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def find_members_pdf_url() -> str | None:
    resp = requests.get(INDEX_URL, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding
    soup = BeautifulSoup(resp.text, "html.parser")

    for a in soup.find_all("a", href=True):
        text = a.get_text(strip=True)
        href = a["href"]
        if not href.lower().endswith(".pdf"):
            continue
        if "議員名簿" in text:
            return urllib.parse.urljoin(INDEX_URL, href)
    return None


def normalize_name(raw: str) -> str:
    return re.sub(r"\s+", " ", raw.strip())


def split_committees(raw: str) -> list[str]:
    lines = [ln.strip() for ln in raw.splitlines() if ln.strip()]
    return lines


def extract_faction(committees: list[str]) -> str:
    for c in committees:
        if c in ("議長", "副議長"):
            return c
    return ""


def parse_members(pdf_path: Path) -> list[dict]:
    members: list[dict] = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables():
                for row in table:
                    if not row or len(row) < 7:
                        continue
                    seat_raw = (row[0] or "").strip()
                    if not seat_raw.isdigit():
                        continue
                    name = normalize_name(row[1] or "")
                    party = (row[5] or "").strip()
                    committees = split_committees(row[6] or "")
                    if not name:
                        continue
                    members.append(
                        {
                            "seat_number": int(seat_raw),
                            "name": name,
                            "furigana": "",
                            "party": party,
                            "faction": extract_faction(committees),
                            "committees": committees,
                        }
                    )
    members.sort(key=lambda m: m["seat_number"])
    return members


def main() -> None:
    print("幌延町議会 議員名簿を収集中...")

    pdf_url = find_members_pdf_url()
    if not pdf_url:
        print("  [ERROR] 議員名簿PDFのリンクが見つかりません")
        return
    print(f"  PDF URL: {pdf_url}")

    pdf_path = DATA_DIR / "members.pdf"
    resp = requests.get(pdf_url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    pdf_path.write_bytes(resp.content)
    print(f"  PDF保存: {pdf_path} ({len(resp.content):,} bytes)")

    members = parse_members(pdf_path)
    if not members:
        print("  [ERROR] 議員データを抽出できませんでした")
        return

    out_path = DATA_DIR / "members.json"
    site_out_path = SITE_DATA_DIR / "members.json"
    payload = json.dumps(members, ensure_ascii=False, indent=2)
    out_path.write_text(payload, encoding="utf-8")
    site_out_path.write_text(payload, encoding="utf-8")

    print(f"  取得議員数: {len(members)}名")
    for m in members:
        print(f"    [{m['seat_number']}] {m['name']} ({m['party']}) {m['faction']}".rstrip())
    print(f"  出力: {out_path}")
    print(f"  出力: {site_out_path}")


if __name__ == "__main__":
    main()
