"""
枝幸町議会 議員名簿スクレイパー

公式 HTML の「議員紹介」ページが空のため以下の二段構えで動的に取得する：
  1. /gikai/meeting/minutes.html から最新の定例会会議録 PDF を特定し、
     pdfplumber で「出席議員」セクションを解析して
     議席番号・氏名・議長/副議長フラグを得る。
  2. /gikai/committee/ ページの委員会表 (HTML テーブル) を解析して
     議員ごとの委員会割当 (常任委員会名) を得る。

出力:
  - data/esashi_souya/members.json
  - site/data/esashi_souya/members.json
"""

import json
import re
import unicodedata
import urllib.parse
from pathlib import Path

import pdfplumber
import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.esashi.jp"
MINUTES_INDEX_URL = f"{BASE_URL}/gikai/meeting/minutes.html"
COMMITTEE_URL = f"{BASE_URL}/gikai/committee/"

REPO_ROOT = Path(__file__).parent.parent.parent
DATA_DIR = REPO_ROOT / "data" / "esashi_souya"
SITE_DATA_DIR = REPO_ROOT / "site" / "data" / "esashi_souya"
DATA_DIR.mkdir(parents=True, exist_ok=True)
SITE_DATA_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def normalize_name(raw: str) -> str:
    """会議録 PDF（"小 原 仁"）と委員会 HTML（"石川　勝"）のどちらでも
    同じキーになるよう、内部の全角／半角空白を全て除去する。"""
    return re.sub(r"[\s\u3000]+", "", raw.strip())


def fetch(url: str) -> str | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding
        return resp.text
    except Exception as e:
        print(f"  [ERROR] {url} -> {e}")
        return None


def find_latest_minutes_pdf() -> str | None:
    """会議録ページから最新の定例会1日目PDFのURLを特定する。"""
    html = fetch(MINUTES_INDEX_URL)
    if html is None:
        return None
    soup = BeautifulSoup(html, "html.parser")

    candidates: list[tuple[str, str]] = []
    for a in soup.find_all("a", href=True):
        text = a.get_text(strip=True)
        href = a["href"]
        if not href.lower().endswith(".pdf"):
            continue
        if "定例会" not in text:
            continue
        candidates.append((text, urllib.parse.urljoin(MINUTES_INDEX_URL, href)))

    if not candidates:
        return None

    def score(item: tuple[str, str]) -> tuple:
        text = item[0]
        m = re.search(r"令和(\d+)年第(\d+)回", text)
        year = int(m.group(1)) if m else 0
        nth = int(m.group(2)) if m else 0
        is_day1 = "１日目" in text or "1日目" in text or "開会" in text
        return (year, nth, 1 if is_day1 else 0)

    candidates.sort(key=score, reverse=True)
    return candidates[0][1]


def parse_attending_members(pdf_path: Path) -> list[dict]:
    """会議録の「出席議員」セクションを正規表現で解析する。

    出席議員の記載は議事日程の長さによって 1 ページ目以降に流れ込むので、
    全ページを順に走査する。
    """
    section_text: str | None = None
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            raw = page.extract_text() or ""
            if "出席議員" in raw:
                section_text = unicodedata.normalize("NFKC", raw)
                break

    if section_text is None:
        print("  [ERROR] 出席議員ブロックが見つかりません")
        return []

    m_block = re.search(
        r"出席議員[^\n]*\n(.+?)(?:欠席議員|本会議に出席|地方自治法)",
        section_text,
        re.DOTALL,
    )
    if not m_block:
        print("  [ERROR] 出席議員ブロックの末尾を特定できません")
        return []
    block = m_block.group(1)

    member_pattern = re.compile(
        r"(議\s*長|副\s*議\s*長)?\s*(\d+)\s*番\s+([^\d君]+?)\s*君"
    )

    members: list[dict] = []
    for m in member_pattern.finditer(block):
        role_raw = (m.group(1) or "").replace(" ", "")
        seat = int(m.group(2))
        name = normalize_name(m.group(3))
        if not name:
            continue
        role = ""
        if role_raw == "議長":
            role = "議長"
        elif role_raw == "副議長":
            role = "副議長"
        members.append(
            {
                "seat_number": seat,
                "name": name,
                "role": role,
            }
        )

    seen: set[int] = set()
    unique: list[dict] = []
    for m in members:
        if m["seat_number"] in seen:
            continue
        seen.add(m["seat_number"])
        unique.append(m)
    unique.sort(key=lambda x: x["seat_number"])
    return unique


def parse_committees() -> dict[str, list[str]]:
    """委員会ページから {正規化氏名: [委員会名,...]} を構築。"""
    html = fetch(COMMITTEE_URL)
    if html is None:
        return {}
    soup = BeautifulSoup(html, "html.parser")

    assignments: dict[str, list[str]] = {}

    for h2 in soup.find_all("h2"):
        title = h2.get_text(strip=True)
        if "常任委員会" not in title:
            continue
        committee_name = title

        table = h2.find_next("table")
        if table is None:
            continue

        for tr in table.find_all("tr"):
            tds = tr.find_all("td")
            if not tds:
                continue
            cell = tds[-1]
            for raw_name in cell.get_text("\n").splitlines():
                norm = normalize_name(raw_name)
                if not norm or len(norm.replace(" ", "")) < 2:
                    continue
                bucket = assignments.setdefault(norm, [])
                if committee_name not in bucket:
                    bucket.append(committee_name)
    return assignments


def main() -> None:
    print("枝幸町議会 議員名簿を収集中...")

    pdf_url = find_latest_minutes_pdf()
    if not pdf_url:
        print("  [ERROR] 会議録PDFを発見できません")
        return
    print(f"  会議録PDF: {pdf_url}")

    pdf_path = DATA_DIR / "minutes_latest.pdf"
    try:
        resp = requests.get(pdf_url, headers=HEADERS, timeout=30)
        resp.raise_for_status()
        pdf_path.write_bytes(resp.content)
        print(f"  PDF保存: {pdf_path} ({len(resp.content):,} bytes)")
    except Exception as e:
        print(f"  [ERROR] PDFダウンロード失敗: {e}")
        return

    base_members = parse_attending_members(pdf_path)
    if not base_members:
        print("  [ERROR] 議員データを抽出できませんでした")
        return

    committees_map = parse_committees()
    if not committees_map:
        print("  [WARN] 委員会情報を取得できませんでした（委員会列は空のままにします）")

    members: list[dict] = []
    for m in base_members:
        committees = committees_map.get(m["name"], []).copy()
        members.append(
            {
                "seat_number": m["seat_number"],
                "name": m["name"],
                "furigana": "",
                "party": "",
                "faction": m["role"],
                "committees": committees,
            }
        )

    out_path = DATA_DIR / "members.json"
    site_out_path = SITE_DATA_DIR / "members.json"
    payload = json.dumps(members, ensure_ascii=False, indent=2)
    out_path.write_text(payload, encoding="utf-8")
    site_out_path.write_text(payload, encoding="utf-8")

    print(f"  取得議員数: {len(members)}名")
    for m in members:
        cm = ", ".join(m["committees"]) if m["committees"] else "-"
        role = m["faction"] or " "
        print(f"    [{m['seat_number']:>2}] {role:<3} {m['name']}  | {cm}")
    print(f"  出力: {out_path}")
    print(f"  出力: {site_out_path}")


if __name__ == "__main__":
    main()
