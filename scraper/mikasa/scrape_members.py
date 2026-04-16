"""
三笠市議会 議員名簿スクレイパー
出力: site/data/mikasa/members.json および data/mikasa/members.json

三笠市はHTMLに議員情報を掲載せず、PDFで公開しているため
HTMLから最新PDFのURLを動的に取得し、pdfplumber でパースする。
"""

from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path
from urllib.parse import urljoin

import pdfplumber
import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.city.mikasa.hokkaido.jp"
ASSEMBLY_URL = f"{BASE_URL}/assembly/"
MEMBERS_PAGE_URL = f"{BASE_URL}/assembly/detail/00001695.html"

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SITE_DATA_DIR = REPO_ROOT / "site" / "data" / "mikasa"
DATA_DIR = REPO_ROOT / "data" / "mikasa"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def fetch(url: str) -> requests.Response | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.raise_for_status()
        return resp
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def discover_pdf_url() -> str | None:
    """議員紹介ページからPDFへのリンクを動的に検出する。"""
    # まず議員紹介ページ（固定URL）を試す
    candidates: list[str] = []
    for url in (MEMBERS_PAGE_URL, ASSEMBLY_URL, f"{BASE_URL}/assembly/category/211.html"):
        resp = fetch(url)
        if resp is None:
            continue
        resp.encoding = resp.apparent_encoding
        soup = BeautifulSoup(resp.text, "html.parser")
        for a in soup.find_all("a", href=True):
            href = a["href"]
            text = a.get_text(strip=True)
            if href.lower().endswith(".pdf") and (
                "紹介" in text or "議員" in text or "syoukai" in href.lower() or "giin" in href.lower()
            ):
                full = href if href.startswith("http") else urljoin(url, href)
                candidates.append(full)
        # リンクが見つかった最初のページで打ち切り
        if candidates:
            break

    if not candidates:
        return None

    # 「議員紹介」「syoukai」を優先
    priority = [u for u in candidates if "syoukai" in u.lower() or "紹介" in u]
    return (priority or candidates)[0]


def normalize_digits(text: str) -> str:
    """全角数字・漢数字を半角数字へ正規化。"""
    text = unicodedata.normalize("NFKC", text)
    kanji_map = {"〇": "0", "零": "0", "一": "1", "二": "2", "三": "3",
                 "四": "4", "五": "5", "六": "6", "七": "7", "八": "8", "九": "9"}
    for k, v in kanji_map.items():
        text = text.replace(k, v)
    return text


def parse_int_after_colon(line: str) -> int | None:
    m = re.search(r"[：:]\s*(\S+)", line)
    if not m:
        return None
    s = normalize_digits(m.group(1))
    m2 = re.search(r"\d+", s)
    return int(m2.group(0)) if m2 else None


def extract_column_text(page: pdfplumber.page.Page, left: bool) -> str:
    w, h = page.width, page.height
    mid = w / 2
    bbox = (0, 0, mid, h) if left else (mid, 0, w, h)
    return page.crop(bbox).extract_text() or ""


# 除外すべき見出し行（正規化後の判定に使う）
HEADER_LINES = {
    "議員の紹介", "議員の 紹介", "議員 の紹介", "議員 の 紹介",
    "議員の", "の紹介", "議員（以下、議席番号順）",
    "◎＝委員長、○＝副委員長",
}


def is_header_line(line: str) -> bool:
    compact = re.sub(r"\s+", "", line)
    if compact.startswith("※"):
        return True
    if compact in {"議員の紹介", "議員の", "の紹介"}:
        return True
    if compact.startswith("議員（以下"):
        return True
    if "＝委員長" in compact and "副委員長" in compact:
        return True
    return False


NAME_LINE_RE = re.compile(r"^\s*([^\s（(]+)\s*[（(]\s*([^）)]+?)\s*[）)]\s*$")


def parse_column(text: str) -> list[dict]:
    """列のテキストから議員レコード列を抽出。"""
    members: list[dict] = []
    current: dict | None = None
    pending_role: str | None = None  # 議長 / 副議長

    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if is_header_line(line):
            continue
        # 役職ラベル（議長・副議長）は次に出現する議員に適用
        compact = re.sub(r"\s+", "", line)
        if compact in {"議長", "副議長"}:
            pending_role = compact
            continue

        # 議員氏名＋ふりがな行
        m = NAME_LINE_RE.match(line)
        if m:
            if current is not None:
                members.append(current)
            name = m.group(1).strip()
            furigana = m.group(2).strip()
            current = {
                "seat_number": None,
                "name": name,
                "furigana": furigana,
                "party": "",
                "faction": "",
                "committees": [],
            }
            if pending_role:
                current["role"] = pending_role
                pending_role = None
            continue

        if current is None:
            continue

        if line.startswith("議席番号"):
            n = parse_int_after_colon(line)
            if n is not None:
                current["seat_number"] = n
        elif line.startswith("党派"):
            m2 = re.search(r"[：:]\s*(.+)$", line)
            if m2:
                current["party"] = m2.group(1).strip()
        elif line.startswith("当選回数"):
            # 出力フィールドに含めないためスキップ
            continue
        else:
            # 委員会行（◎・○ マーカーで役割付き）
            role_prefix = ""
            body = line
            if body.startswith("◎"):
                role_prefix = "（委員長）"
                body = body[1:].strip()
            elif body.startswith("○"):
                role_prefix = "（副委員長）"
                body = body[1:].strip()
            if body:
                current["committees"].append(body + role_prefix)

    if current is not None:
        members.append(current)
    return members


def scrape_members() -> list[dict] | None:
    print("三笠市議会 議員名簿を収集中...")
    pdf_url = discover_pdf_url()
    if not pdf_url:
        print("  [ERROR] 議員紹介PDFのリンクを特定できませんでした")
        return None
    print(f"  PDF URL: {pdf_url}")

    resp = fetch(pdf_url)
    if resp is None:
        return None
    pdf_path = DATA_DIR / "source.pdf"
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    pdf_path.write_bytes(resp.content)

    members: list[dict] = []
    try:
        with pdfplumber.open(str(pdf_path)) as pdf:
            for page in pdf.pages:
                left_text = extract_column_text(page, left=True)
                right_text = extract_column_text(page, left=False)
                # 左→右の順（議長→副議長→議席番号順）
                members.extend(parse_column(left_text))
                members.extend(parse_column(right_text))
    except Exception as e:
        print(f"  [ERROR] PDFパース失敗: {e}")
        return None

    # 議席番号が取れたものだけを有効とする
    valid = [m for m in members if m.get("seat_number") and m.get("name")]
    # 議席番号で並び替え
    valid.sort(key=lambda m: m["seat_number"])

    if not valid:
        print("  [ERROR] 議員情報を抽出できませんでした")
        return None
    return valid


def main() -> int:
    members = scrape_members()
    if not members:
        print("取得不可: PDFから議員情報を抽出できなかったため members.json は作成しません")
        return 1

    SITE_DATA_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(members, ensure_ascii=False, indent=2)
    (SITE_DATA_DIR / "members.json").write_text(payload + "\n", encoding="utf-8")
    (DATA_DIR / "members.json").write_text(payload + "\n", encoding="utf-8")

    print(f"取得議員数: {len(members)}名")
    for m in members:
        role = f" [{m.get('role')}]" if m.get("role") else ""
        print(f"  議席{m['seat_number']:>2}: {m['name']} ({m['furigana']}) {m['party']}{role} {m['committees']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
