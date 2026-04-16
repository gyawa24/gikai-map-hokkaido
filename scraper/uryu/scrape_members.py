"""
雨竜町議会 議員名簿スクレイパー
出力: data/uryu/members.json および site/data/uryu/members.json

データ取得元:
  議会構成ページ:  https://www.town.uryu.hokkaido.jp/docs/3738.html
  議員名簿PDF:    /fs/1/1/3/4/7/_/________R5HP__.pdf

HTMLには議員氏名などのテキストが存在しないため、添付PDFから pdfplumber で
動的に抽出する。議員情報をハードコードしない。
"""

import json
import re
import tempfile
from pathlib import Path

import pdfplumber
import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.uryu.hokkaido.jp"
INDEX_URL = f"{BASE_URL}/docs/3738.html"

REPO_ROOT = Path(__file__).parent.parent.parent
OUTPUT_DIRS = [
    REPO_ROOT / "data" / "uryu",
    REPO_ROOT / "site" / "data" / "uryu",
]
for d in OUTPUT_DIRS:
    d.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def strip_spaces(s: str | None) -> str:
    return re.sub(r"[\s\u3000]+", "", s or "")


def find_pdf_url() -> str | None:
    """議会構成ページからPDFリンクを抽出"""
    try:
        resp = requests.get(INDEX_URL, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
    except Exception as e:
        print(f"  [ERROR] {INDEX_URL} -> {e}")
        return None

    soup = BeautifulSoup(resp.text, "html.parser")
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if href.lower().endswith(".pdf"):
            return href if href.startswith("http") else BASE_URL + href
    return None


def download_pdf(url: str) -> str | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=30)
        resp.raise_for_status()
        tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
        tmp.write(resp.content)
        tmp.close()
        return tmp.name
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def parse_name_cell(cell: str) -> tuple[str, str]:
    """'よし み たく や\n吉 見 拓 也' → (furigana, name)"""
    lines = [ln for ln in (cell or "").splitlines() if ln.strip()]
    if len(lines) >= 2:
        return strip_spaces(lines[0]), strip_spaces(lines[1])
    if len(lines) == 1:
        return "", strip_spaces(lines[0])
    return "", ""


def parse_committees(cell: str) -> list[str]:
    """改行区切りの委員会/役職リストを整形"""
    out: list[str] = []
    for ln in (cell or "").splitlines():
        norm = strip_spaces(ln)
        if norm:
            out.append(norm)
    return out


def parse_pdf(path: str) -> list[dict]:
    members: list[dict] = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables():
                if not table or len(table) < 2:
                    continue
                header_joined = strip_spaces("".join(c or "" for c in table[0]))
                if "議員氏名" not in header_joined or "議席" not in header_joined:
                    continue

                # 列インデックスをヘッダから推定
                col = {}
                for i, h in enumerate(table[0]):
                    key = strip_spaces(h or "")
                    col[key] = i

                seat_i = col.get("議席")
                role_i = col.get("役職")
                name_i = col.get("議員氏名")
                party_i = col.get("党派")
                ken_i = col.get("一部事務組合等議員")
                com_i = col.get("各種委員会委員等")

                for row in table[1:]:
                    if not row or seat_i is None:
                        continue
                    seat_raw = strip_spaces(row[seat_i] or "")
                    if not seat_raw.isdigit():
                        continue
                    seat = int(seat_raw)

                    name_cell = row[name_i] if name_i is not None else ""
                    if "欠員" in strip_spaces(name_cell):
                        continue

                    furigana, name = parse_name_cell(name_cell)
                    if not name:
                        continue

                    role = strip_spaces(row[role_i] or "") if role_i is not None else ""
                    party = strip_spaces(row[party_i] or "") if party_i is not None else ""

                    committees: list[str] = []
                    if ken_i is not None:
                        committees.extend(parse_committees(row[ken_i] or ""))
                    if com_i is not None:
                        committees.extend(parse_committees(row[com_i] or ""))

                    members.append({
                        "seat_number": seat,
                        "name": name,
                        "furigana": furigana,
                        "party": party,
                        "faction": role,
                        "committees": committees,
                    })
    members.sort(key=lambda m: m["seat_number"])
    return members


def main() -> None:
    print("雨竜町議会 議員名簿を収集中...")

    pdf_url = find_pdf_url()
    if not pdf_url:
        print("取得不可: 議会構成ページからPDFリンクが取得できませんでした")
        return
    print(f"  PDF URL: {pdf_url}")

    pdf_path = download_pdf(pdf_url)
    if not pdf_path:
        print("取得不可: PDFダウンロード失敗")
        return

    members = parse_pdf(pdf_path)
    if not members:
        print("取得不可: PDFから議員情報を抽出できませんでした（構造変更の可能性）")
        return

    payload = json.dumps(members, ensure_ascii=False, indent=2)
    for d in OUTPUT_DIRS:
        (d / "members.json").write_text(payload + "\n", encoding="utf-8")

    print(f"取得議員数: {len(members)}名")
    for m in members:
        role = f" [{m['faction']}]" if m["faction"] else ""
        coms = f" 委員会:{'/'.join(m['committees'])}" if m["committees"] else ""
        print(f"  #{m['seat_number']} {m['name']}（{m['furigana']}） 党={m['party']}{role}{coms}")


if __name__ == "__main__":
    main()
