"""
中頓別町議会 議員名簿スクレイパー
出力: data/nakatombetsu/members.json

公式サイトには議員氏名等の HTML テキストが無く、PDF のみが公開されている。
したがって PDF を都度ダウンロードし pdfplumber で抽出する。
"""

import json
import re
import sys
from pathlib import Path

import pdfplumber
import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.nakatombetsu.hokkaido.jp"
INDEX_URL = f"{BASE_URL}/bunya/5545/"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "data" / "nakatombetsu"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
SITE_OUTPUT_DIR = Path(__file__).parent.parent.parent / "site" / "data" / "nakatombetsu"
SITE_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PDF_CACHE = OUTPUT_DIR / "members.pdf"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def find_pdf_url() -> str | None:
    """議員名簿ページから PDF の URL を動的に特定する。"""
    try:
        resp = requests.get(INDEX_URL, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
    except Exception as e:
        print(f"  [ERROR] index fetch failed: {e}")
        return None

    soup = BeautifulSoup(resp.text, "html.parser")
    # 名簿 PDF を最優先で探す
    candidates = []
    for a in soup.find_all("a", href=True):
        href = a["href"]
        text = a.get_text(strip=True)
        if not href.lower().endswith(".pdf"):
            continue
        abs_url = href if href.startswith("http") else BASE_URL + href
        candidates.append((abs_url, text))

    if not candidates:
        return None

    # 「名簿」「議員」等を含むものを優先、無ければ先頭
    for url, text in candidates:
        if "名簿" in text or "議員" in text:
            return url
    return candidates[0][0]


def download_pdf(url: str) -> Path | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=30)
        resp.raise_for_status()
        PDF_CACHE.write_bytes(resp.content)
        return PDF_CACHE
    except Exception as e:
        print(f"  [ERROR] pdf download failed: {e}")
        return None


def normalize_name(raw: str) -> str:
    """'蓮 尾 純 一' のような空白区切りを詰める。"""
    return re.sub(r"\s+", "", raw or "").strip()


def flatten(cell: str) -> str:
    return (cell or "").replace("\n", " ").strip()


# 議席番号セル（全角/半角数字）を整数へ
def parse_seat(cell: str) -> int | None:
    s = flatten(cell)
    # 全角→半角
    trans = str.maketrans("０１２３4５６７８９", "0123456789")
    s = s.translate(trans)
    m = re.search(r"\d+", s)
    return int(m.group()) if m else None


# 委員会セルから委員会名（と役職）の配列を抽出
# 例: 'いきいきふるさと常任委員会 委員\n議会広報編集特別委員会 委員長'
def parse_committees(cell: str) -> list[str]:
    if not cell:
        return []
    items = []
    for line in cell.split("\n"):
        line = line.strip()
        if not line:
            continue
        # 「議 長」「副議長」などの役職単独行はスキップ（議員固有属性であって委員会ではない）
        if re.fullmatch(r"(議\s*長|副\s*議\s*長)", line):
            continue
        # 末尾の複数空白を一つに
        line = re.sub(r"\s+", " ", line)
        items.append(line)
    return items


def parse_role(cell: str) -> str:
    """委員会セル中の「議長」「副議長」を拾って faction っぽく使う用に返す。
    中頓別町は会派制が明示されていないため faction は空にし、議長/副議長のみ注記する。"""
    if not cell:
        return ""
    for line in cell.split("\n"):
        line = line.strip()
        if re.fullmatch(r"議\s*長", line):
            return "議長"
        if re.fullmatch(r"副\s*議\s*長", line):
            return "副議長"
    return ""


def extract_members(pdf_path: Path) -> list[dict]:
    members: list[dict] = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables() or []:
                if not table or len(table) < 2:
                    continue
                header = [flatten(c) for c in table[0]]
                # ヘッダから列位置を特定
                try:
                    seat_col = next(i for i, h in enumerate(header) if "議席" in h)
                    name_col = next(i for i, h in enumerate(header) if "氏" in h and "名" in h)
                except StopIteration:
                    continue
                role_col = None
                for i, h in enumerate(header):
                    if "職名" in h or "所属" in h:
                        role_col = i
                        break

                for row in table[1:]:
                    if not row or len(row) <= name_col:
                        continue
                    seat = parse_seat(row[seat_col])
                    name = normalize_name(row[name_col])
                    if not seat or not name:
                        continue
                    role_cell = row[role_col] if role_col is not None and role_col < len(row) else ""
                    members.append({
                        "seat_number": seat,
                        "name": name,
                        "furigana": "",
                        "party": "",
                        "faction": parse_role(role_cell),
                        "committees": parse_committees(role_cell),
                    })
    members.sort(key=lambda m: m["seat_number"])
    return members


def main() -> int:
    print("中頓別町議会 議員名簿を収集中...")
    pdf_url = find_pdf_url()
    if not pdf_url:
        print("取得不可: 名簿 PDF のリンクが index ページから特定できない")
        return 1
    print(f"  PDF URL: {pdf_url}")

    pdf_path = download_pdf(pdf_url)
    if not pdf_path:
        print("取得不可: PDF ダウンロード失敗")
        return 1

    members = extract_members(pdf_path)
    if not members:
        print("取得不可: PDF から議員情報を抽出できなかった")
        return 1

    out_path = OUTPUT_DIR / "members.json"
    out_path.write_text(
        json.dumps(members, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    site_out_path = SITE_OUTPUT_DIR / "members.json"
    site_out_path.write_text(
        json.dumps(members, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"  {out_path} に {len(members)} 件保存")
    print(f"  {site_out_path} にも同期")
    print(f"取得議員数: {len(members)}名")
    return 0


if __name__ == "__main__":
    sys.exit(main())
