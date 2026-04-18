"""
浦幌町議会 議員名簿スクレイパー
公式サイトの議員情報はPDF形式のみで提供されているため、
PDFを都度ダウンロードして pdfplumber でパースする。
出力: data/urahoro/members.json, site/data/urahoro/members.json
"""

import json
import re
import unicodedata
import urllib.request
from pathlib import Path

import pdfplumber
from bs4 import BeautifulSoup

COUNCIL_INDEX_URL = "https://www.urahoro.jp/council/?content=1378"
BASE_URL = "https://www.urahoro.jp"

ROOT = Path(__file__).resolve().parent.parent.parent
RAW_DIR = ROOT / "data" / "urahoro"
SITE_DIR = ROOT / "site" / "data" / "urahoro"
RAW_DIR.mkdir(parents=True, exist_ok=True)
SITE_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; gikai-map-hokkaido-bot/1.0; "
        "+https://github.com/gyawa24/gikai-map-hokkaido)"
    )
}


def http_get(url: str, timeout: int = 20) -> bytes:
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def find_members_pdf_url() -> str:
    """議会トップから議員名簿PDFのURLを動的に探す。"""
    html = http_get(COUNCIL_INDEX_URL).decode("utf-8", errors="replace")
    soup = BeautifulSoup(html, "html.parser")
    for a in soup.find_all("a", href=True):
        href = a["href"]
        text = a.get_text(" ", strip=True)
        if href.lower().endswith(".pdf") and "議員名簿" in text:
            if href.startswith("http"):
                return href
            if href.startswith("/"):
                return BASE_URL + href
            return urllib.parse.urljoin(COUNCIL_INDEX_URL, href)
    raise RuntimeError("議員名簿PDFへのリンクが見つかりませんでした")


def normalize(s: str) -> str:
    if s is None:
        return ""
    s = unicodedata.normalize("NFKC", s)
    return s.replace(" ", "").replace("\u3000", "").strip()


def parse_members(pdf_path: Path) -> list[dict]:
    """PDFから議員データを抽出。
    PDFは2列レイアウトだが、pdfplumberの extract_tables は
    各議員を6行ブロックに分解する（cell0に氏名等のブロック、以降col1に年齢/党派/職業/委員会/期数）。
    """
    members: list[dict] = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables():
                i = 0
                while i < len(table):
                    row = table[i]
                    cell0 = (row[0] or "") if row else ""
                    if not cell0.startswith("議席番号"):
                        i += 1
                        continue

                    lines = [ln for ln in cell0.split("\n") if ln.strip()]
                    m = re.match(r"議席番号\s*([０-９0-9]+)\s*(.*)", lines[0])
                    if not m:
                        i += 1
                        continue
                    seat = int(normalize(m.group(1)))
                    furigana = normalize(m.group(2))
                    name = normalize(lines[1]) if len(lines) > 1 else ""

                    party = ""
                    committees: list[str] = []

                    # 党派: i+2, 委員会: i+4 が標準。安全のため範囲内で探す。
                    for k in range(i + 1, min(i + 6, len(table))):
                        sub = table[k]
                        if not sub or len(sub) < 2 or not sub[1]:
                            continue
                        val = sub[1]
                        # 党派の行は単一語（例: 無所属/自民党/...）
                        if k == i + 2 and "\n" not in val and len(val) <= 10:
                            party = val.strip()
                        # 委員会の行は複数行が典型、かつ "歳" や "期" を含まない
                        if ("委員会" in val or "議長" in val or "議選監査" in val) and "歳" not in val and "期" not in val:
                            for c in val.split("\n"):
                                c = c.strip()
                                if c and c != "委員会等":
                                    committees.append(c)

                    members.append({
                        "seat_number": seat,
                        "name": name,
                        "furigana": furigana,
                        "party": party,
                        "faction": "",
                        "committees": committees,
                    })
                    i += 6
    members.sort(key=lambda x: x["seat_number"])
    # 重複除去
    seen = set()
    uniq = []
    for m in members:
        if m["seat_number"] in seen:
            continue
        seen.add(m["seat_number"])
        uniq.append(m)
    return uniq


def main() -> None:
    print("浦幌町議会 議員名簿を収集中...")
    pdf_url = find_members_pdf_url()
    print(f"  PDF URL: {pdf_url}")

    pdf_path = RAW_DIR / "members.pdf"
    pdf_path.write_bytes(http_get(pdf_url))
    print(f"  DL完了: {pdf_path} ({pdf_path.stat().st_size} bytes)")

    members = parse_members(pdf_path)
    if not members:
        print("取得不可: PDFから議員データを抽出できませんでした")
        return

    payload = {
        "municipality": "urahoro",
        "source": pdf_url,
        "count": len(members),
        "members": members,
    }
    out_raw = RAW_DIR / "members.json"
    out_site = SITE_DIR / "members.json"
    for p in (out_raw, out_site):
        p.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"  出力: {p}")

    print(f"取得議員数: {len(members)}名")


if __name__ == "__main__":
    main()
