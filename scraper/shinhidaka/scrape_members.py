"""
新ひだか町議会 議員名簿スクレイパー

公式サイトの議員紹介ページに議員情報のHTMLテキスト掲載は無く、
PDF「議員名簿」(giinnmeibo.pdf) のみ公開されている。
そのため、毎回最新PDFを動的取得し、pdfplumberでパースする。

出力: data/shinhidaka/members.json  と site/data/shinhidaka/members.json
"""

import json
import re
import sys
from pathlib import Path

import requests

try:
    import pdfplumber
except ImportError:
    print("[ERROR] pdfplumber が必要です: pip install pdfplumber")
    sys.exit(1)

from bs4 import BeautifulSoup

BASE_URL = "https://www.shinhidaka-hokkaido.jp"
INDEX_URL = f"{BASE_URL}/gikai/detail/00000191.html"

REPO_ROOT = Path(__file__).parent.parent.parent
DATA_DIR = REPO_ROOT / "data" / "shinhidaka"
SITE_DATA_DIR = REPO_ROOT / "site" / "data" / "shinhidaka"
DATA_DIR.mkdir(parents=True, exist_ok=True)
SITE_DATA_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

ROLE_MARKERS = ("◎", "○", "〇", "●", "★", "☆")


def find_pdf_url() -> str | None:
    """議員紹介ページから議員名簿PDFのURLを特定"""
    try:
        resp = requests.get(INDEX_URL, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
    except Exception as e:
        print(f"  [ERROR] index fetch: {e}")
        return None

    soup = BeautifulSoup(resp.text, "html.parser")
    for a in soup.find_all("a", href=True):
        href = a["href"]
        text = a.get_text(strip=True)
        if href.lower().endswith(".pdf") and "議員名簿" in text:
            return href if href.startswith("http") else BASE_URL + href
    # フォールバック: 「giin」を含むPDF
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if href.lower().endswith(".pdf") and "giin" in href.lower():
            return href if href.startswith("http") else BASE_URL + href
    return None


def download_pdf(url: str, dest: Path) -> bool:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=30)
        resp.raise_for_status()
        dest.write_bytes(resp.content)
        return True
    except Exception as e:
        print(f"  [ERROR] pdf download: {e}")
        return False


def clean_cell(text: str | None) -> str:
    if not text:
        return ""
    return re.sub(r"\s+", " ", text).strip()


def strip_markers(text: str) -> str:
    for m in ROLE_MARKERS:
        text = text.replace(m, "")
    return text.strip()


def parse_committees(cell: str | None) -> list[str]:
    """所属委員会セルから委員会名を抽出（役職マーカー除去）"""
    if not cell:
        return []
    items = []
    for line in cell.split("\n"):
        line = strip_markers(line)
        line = re.sub(r"\s+", "", line)
        if not line:
            continue
        items.append(line)
    # 重複除去（出現順維持）
    seen = set()
    result = []
    for x in items:
        if x not in seen:
            seen.add(x)
            result.append(x)
    return result


def parse_faction(cell: str | None) -> str:
    if not cell:
        return ""
    # 改行をまたぐ会派名（例: "●いい町を\n創る会"）を連結
    txt = strip_markers(cell).replace("\n", "").replace(" ", "")
    if txt in ("―", "-", "無会派"):
        return "" if txt in ("―", "-") else "無会派"
    return txt


def parse_party(cell: str | None) -> str:
    if not cell:
        return ""
    txt = strip_markers(cell).replace("\n", "").replace(" ", "")
    if txt in ("―", "-", ""):
        return "無所属"
    return txt


def parse_name(cell: str | None) -> str:
    if not cell:
        return ""
    txt = strip_markers(cell).replace("\n", " ").strip()
    txt = re.sub(r"\s+", " ", txt)
    return txt


def scrape():
    print("新ひだか町議会 議員名簿を収集中...")

    pdf_url = find_pdf_url()
    if not pdf_url:
        print("  [ERROR] 議員名簿PDFのURLが見つかりません")
        return None
    print(f"  PDF URL: {pdf_url}")

    pdf_path = DATA_DIR / "giinmeibo.pdf"
    if not download_pdf(pdf_url, pdf_path):
        return None
    print(f"  PDF 保存: {pdf_path}")

    members = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables() or []:
                for row in table:
                    if not row or len(row) < 10:
                        continue
                    num_cell = clean_cell(row[2]) if len(row) > 2 else ""
                    if not re.fullmatch(r"\d+", num_cell):
                        continue
                    seat = int(num_cell)

                    # 氏名は通常 index 4 にある（index 3 は結合セルの空部分）
                    name_cell = ""
                    for idx in (4, 3):
                        cand = clean_cell(row[idx]) if len(row) > idx else ""
                        if cand and not re.fullmatch(r"\d+", cand):
                            name_cell = row[idx]
                            break
                    name = parse_name(name_cell)
                    if not name:
                        continue

                    faction = parse_faction(row[5] if len(row) > 5 else "")
                    committees_raw = row[7] if len(row) > 7 else ""
                    # 「議長」「副議長」は議会全体の役職なので、委員会リストとしても残す場合もあるが
                    # ここでは生の所属委員会セルをそのまま分割して保持する
                    committees = parse_committees(committees_raw)
                    party = parse_party(row[9] if len(row) > 9 else "")

                    members.append({
                        "seat_number": seat,
                        "name": name,
                        "furigana": "",
                        "party": party,
                        "faction": faction,
                        "committees": committees,
                    })

    # 重複除去＆議席番号でソート
    uniq = {}
    for m in members:
        uniq[m["seat_number"]] = m
    members = [uniq[k] for k in sorted(uniq.keys())]

    if not members:
        print("  [ERROR] 議員データを抽出できませんでした")
        return None

    return members


def main():
    members = scrape()
    if not members:
        print("取得不可: PDFから議員データを抽出できず")
        sys.exit(1)

    print(f"\n取得議員数: {len(members)}名")
    for m in members:
        print(f"  {m['seat_number']:>2} {m['name']} / {m['faction']} / {m['party']} / {m['committees']}")

    for out in (DATA_DIR / "members.json", SITE_DATA_DIR / "members.json"):
        out.write_text(
            json.dumps(members, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"  書き出し: {out}")


if __name__ == "__main__":
    main()
