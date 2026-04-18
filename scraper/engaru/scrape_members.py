"""
遠軽町議会 議員名簿スクレイパー

公式議会ページ https://engaru.jp/information/page.php?id=522 には
議員情報がテキストで存在せず、PDFのみで提供されているため、
pdfplumber で2カラムPDFを左右に切り出してテキスト化し、
議席番号ブロック単位でパースする。

出力: site/data/engaru/members.json
"""

import json
import re
import sys
import time
import unicodedata
from pathlib import Path

import pdfplumber
import requests
from bs4 import BeautifulSoup

BASE_URL = "https://engaru.jp"
INDEX_URL = f"{BASE_URL}/information/page.php?id=522"

ROOT = Path(__file__).parent.parent.parent
RAW_DIR = ROOT / "data" / "engaru"
OUTPUT_DIR = ROOT / "site" / "data" / "engaru"
PHOTO_DIR = ROOT / "site" / "public" / "members" / "engaru"
RAW_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
PHOTO_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}

# 議員名簿PDF (議席・氏名・ふりがな・委員会・会派・政党) の見出し
MEMBER_PDF_LABEL = "各議員名簿"

# 全角数字 → 半角
ZEN2HAN = str.maketrans("０１２３４５６７８９", "0123456789")


def normalize_num(s: str) -> str:
    return s.translate(ZEN2HAN)


def find_member_pdf_url() -> str | None:
    """議会ページから各議員名簿PDFのURLを動的に取得"""
    resp = requests.get(INDEX_URL, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding
    soup = BeautifulSoup(resp.text, "html.parser")

    for a in soup.find_all("a", href=True):
        href = a["href"]
        if not href.lower().endswith(".pdf"):
            continue
        text = a.get_text(strip=True)
        if MEMBER_PDF_LABEL in text:
            # 相対パス ../common/... → 絶対URL
            if href.startswith("http"):
                return href
            # index.php は /information/ 配下にある想定
            if href.startswith("../"):
                return f"{BASE_URL}/{href.lstrip('./')}"
            if href.startswith("/"):
                return f"{BASE_URL}{href}"
            return f"{BASE_URL}/information/{href}"
    return None


def download_pdf(url: str, dest: Path) -> None:
    resp = requests.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    dest.write_bytes(resp.content)


def extract_columns_text(pdf_path: Path) -> list[str]:
    """各ページを左右2列に切り分け、上→下、左→右の順で連結したテキスト行リストを返す"""
    lines: list[str] = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            mid_x = page.width / 2
            for bbox in [
                (0, 40, mid_x, page.height),
                (mid_x, 40, page.width, page.height),
            ]:
                region = page.crop(bbox)
                text = region.extract_text() or ""
                for ln in text.splitlines():
                    ln = ln.strip()
                    if ln:
                        lines.append(ln)
    return lines


SEAT_RE = re.compile(r"議席番号\s+(\S+)")
NAME_RE = re.compile(r"^(議長|副議長|議員)\s+(\S+)\s+(\S+)$")
FURIGANA_RE = re.compile(r"^\(([ぁ-ん\s]+)\)$")
# 隣接カラムの端数文字が行頭に混入することがあるため、re.search で取り出す。
# (1)民生・経済(副委員長) / (1）総務・文教 など。全角「）」もケア。
COMMITTEE_HEAD_RE = re.compile(r"\(1[)）](.+)$")
FACTION_RE = re.compile(r"\(2[)）](.+)$")
PARTY_RE = re.compile(r"\(3[)）](.+)$")
OTHER_RE = re.compile(r"\(4[)）](.+)$")


def parse_members(lines: list[str]) -> list[dict]:
    members: list[dict] = []
    i = 0
    n = len(lines)
    while i < n:
        m = SEAT_RE.match(lines[i])
        if not m:
            i += 1
            continue

        seat_raw = normalize_num(m.group(1))
        try:
            seat = int(seat_raw)
        except ValueError:
            i += 1
            continue

        # 次行に役職と氏名
        i += 1
        if i >= n:
            break
        name_m = NAME_RE.match(lines[i])
        if not name_m:
            # 想定外、スキップ
            i += 1
            continue
        role = name_m.group(1)
        name = f"{name_m.group(2)} {name_m.group(3)}"

        # 次行にふりがな
        i += 1
        furigana = ""
        if i < n:
            f_m = FURIGANA_RE.match(lines[i])
            if f_m:
                furigana = f_m.group(1).strip()
                i += 1

        # (1)〜(4) を次の「議席番号」または末尾まで読む
        committees: list[str] = []
        faction = ""
        party = ""
        current_section: str | None = None  # どの番号を読んでいるか

        while i < n and not SEAT_RE.match(lines[i]):
            ln = lines[i]
            # 行頭に隣接カラムの端数文字（例: "員 "）が混入することがあるため search を使う。
            if (m2 := COMMITTEE_HEAD_RE.search(ln)):
                committees = [m2.group(1).strip()]
                current_section = "committee"
            elif (m2 := FACTION_RE.search(ln)):
                faction = m2.group(1).strip()
                current_section = "faction"
            elif (m2 := PARTY_RE.search(ln)):
                party = m2.group(1).strip()
                current_section = "party"
            elif OTHER_RE.search(ln):
                current_section = "other"
            else:
                # セクションヘッダではない継続行（委員会名の折返しのみ扱う）
                if current_section == "committee":
                    committees.append(ln.strip())
            i += 1

        members.append({
            "seat_number": seat,
            "name": name,
            "furigana": furigana,
            "party": party,
            "faction": faction,
            "committees": committees,
            "role": role,  # 議長/副議長/議員
        })

    return members


def main() -> int:
    print("遠軽町議会 議員名簿を収集中...")

    pdf_url = find_member_pdf_url()
    if not pdf_url:
        print("  [ERROR] 議員名簿PDFのURLが見つかりません")
        return 1
    print(f"  PDF: {pdf_url}")

    pdf_path = RAW_DIR / "members.pdf"
    download_pdf(pdf_url, pdf_path)
    print(f"  保存: {pdf_path} ({pdf_path.stat().st_size} bytes)")

    lines = extract_columns_text(pdf_path)
    members = parse_members(lines)

    if not members:
        print("  [ERROR] 議員データを抽出できませんでした")
        return 1

    # 議席番号順にソート
    members.sort(key=lambda m: m["seat_number"])

    # role は本プロジェクトのスキーマにないので最後に落とす
    for m in members:
        m.pop("role", None)

    out = OUTPUT_DIR / "members.json"
    out.write_text(
        json.dumps(members, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"  出力: {out}")
    print(f"取得議員数: {len(members)}名")
    for mem in members:
        print(f"    {mem['seat_number']:>2} {mem['name']} ({mem['furigana']}) "
              f"/ {mem['faction']} / {mem['party']} / {mem['committees']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
