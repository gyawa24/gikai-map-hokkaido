"""
神恵内村議会 議員名簿スクレイパー
出力: site/data/kamoenai/members.json

議員名簿はHTMLではなくPDFで提供されているため、pdfplumberで抽出する。
"""

import json
import re
import tempfile
from pathlib import Path

import pdfplumber
import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.vill.kamoenai.hokkaido.jp"
GIKAI_PAGE_URL = f"{BASE_URL}/hotnews/detail/00000902.html"

REPO_ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = REPO_ROOT / "site" / "data" / "kamoenai"
PHOTO_DIR = REPO_ROOT / "site" / "public" / "members" / "kamoenai"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

# PDFテーブルの列インデックス → 委員会/組合名
COMMITTEE_COLUMNS = {
    2: "総務経済常任委員会",
    3: "議会運営委員会",
    4: "原子力発電所対策特別委員会",
    5: "議会活性化特別委員会",
    6: "岩内・寿都地方消防組合議会",
    7: "岩内地方衛生組合議会",
    8: "後志教育研修センター組合議会",
    9: "後志広域連合議会",
}

# マーク → 役割
ROLE_MARKS = {
    "◎": "委員長",
    "●": "副委員長",
}
MEMBER_MARKS = {"○", "〇"}


def find_pdf_url() -> str | None:
    resp = requests.get(GIKAI_PAGE_URL, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding
    soup = BeautifulSoup(resp.text, "html.parser")
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if "giin" in href.lower() and href.lower().endswith(".pdf"):
            return href if href.startswith("http") else BASE_URL + href
    return None


def detect_default_party(page_text: str) -> str:
    # 「全員無所属」のような記述を探す
    if re.search(r"全員\s*無所属", page_text):
        return "無所属"
    return ""


def fetch_page_text(url: str) -> str:
    resp = requests.get(url, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding
    return BeautifulSoup(resp.text, "html.parser").get_text()


def parse_name_cell(cell: str) -> tuple[str, str]:
    """「ふりがな\n氏名」の形式を (ふりがな, 氏名) に分解"""
    if not cell:
        return "", ""
    lines = [ln.strip() for ln in cell.split("\n") if ln.strip()]
    if len(lines) >= 2:
        furigana = re.sub(r"\s+", "", lines[0])
        name = re.sub(r"\s+", " ", lines[1]).strip()
        # 氏名は姓と名の間のスペース以外は詰める（表記揺れ吸収）
        return furigana, name
    # 1行しかない場合
    return "", re.sub(r"\s+", " ", lines[0]) if lines else ""


def parse_committees(row: list) -> list[str]:
    committees = []
    for col_idx, name in COMMITTEE_COLUMNS.items():
        if col_idx >= len(row):
            continue
        mark = (row[col_idx] or "").strip()
        if not mark:
            continue
        if mark in ROLE_MARKS:
            committees.append(f"{name}（{ROLE_MARKS[mark]}）")
        elif mark in MEMBER_MARKS:
            committees.append(name)
    return committees


def parse_leadership(pdf_text: str) -> dict[str, str]:
    """議長・副議長の氏名を抽出"""
    leaders = {}
    for label, key in [("議 長", "議長"), ("副議長", "副議長")]:
        m = re.search(rf"{label}\s+([^\s][^\n]*?)\s+就任", pdf_text)
        if m:
            leaders[re.sub(r"\s+", " ", m.group(1)).strip()] = key
    return leaders


def scrape():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    PHOTO_DIR.mkdir(parents=True, exist_ok=True)

    print("神恵内村議会 議員名簿を収集中...")
    pdf_url = find_pdf_url()
    if not pdf_url:
        print("  [ERROR] 議員名簿PDFが見つかりません")
        return 0
    print(f"  PDF: {pdf_url}")

    page_text = fetch_page_text(GIKAI_PAGE_URL)
    default_party = detect_default_party(page_text)
    print(f"  default party: {default_party or '(未判定)'}")

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(requests.get(pdf_url, headers=HEADERS, timeout=30).content)
        tmp_path = tmp.name

    members = []
    with pdfplumber.open(tmp_path) as pdf:
        pdf_text = "\n".join((p.extract_text() or "") for p in pdf.pages)
        leaders_map = parse_leadership(pdf_text)
        # 氏名は PDF 内でスペース区切り（例：「伊 藤 公 尚」）なのでスペース除去キーも用意
        leaders_compact = {re.sub(r"\s+", "", k): v for k, v in leaders_map.items()}

        for page in pdf.pages:
            for table in page.extract_tables():
                for row in table:
                    if not row or not row[0]:
                        continue
                    first = row[0].strip()
                    if not first.isdigit():
                        continue
                    seat = int(first)
                    furigana, name = parse_name_cell(row[1] or "")
                    if not name:
                        continue

                    name_compact = re.sub(r"\s+", "", name)
                    faction = leaders_compact.get(name_compact, "")

                    member = {
                        "seat_number": seat,
                        "name": name,
                        "furigana": furigana,
                        "party": default_party,
                        "faction": faction,
                        "committees": parse_committees(row),
                    }
                    members.append(member)
                    print(f"  [{seat}] {name} ({furigana}) {faction}")

    if not members:
        print("  [ERROR] PDFから議員データを抽出できませんでした")
        return 0

    members.sort(key=lambda m: m["seat_number"])
    out_path = OUTPUT_DIR / "members.json"
    out_path.write_text(
        json.dumps(members, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"  出力: {out_path} ({len(members)}名)")
    return len(members)


if __name__ == "__main__":
    n = scrape()
    print(f"\n取得議員数: {n}名" if n else "\n取得不可")
