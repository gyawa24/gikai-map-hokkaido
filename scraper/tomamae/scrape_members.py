"""
苫前町議会 議員名簿スクレイパー
出力: data/tomamae/members.json

苫前町は議員一覧をHTMLではなくPDF（議員名簿）で公開しているため、
pdfplumberでテーブルを抽出する。公式サイトからPDFを毎回ダウンロードし、
議員データは一切ハードコードしない。
"""

import json
import re
from pathlib import Path

import pdfplumber
import requests
from bs4 import BeautifulSoup

BASE_URL = "http://www.town.tomamae.lg.jp"
INDEX_URL = f"{BASE_URL}/section/gikai/t55cub0000000zo1.html"

ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = ROOT / "data" / "tomamae"
SITE_OUTPUT_DIR = ROOT / "site" / "data" / "tomamae"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
SITE_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

ROLE_KEYWORDS = ("委員長", "副委員長", "委員")


def fetch_pdf_url() -> str | None:
    resp = requests.get(INDEX_URL, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding
    soup = BeautifulSoup(resp.text, "html.parser")
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if href.lower().endswith(".pdf"):
            if href.startswith("http"):
                return href
            if href.startswith("/"):
                return BASE_URL + href
            return INDEX_URL.rsplit("/", 1)[0] + "/" + href
    return None


def download_pdf(url: str, dest: Path) -> None:
    resp = requests.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    dest.write_bytes(resp.content)


def detect_role(cell: str | None) -> str | None:
    if not cell:
        return None
    t = cell.strip()
    if not t:
        return None
    # 長いキーワードから先にマッチさせる
    for kw in ("副委員長", "委員長", "委員"):
        if kw in t:
            return kw
    return None


def committee_name_from_header(header_cell: str) -> str:
    """ヘッダセルの「総 務 産 業\n常任委員会」のような表記を正規化する。"""
    t = re.sub(r"\s+", "", header_cell)
    return t


def parse_members_from_pdf(pdf_path: Path) -> list[dict]:
    members: list[dict] = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            tables = page.extract_tables()
            for table in tables:
                if not table or len(table) < 2:
                    continue
                header = table[0]
                if not any(cell and "議席" in cell for cell in header if cell):
                    continue

                col_idx: dict[str, int] = {}
                committee_cols: dict[int, str] = {}
                for i, cell in enumerate(header):
                    if not cell:
                        continue
                    t = re.sub(r"\s+", "", cell)
                    if "議席" in t:
                        col_idx["seat"] = i
                    elif "氏名" in t:
                        col_idx["name"] = i
                    elif "党派" in t:
                        col_idx["party"] = i
                    elif "会派" in t:
                        col_idx["faction"] = i
                    elif "職業" in t:
                        col_idx["job"] = i
                    elif "年齢" in t:
                        col_idx["age"] = i
                    elif "当選" in t:
                        col_idx["elections"] = i
                    elif "顔写真" in t or "写真" in t:
                        col_idx["photo"] = i
                    elif "常任委員会" in t or "特別委員会" in t or (
                        "委員会" in t and "議会運営" in t
                    ) or "組合議員" in t:
                        committee_cols[i] = committee_name_from_header(cell)

                for row in table[1:]:
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

                    # 氏名セル: 「ふりがな\n氏名\n【議長】」のような複数行
                    raw_lines = [
                        ln.strip() for ln in name_cell.splitlines() if ln.strip()
                    ]
                    if not raw_lines:
                        continue

                    furigana = ""
                    name = ""
                    roles: list[str] = []
                    # ふりがなはひらがなのみの行、氏名は漢字を含む行、
                    # 議長等は【】で囲まれた行
                    for ln in raw_lines:
                        if ln.startswith("【") and ln.endswith("】"):
                            roles.append(ln.strip("【】").strip())
                        elif re.fullmatch(r"[ぁ-んー\s　]+", ln):
                            furigana = re.sub(r"\s+", " ", ln).strip()
                        elif not name:
                            name = re.sub(r"\s+", "", ln)
                    if not name:
                        continue

                    party = ""
                    if "party" in col_idx and row[col_idx["party"]]:
                        party = re.sub(r"\s+", "", row[col_idx["party"]])

                    faction = ""
                    if "faction" in col_idx and row[col_idx["faction"]]:
                        faction = re.sub(r"\s+", "", row[col_idx["faction"]])

                    committees: list[str] = []
                    for ci, cname in committee_cols.items():
                        cell = row[ci] if ci < len(row) else None
                        role = detect_role(cell)
                        if role:
                            committees.append(f"{cname}（{role}）")
                        elif cell and cell.strip():
                            # 一部事務組合議員などは「北留萌消防組合」のような組合名が
                            # 直接入る。その場合はそのまま committees に載せる。
                            value = re.sub(r"\s+", "", cell)
                            if value and not any(k in value for k in ROLE_KEYWORDS):
                                committees.append(f"{cname}（{value}）")

                    member = {
                        "seat_number": seat_number,
                        "name": name,
                        "furigana": furigana,
                        "party": party,
                        "faction": faction,
                        "committees": committees,
                    }
                    if roles:
                        member["roles"] = roles
                    members.append(member)

    members.sort(key=lambda m: m["seat_number"])
    return members


def main() -> None:
    print("苫前町議会 議員名簿を収集中...")
    pdf_url = fetch_pdf_url()
    if not pdf_url:
        print("  [ERROR] PDFリンクが見つかりませんでした")
        return
    print(f"  PDF URL: {pdf_url}")

    pdf_path = OUTPUT_DIR / "source.pdf"
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
