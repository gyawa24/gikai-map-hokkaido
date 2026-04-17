"""
積丹町議会 議員名簿スクレイパー
出力: site/data/shakotan/members.json

議員名簿はHTMLではなくPDFで提供されているため、pdfplumberで抽出する。
議会ページ (content0099.html) から「議員名簿」リンク先PDFを動的に特定して取得する。
"""

import json
import re
import tempfile
from pathlib import Path

import pdfplumber
import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.shakotan.lg.jp"
GIKAI_PAGE_URL = f"{BASE_URL}/contents/content0099.html"

REPO_ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIR = REPO_ROOT / "site" / "data" / "shakotan"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

# 抽出テーブルの列インデックス → 委員会/組合名
# pdfplumber の extract_tables は縦書き結合ヘッダを持つ表で
# データ行が左オフセットに出るため、実データで観測した位置を使う
COMMITTEE_COLUMNS = {
    7: "総務文教常任委員会",
    10: "産業建設常任委員会",
    13: "議会運営委員会",
    16: "広報編集特別委員会",
    19: "北後志消防組合議会",
    22: "北後志衛生施設組合議会",
    25: "北しりべし廃棄物処理広域連合議会",
    27: "後志広域連合議会",
    30: "後志教育研修センター組合議会",
}

ROLE_MARKS = {
    "◎": "委員長",
    "●": "副委員長",
}
MEMBER_MARKS = {"○", "〇"}
# ◇は一部事務組合等議会議員（議長等が充て職で就任）の印
DELEGATE_MARKS = {"◇"}


def fetch_soup(url: str) -> BeautifulSoup:
    resp = requests.get(url, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding
    return BeautifulSoup(resp.text, "html.parser")


def find_members_pdf_url(soup: BeautifulSoup) -> str | None:
    for a in soup.find_all("a", href=True):
        label = a.get_text(strip=True)
        href: str = a["href"]
        if not href.lower().endswith(".pdf"):
            continue
        if "議員名簿" in label or "議員一覧" in label:
            return href if href.startswith("http") else BASE_URL + href
    return None


def strip_ws(s: str) -> str:
    return re.sub(r"[\s\u3000]+", "", s or "")


def parse_committees(row: list) -> list[str]:
    committees: list[str] = []
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
        elif mark in DELEGATE_MARKS:
            committees.append(name)
    return committees


def parse_leadership(pdf_text: str) -> dict[str, str]:
    """PDFヘッダから議長・副議長を抽出（faction 欄に格納するため）"""
    leaders: dict[str, str] = {}
    for label, key in [("議 長", "議長"), ("副議長", "副議長")]:
        m = re.search(rf"{label}\s+(\S+\s+\S+)\s+[（(]", pdf_text)
        if m:
            name = re.sub(r"\s+", " ", m.group(1)).strip()
            leaders[strip_ws(name)] = key
    return leaders


def scrape() -> int:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print("積丹町議会 議員名簿を収集中...")
    soup = fetch_soup(GIKAI_PAGE_URL)
    pdf_url = find_members_pdf_url(soup)
    if not pdf_url:
        print("  [ERROR] 議員名簿PDFリンクが見つかりません")
        return 0
    print(f"  PDF: {pdf_url}")

    pdf_resp = requests.get(pdf_url, headers=HEADERS, timeout=30)
    pdf_resp.raise_for_status()
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(pdf_resp.content)
        tmp_path = tmp.name

    members: list[dict] = []
    with pdfplumber.open(tmp_path) as pdf:
        pdf_text = "\n".join((p.extract_text() or "") for p in pdf.pages)
        leaders_compact = parse_leadership(pdf_text)

        for page in pdf.pages:
            for table in page.extract_tables():
                for row in table:
                    if not row or not row[0]:
                        continue
                    # 議席番号は全角・半角どちらの可能性もある
                    first = strip_ws(row[0])
                    first_ascii = first.translate(
                        str.maketrans("０１２３４５６７８９", "0123456789")
                    )
                    if not first_ascii.isdigit():
                        continue
                    seat = int(first_ascii)

                    name_cell = row[1] or ""
                    name = re.sub(r"\s+", " ", name_cell).strip()
                    if not name or len(strip_ws(name)) < 2:
                        continue

                    furigana = strip_ws(row[2] or "")

                    faction = leaders_compact.get(strip_ws(name), "")

                    members.append({
                        "seat_number": seat,
                        "name": name,
                        "furigana": furigana,
                        "party": "",
                        "faction": faction,
                        "committees": parse_committees(row),
                    })
                    print(
                        f"  [{seat}] {name} ({furigana}) "
                        f"faction={faction or '-'} "
                        f"committees={len(members[-1]['committees'])}件"
                    )

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
