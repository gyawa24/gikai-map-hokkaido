"""
松前町議会 議員名簿スクレイパー
出力: data/matsumae/members.json

松前町は議員一覧をHTMLではなくPDF（議会構成）で公開しているため、
pdfplumberでテーブルを抽出する。公式サイトからPDFを毎回ダウンロードし、
議員データは一切ハードコードしない。
"""

import json
import re
from pathlib import Path

import pdfplumber
import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.matsumae.hokkaido.jp"
INDEX_URL = f"{BASE_URL}/hotnews/detail/00000542.html"

ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = ROOT / "data" / "matsumae"
SITE_OUTPUT_DIR = ROOT / "site" / "data" / "matsumae"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
SITE_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

COMMITTEE_NAMES = {
    "総務経済": "総務経済常任委員会",
    "厚生文教": "厚生文教常任委員会",
    "議会運営": "議会運営委員会",
}

ROLE_MARKS = {"◎": "委員長", "○": "副委員長", "●": "委員"}


def fetch_pdf_url() -> str | None:
    resp = requests.get(INDEX_URL, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding
    soup = BeautifulSoup(resp.text, "html.parser")
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if href.lower().endswith(".pdf") and "gikai" in href.lower():
            return href if href.startswith("http") else BASE_URL + href
    for a in soup.find_all("a", href=True):
        if a["href"].lower().endswith(".pdf"):
            href = a["href"]
            return href if href.startswith("http") else BASE_URL + href
    return None


def download_pdf(url: str, dest: Path) -> None:
    resp = requests.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    dest.write_bytes(resp.content)


def normalize_name(raw: str) -> str:
    return re.sub(r"\s+", "", raw or "").strip()


def clean_remarks(raw: str | None) -> list[str]:
    if not raw:
        return []
    parts = [p.strip() for p in re.split(r"[\n\r]+", raw) if p.strip()]
    return parts


def parse_members_from_pdf(pdf_path: Path) -> list[dict]:
    members: list[dict] = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            tables = page.extract_tables()
            for table in tables:
                if not table or len(table) < 3:
                    continue
                header = table[0]
                if not any(cell and "議席" in cell for cell in header if cell):
                    continue

                # 列インデックスを動的に決定
                col_idx = {}
                for i, cell in enumerate(header):
                    if not cell:
                        continue
                    t = cell.replace(" ", "").replace("\n", "")
                    if "議席" in t:
                        col_idx["seat"] = i
                    elif "氏名" in t or "氏 名" in cell:
                        col_idx["name"] = i
                    elif "党派" in t or "会派" in t:
                        col_idx["party"] = i
                    elif "当選回数" in t:
                        col_idx["elections"] = i
                    elif "摘要" in t:
                        col_idx["remarks"] = i
                    elif "議会運営" in t:
                        col_idx["unei"] = i

                # 委員会列（サブヘッダ行から解決）
                committee_cols: dict[int, str] = {}
                if len(table) >= 2:
                    sub = table[1]
                    for i, cell in enumerate(sub):
                        if not cell:
                            continue
                        t = cell.replace(" ", "").replace("\n", "")
                        for key, full in COMMITTEE_NAMES.items():
                            if key in t:
                                committee_cols[i] = full
                if "unei" in col_idx:
                    committee_cols[col_idx["unei"]] = COMMITTEE_NAMES["議会運営"]

                for row in table[2:]:
                    if not row:
                        continue
                    seat_cell = row[col_idx["seat"]] if "seat" in col_idx else None
                    name_cell = row[col_idx["name"]] if "name" in col_idx else None
                    if not seat_cell or not name_cell:
                        continue
                    seat_match = re.search(r"\d+", seat_cell)
                    if not seat_match:
                        continue
                    seat_number = int(seat_match.group())
                    name = normalize_name(name_cell)
                    if not name:
                        continue

                    party = ""
                    if "party" in col_idx and row[col_idx["party"]]:
                        party = row[col_idx["party"]].strip()

                    committees: list[str] = []
                    for ci, cname in committee_cols.items():
                        cell = row[ci] if ci < len(row) else None
                        if not cell:
                            continue
                        mark = cell.strip()
                        role = None
                        for m, r in ROLE_MARKS.items():
                            if m in mark:
                                role = r
                                break
                        if role:
                            committees.append(f"{cname}（{role}）")

                    remarks_cell = (
                        row[col_idx["remarks"]] if "remarks" in col_idx else None
                    )
                    remarks_list = clean_remarks(remarks_cell)

                    # 議長・副議長・監査委員などを faction/摘要に反映
                    role_titles: list[str] = []
                    for r in remarks_list:
                        if r in ("議長", "副議長", "議会選出監査委員"):
                            role_titles.append(r)

                    faction = ""  # 松前町は会派の記載なし（党派のみ）

                    member = {
                        "seat_number": seat_number,
                        "name": name,
                        "furigana": "",
                        "party": party,
                        "faction": faction,
                        "committees": committees,
                        "roles": role_titles,
                        "remarks": remarks_list,
                    }
                    members.append(member)

    members.sort(key=lambda m: m["seat_number"])
    return members


def main() -> None:
    print("松前町議会 議員名簿を収集中...")
    pdf_url = fetch_pdf_url()
    if not pdf_url:
        print("  [ERROR] PDFリンクが見つかりませんでした")
        return
    print(f"  PDF URL: {pdf_url}")

    pdf_path = OUTPUT_DIR / "gikaikousei.pdf"
    download_pdf(pdf_url, pdf_path)
    print(f"  PDF保存: {pdf_path}")

    members = parse_members_from_pdf(pdf_path)
    if not members:
        print("  [ERROR] PDFから議員データを抽出できませんでした")
        return

    out_path = OUTPUT_DIR / "members.json"
    site_out_path = SITE_OUTPUT_DIR / "members.json"
    payload = {
        "source_url": INDEX_URL,
        "source_pdf": pdf_url,
        "members": members,
    }
    for p in (out_path, site_out_path):
        p.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"  保存: {p}")

    print(f"取得議員数: {len(members)}名")


if __name__ == "__main__":
    main()
