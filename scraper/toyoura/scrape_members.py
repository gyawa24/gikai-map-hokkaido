"""
豊浦町議会 議員名簿スクレイパー
出力: site/data/toyoura/members.json および data/toyoura/members.json

豊浦町はHTMLに議員情報を掲載せず、PDFで公開しているため
HTMLから最新PDFのURLを動的に取得し、pdfplumberでパースする。
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from urllib.parse import urljoin

import pdfplumber
import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.town.toyoura.hokkaido.jp"
MEMBERS_PAGE_URL = f"{BASE_URL}/hotnews/detail/00001430.html"

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SITE_DATA_DIR = REPO_ROOT / "site" / "data" / "toyoura"
DATA_DIR = REPO_ROOT / "data" / "toyoura"

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
    """議員名簿ページから議員名簿PDFのリンクを動的に検出する。"""
    resp = fetch(MEMBERS_PAGE_URL)
    if resp is None:
        return None
    resp.encoding = resp.apparent_encoding
    soup = BeautifulSoup(resp.text, "html.parser")

    candidates: list[str] = []
    for a in soup.find_all("a", href=True):
        href = a["href"]
        text = a.get_text(strip=True)
        if href.lower().endswith(".pdf") and ("議員" in text or "名簿" in text):
            full = href if href.startswith("http") else urljoin(MEMBERS_PAGE_URL, href)
            candidates.append(full)

    if not candidates:
        # フォールバック: 議員名簿らしいテキストがなくても唯一のPDFを採用
        pdf_links = [
            urljoin(MEMBERS_PAGE_URL, a["href"])
            for a in soup.find_all("a", href=True)
            if a["href"].lower().endswith(".pdf")
        ]
        if len(pdf_links) == 1:
            return pdf_links[0]
        return None
    return candidates[0]


def normalize_name(raw: str) -> str:
    """漢字間の全角/半角スペースを削除して氏名を正規化。"""
    if not raw:
        return ""
    return re.sub(r"\s+", "", raw)


def extract_chairman_committee(position: str) -> str | None:
    """職名文字列（改行含む）から委員長を務める委員会名を抽出する。"""
    compact = re.sub(r"\s+", "", position or "")
    m = re.match(r"^(.+?)委員長$", compact)
    if not m:
        return None
    name = m.group(1)
    # 議会運営委員長 は職名略称「議運委員長」で記載される
    if name == "議運":
        return "議会運営"
    # 議長・副議長・監査委員は 委員会役職ではない
    if name in {"議", "副議"}:
        return None
    return name


def derive_role(position: str) -> str | None:
    """議長・副議長・監査委員などの役職を抽出する。"""
    compact = re.sub(r"\s+", "", position or "")
    if compact == "議長":
        return "議長"
    if compact == "副議長":
        return "副議長"
    if compact == "監査委員":
        return "監査委員"
    return None


def parse_members_from_pdf(pdf_path: Path) -> list[dict]:
    members: list[dict] = []
    with pdfplumber.open(str(pdf_path)) as pdf:
        for page in pdf.pages:
            tables = page.extract_tables()
            for table in tables:
                if not table or len(table) < 2:
                    continue
                header = [(c or "").replace("\n", "").replace(" ", "") for c in table[0]]
                # ヘッダから各列のインデックスを特定
                try:
                    idx_position = header.index("職名")
                    idx_name = header.index("氏名")
                    idx_committees = header.index("所属委員会")
                    idx_seat = header.index("議席")
                except ValueError:
                    # 期待する列構成でない表はスキップ
                    continue

                for row in table[1:]:
                    if len(row) <= max(idx_position, idx_name, idx_committees, idx_seat):
                        continue
                    raw_name = (row[idx_name] or "").strip()
                    name = normalize_name(raw_name)
                    if not name:
                        continue

                    seat_raw = (row[idx_seat] or "").strip()
                    seat_match = re.search(r"\d+", seat_raw)
                    seat_number = int(seat_match.group(0)) if seat_match else None

                    position = (row[idx_position] or "").strip()
                    committees_cell = (row[idx_committees] or "").strip()

                    committees: list[str] = []
                    chair = extract_chairman_committee(position)
                    if chair:
                        committees.append(f"{chair}（委員長）")

                    for line in committees_cell.splitlines():
                        item = line.strip()
                        if item:
                            committees.append(item)

                    member = {
                        "seat_number": seat_number,
                        "name": name,
                        "furigana": "",
                        "party": "",
                        "faction": "",
                        "committees": committees,
                    }
                    role = derive_role(position)
                    if role:
                        member["role"] = role
                    members.append(member)
    return members


def scrape_members() -> list[dict] | None:
    print("豊浦町議会 議員名簿を収集中...")
    pdf_url = discover_pdf_url()
    if not pdf_url:
        print("  [ERROR] 議員名簿PDFのリンクを特定できませんでした")
        return None
    print(f"  PDF URL: {pdf_url}")

    resp = fetch(pdf_url)
    if resp is None:
        return None

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    pdf_path = DATA_DIR / "source.pdf"
    pdf_path.write_bytes(resp.content)

    try:
        members = parse_members_from_pdf(pdf_path)
    except Exception as e:
        print(f"  [ERROR] PDFパース失敗: {e}")
        return None

    valid = [m for m in members if m.get("seat_number") and m.get("name")]
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
        print(f"  議席{m['seat_number']:>2}: {m['name']}{role} {m['committees']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
